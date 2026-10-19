import type { Adapter, AgentContext } from './adapters/index.js';
import { distinctAgents } from './agents.js';
import { auditPlugin } from './audit.js';
import { installedView, type InstalledRow } from './installed.js';
import { applyProposals, propose, withComponents, type OperateDeps } from './operate.js';
import type { AgentId, Catalog, Plugin, Scope } from './types.js';
import type { InstalledState, WizardResult } from './ui/App.js';
import { m } from './ui/messages.js';
import { outdatedRows, updatePlugin } from './update.js';

/**
 * The interactive session: show the wizard, apply what it returns, then show
 * it again with the run's summary, until the user leaves it without a change.
 * A dry run stops after printing its commands. Returns how many runs applied changes.
 */
export async function browseLoop(
  wizard: (notice: string) => Promise<WizardResult | null>,
  apply: (result: WizardResult) => Promise<string>,
  opts: { dryRun?: boolean } = {},
): Promise<number> {
  let notice = '';
  for (let runs = 0; ; runs++) {
    const result = await wizard(notice);
    if (!result) return runs;
    notice = await apply(result);
    if (opts.dryRun) return runs + 1;
  }
}

/** What the agents report in `scopes`, as the tree shows it, with the rows that uninstalls and updates act on. */
export async function readInstalled(
  catalog: Catalog,
  agents: readonly AgentId[],
  scopes: readonly Scope[],
  ctx: AgentContext,
  adapters?: Record<AgentId, Adapter>,
): Promise<{ state: InstalledState; rows: InstalledRow[] }> {
  const view = await installedView(catalog, agents, ctx, adapters);
  const rows = view.matched.filter((row) => scopes.includes(row.scope));
  const state: InstalledState = { installed: new Map(), updates: new Set() };
  for (const row of rows) {
    const plugin = row.plugin as Plugin;
    const entry = state.installed.get(plugin.id) ?? { scopes: [], agents: [], plugin };
    if (!entry.scopes.includes(row.scope)) entry.scopes.push(row.scope);
    for (const agent of row.agents) if (!entry.agents.includes(agent)) entry.agents.push(agent);
    state.installed.set(plugin.id, entry);
  }
  for (const row of outdatedRows(rows)) if (row.status === 'outdated') state.updates.add((row.plugin as Plugin).id);
  return { state, rows };
}

export interface ApplyDeps {
  catalog: Catalog;
  /** Its `log` prints: the wizard has left the screen by now. */
  ctx: AgentContext;
  operate: OperateDeps;
  adapters: Record<AgentId, Adapter>;
  /** The installed rows the wizard was shown. */
  installed: readonly InstalledRow[];
  /** Whether the audit is on for this run. */
  audit: boolean;
  err: (text: string) => void;
  color?: boolean;
}

const paint = (on: boolean | undefined, code: number, text: string) => (on ? `\u001B[${code}m${text}\u001B[0m` : text);

/** Uninstalls, installs and updates what the wizard chose. Returns the summary line, empty for a dry run. */
export async function applyWizard(result: WizardResult, deps: ApplyDeps): Promise<string> {
  const { catalog, ctx, operate, adapters, installed, err } = deps;
  const fail = (text: string) => err(paint(deps.color, 31, `✗ ${text}`));
  // Kept on the review despite a failed audit, or the audit is off: only these go through with `audit: false`.
  const lifted = (plugin: Plugin) => !deps.audit || auditPlugin(plugin).status === 'fail';

  let removed = 0;
  for (const item of result.remove) {
    let ok = true;
    for (const row of installed.filter((r) => r.plugin?.id === item.id && item.scopes.includes(r.scope))) {
      const agent = distinctAgents(row.agents)[0] as AgentId;
      try {
        await adapters[agent].uninstall(row.id, row.scope, ctx);
      } catch (e) {
        ok = false;
        fail(`${item.id} → ${agent}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (ok) removed++;
  }

  const plugins = result.ids.flatMap((id) => catalog.plugins.filter((p) => p.id === id));
  const { agents, scope } = result.options;
  const proposals = [
    ...(await propose(plugins.filter((p) => !lifted(p)), agents, ctx, { scope }, operate)),
    ...(await propose(plugins.filter(lifted), agents, ctx, { scope, audit: false }, operate)),
  ];
  const results = await applyProposals(proposals, ctx, operate);
  for (const r of results) if (r.error || !r.plan) fail(`${r.plugin.id} → ${r.agent}: ${r.error ?? 'no plan'}`);
  const installedCount = plugins.filter((p) => results.some((r) => r.plugin.id === p.id) && results.every((r) => r.plugin.id !== p.id || (r.plan && !r.error))).length;

  const rows = outdatedRows(installed).filter((row) => row.status === 'outdated' && result.update.includes(row.plugin?.id ?? ''));
  let updated = 0;
  for (const row of rows) {
    const plugin = await withComponents(row.plugin as Plugin, operate, ctx.env);
    const agent = distinctAgents(row.agents)[0] as AgentId;
    try {
      await updatePlugin(plugin, agent, row.scope, ctx, { adapters, ...(operate.config ? { config: operate.config } : {}), ...(lifted(plugin) ? { enabled: false } : {}) });
      updated++;
    } catch (e) {
      fail(`${plugin.id} → ${agent}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (ctx.dryRun) return '';
  const r = m.run;
  const part = (done: number, of: number, text: string) => paint(deps.color, done === of ? 35 : 33, text);
  const summary =
    [
      result.ids.length ? part(installedCount, result.ids.length, r.summaryInstalled(installedCount, result.ids.length)) : '',
      result.remove.length ? part(removed, result.remove.length, r.summaryRemoved(removed, result.remove.length)) : '',
      rows.length ? part(updated, rows.length, r.summaryUpdated(updated, rows.length)) : '',
    ]
      .filter(Boolean)
      .join(paint(deps.color, 2, '  ·  ')) || paint(deps.color, 2, r.noChange);
  ctx.log?.(summary);
  return summary;
}
