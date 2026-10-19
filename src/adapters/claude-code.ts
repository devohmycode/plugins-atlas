import { join } from 'node:path';
import { agentHome } from '../agents.js';
import { runSteps, type CliStep } from '../run.js';
import type { Scope } from '../types.js';
import { AdapterError, marketplaceArg, objectAt, objectsIn, readCommand, readJsonFile, entrySourceId, str, type Adapter, type AgentContext } from './common.js';

const EXE = 'claude';

function home(ctx: AgentContext): string {
  const dir = agentHome('claude-code', ctx.home, ctx.env);
  if (!dir) throw new AdapterError('Claude Code has no config folder');
  return dir;
}

export function claudeSettingsPath(scope: Scope, ctx: AgentContext): string {
  return scope === 'user' ? join(home(ctx), 'settings.json') : join(ctx.cwd, '.claude', 'settings.json');
}

/** `CLAUDE_CODE_PLUGIN_CACHE_DIR`, else `<config>/plugins` (docs/agents.md). */
function pluginsDir(ctx: AgentContext): string {
  return ctx.env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim() || join(home(ctx), 'plugins');
}

/** Claude Code: `claude plugin …` in both scopes (docs/agents.md). */
export const claudeCode: Adapter = {
  async known(scope, ctx) {
    const known = new Map<string, string>();
    // `known_marketplaces.json` holds every added marketplace; the settings add the declared ones of this scope.
    const registry = await readJsonFile(join(pluginsDir(ctx), 'known_marketplaces.json'));
    for (const [name, entry] of Object.entries(registry)) known.set(name, entrySourceId(entry));
    const declared = objectAt(await readJsonFile(claudeSettingsPath(scope, ctx)), 'extraKnownMarketplaces');
    for (const [name, entry] of Object.entries(declared)) if (!known.has(name)) known.set(name, entrySourceId(entry));
    return known;
  },

  async install(plan, _plugin, ctx) {
    const steps: CliStep[] = plan.actions.map((action) =>
      action.kind === 'add-marketplace'
        ? { executable: EXE, args: ['plugin', 'marketplace', 'add', marketplaceArg(action.source), '--scope', plan.scope] }
        : { executable: EXE, args: ['plugin', 'install', action.id, '--scope', plan.scope] },
    );
    await runSteps(steps, ctx);
  },

  async uninstall(id, scope, ctx) {
    await runSteps([{ executable: EXE, args: ['plugin', 'uninstall', id, '--scope', scope] }], ctx);
  },

  async update(id, scope, ctx) {
    await runSteps([{ executable: EXE, args: ['plugin', 'update', id, '--scope', scope] }], ctx);
    return true;
  },

  async installed(scope, ctx) {
    const output = await readCommand(EXE, ['plugin', 'list', '--json'], ctx);
    return objectsIn(output, ['plugins', 'installed']).flatMap((entry) => {
      const id = str(entry.id) ?? str(entry.name);
      if (!id || (str(entry.scope) ?? 'user') !== scope) return [];
      const version = str(entry.version);
      return [{ id, scope, enabled: entry.enabled !== false, ...(version ? { version } : {}) }];
    });
  },
};
