import { join } from 'node:path';
import { agentHome } from '../agents.js';
import { runSteps, type CliStep } from '../run.js';
import type { Scope } from '../types.js';
import { AdapterError, entrySourceId, marketplaceArg, objectAt, readJsonFile, type Adapter, type AgentContext, type InstalledEntry } from './common.js';

const EXE = 'droid';

function settingsPath(scope: Scope, ctx: AgentContext): string {
  if (scope === 'project') return join(ctx.cwd, '.factory', 'settings.json');
  const dir = agentHome('droid', ctx.home, ctx.env);
  if (!dir) throw new AdapterError('Droid has no config folder');
  return join(dir, 'settings.json');
}

/**
 * Factory Droid: `droid plugin …` with `--scope user|project`. Its listing has no documented JSON output,
 * so the installed and known lists come from `enabledPlugins` and `extraKnownMarketplaces` of its settings.
 */
export const droid: Adapter = {
  async known(scope, ctx) {
    const declared = objectAt(await readJsonFile(settingsPath(scope, ctx)), 'extraKnownMarketplaces');
    return new Map(Object.entries(declared).map(([name, entry]) => [name, entrySourceId(entry)]));
  },

  async install(plan, _plugin, ctx) {
    const steps: CliStep[] = plan.actions.map((action) =>
      action.kind === 'add-marketplace'
        ? { executable: EXE, args: ['plugin', 'marketplace', 'add', marketplaceArg(action.source)] }
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
    const enabled = objectAt(await readJsonFile(settingsPath(scope, ctx)), 'enabledPlugins');
    return Object.entries(enabled).map(([id, on]): InstalledEntry => ({ id, scope, enabled: on === true }));
  },
};
