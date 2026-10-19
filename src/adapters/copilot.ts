import { join } from 'node:path';
import { agentHome } from '../agents.js';
import { applyEdit } from '../files.js';
import { parsePluginId } from '../id.js';
import { runSteps, type CliStep } from '../run.js';
import type { Scope } from '../types.js';
import {
  AdapterError,
  entrySourceId,
  marketplaceArg,
  objectAt,
  objectsIn,
  readCommand,
  readJsonFile,
  settingsSource,
  str,
  type Adapter,
  type AgentContext,
  type InstalledEntry,
} from './common.js';

const EXE = 'copilot';

function settingsPath(scope: Scope, ctx: AgentContext): string {
  if (scope === 'project') return join(ctx.cwd, '.github', 'copilot', 'settings.json');
  const dir = agentHome('copilot-cli', ctx.home, ctx.env);
  if (!dir) throw new AdapterError('Copilot CLI has no config folder');
  return join(dir, 'settings.json');
}

/**
 * GitHub Copilot CLI: `copilot plugin …` in the user scope; the repository scope is
 * `.github/copilot/settings.json` (`extraKnownMarketplaces`, `enabledPlugins`), since the command has no scope option.
 */
export const copilot: Adapter = {
  async known(scope, ctx) {
    const known = new Map<string, string>();
    const declared = objectAt(await readJsonFile(settingsPath(scope, ctx)), 'extraKnownMarketplaces');
    for (const [name, entry] of Object.entries(declared)) known.set(name, entrySourceId(entry));
    if (scope === 'user') {
      const output = await readCommand(EXE, ['plugin', 'marketplace', 'list', '--json'], ctx);
      for (const entry of objectsIn(output, ['marketplaces'])) {
        const name = str(entry.name);
        if (name && !known.has(name)) known.set(name, entrySourceId(entry));
      }
    }
    return known;
  },

  async install(plan, _plugin, ctx) {
    if (plan.mechanism === 'cli') {
      const steps: CliStep[] = plan.actions.map((action) =>
        action.kind === 'add-marketplace'
          ? { executable: EXE, args: ['plugin', 'marketplace', 'add', marketplaceArg(action.source)] }
          : { executable: EXE, args: ['plugin', 'install', action.id] },
      );
      await runSteps(steps, ctx);
      return;
    }
    // shortcut: the `source` shape of Copilot's `extraKnownMarketplaces` is undocumented; Claude's shape is written,
    // which Copilot also reads from `.claude/settings.json`. Check it against Copilot when T46 runs on a real machine.
    const set = plan.actions.map((action) =>
      action.kind === 'add-marketplace'
        ? { key: ['extraKnownMarketplaces', action.name], value: { source: settingsSource(action.source) } }
        : { key: ['enabledPlugins', action.id], value: true },
    );
    await applyEdit({ path: settingsPath(plan.scope, ctx), format: 'json', set }, ctx);
  },

  async uninstall(id, scope, ctx) {
    if (scope === 'user') {
      await runSteps([{ executable: EXE, args: ['plugin', 'uninstall', parsePluginId(id).plugin] }], ctx);
      return;
    }
    await applyEdit({ path: settingsPath(scope, ctx), format: 'json', remove: [['enabledPlugins', id]] }, ctx);
  },

  async update(id, scope, ctx) {
    // The repository scope is a settings file: Copilot fetches on its own, so it is reinstalled instead.
    if (scope !== 'user') return false;
    await runSteps([{ executable: EXE, args: ['plugin', 'update', parsePluginId(id).plugin] }], ctx);
    return true;
  },

  async installed(scope, ctx) {
    if (scope === 'project') {
      const enabled = objectAt(await readJsonFile(settingsPath(scope, ctx)), 'enabledPlugins');
      return Object.entries(enabled).map(([id, on]): InstalledEntry => ({ id, scope, enabled: on === true }));
    }
    const output = await readCommand(EXE, ['plugin', 'list', '--json'], ctx);
    return objectsIn(output, ['plugins', 'installed']).flatMap((entry): InstalledEntry[] => {
      const name = str(entry.name);
      if (!name) return [];
      const marketplace = str(entry.marketplace);
      const version = str(entry.version);
      return [{ id: marketplace ? `${name}@${marketplace}` : name, scope, enabled: entry.enabled !== false, ...(version ? { version } : {}) }];
    });
  },
};
