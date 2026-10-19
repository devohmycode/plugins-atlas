import { ADAPTERS, type Adapter, type AgentContext } from './adapters/index.js';
import { distinctAgents } from './agents.js';
import { compatibleAgents } from './compat.js';
import { planInstall, type InstallPlan } from './plan.js';
import { readPluginRepo, type RepoOptions } from './repo.js';
import type { AgentId, Plugin, Scope } from './types.js';

/** What the CLI, the tree, the local page and the MCP server share to install. */
export interface OperateDeps {
  adapters?: Record<AgentId, Adapter>;
  /** Network options when a plugin's repository is read at install time. */
  repo?: RepoOptions;
  config?: { audit?: boolean };
  /** Notes on stderr (a repository that could not be read). */
  warn?: (text: string) => void;
}

/**
 * A plugin whose repository the crawl did not read is read now, so its agents and audit are known before
 * anything is planned. A read that fails leaves it as it is: "composants inconnus", and the plan refuses it.
 */
export async function withComponents(plugin: Plugin, deps: OperateDeps = {}, env: NodeJS.ProcessEnv = process.env): Promise<Plugin> {
  if (plugin.components || !plugin.source) return plugin;
  try {
    const files = await readPluginRepo(plugin.source, plugin.marketplace.source, deps.repo ?? { env });
    if (!files) return plugin;
    const agents = compatibleAgents({ files: files.files, ...(plugin.marketplace.file ? { marketplaceFile: plugin.marketplace.file } : {}) });
    return { ...plugin, components: files.components, agents };
  } catch (e) {
    deps.warn?.(`${plugin.id}: its repository could not be read (${e instanceof Error ? e.message : String(e)})`);
    return plugin;
  }
}

/** One plugin for one agent: a plan, or why there is none. */
export interface Proposal {
  plugin: Plugin;
  agent: AgentId;
  scope: Scope;
  plan?: InstallPlan;
  error?: string;
}

export interface ProposeOptions {
  scope: Scope;
  /** `false` for `--no-audit` on this run. */
  audit?: boolean;
  /** Named by the user: an incompatible one is reported. Otherwise only the compatible ones are proposed. */
  explicit?: boolean;
}

/** Plans each plugin for each agent. Nothing is written or run, except reading what each agent already knows. */
export async function propose(plugins: readonly Plugin[], agents: readonly AgentId[], ctx: AgentContext, opts: ProposeOptions, deps: OperateDeps = {}): Promise<Proposal[]> {
  const adapters = deps.adapters ?? ADAPTERS;
  const proposals: Proposal[] = [];
  const known = new Map<AgentId, Map<string, string>>();
  for (const found of plugins) {
    const plugin = await withComponents(found, deps, ctx.env);
    const targets = distinctAgents(agents).filter((agent) => opts.explicit || plugin.agents.includes(agent));
    if (targets.length === 0) {
      proposals.push({ plugin, agent: agents[0] as AgentId, scope: opts.scope, error: `no chosen agent reads its manifests (${plugin.agents.join(', ') || 'none known'})` });
      continue;
    }
    for (const agent of targets) {
      try {
        if (!known.has(agent)) known.set(agent, await adapters[agent].known(opts.scope, ctx));
        const [plan] = planInstall({
          plugin,
          agents: [agent],
          scope: opts.scope,
          known: () => known.get(agent) ?? new Map(),
          ...(deps.config ? { config: deps.config } : {}),
          ...(opts.audit === undefined ? {} : { enabled: opts.audit }),
        });
        proposals.push({ plugin, agent, scope: opts.scope, ...(plan ? { plan } : {}) });
      } catch (e) {
        proposals.push({ plugin, agent, scope: opts.scope, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return proposals;
}

/** Runs the planned proposals. A failure is kept on its proposal and the others go on. */
export async function applyProposals(proposals: readonly Proposal[], ctx: AgentContext, deps: OperateDeps = {}): Promise<Proposal[]> {
  const adapters = deps.adapters ?? ADAPTERS;
  const results: Proposal[] = [];
  for (const proposal of proposals) {
    if (!proposal.plan) {
      results.push(proposal);
      continue;
    }
    try {
      await adapters[proposal.agent].install(proposal.plan, proposal.plugin, ctx);
      results.push(proposal);
    } catch (e) {
      results.push({ ...proposal, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

export function describe(plan: InstallPlan): string {
  return plan.actions.map((a) => (a.kind === 'install' ? `install ${a.id}` : `add marketplace ${a.name}`)).join(', ');
}
