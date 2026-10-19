import { join } from 'node:path';
import { agentHome } from '../agents.js';
import { applyEdit } from '../files.js';
import { marketplaceSourceId, parsePluginId } from '../id.js';
import { runSteps, type CliStep } from '../run.js';
import type { MarketplaceSource, Scope } from '../types.js';
import { AdapterError, objectAt, objectsIn, readCommand, readTomlFile, str, type Adapter, type AgentContext, type InstalledEntry } from './common.js';

const EXE = 'codex';

function configPath(scope: Scope, ctx: AgentContext): string {
  if (scope === 'project') return join(ctx.cwd, '.codex', 'config.toml');
  const dir = agentHome('codex-cli', ctx.home, ctx.env);
  if (!dir) throw new AdapterError('Codex has no config folder');
  return join(dir, 'config.toml');
}

function gitUrl(source: MarketplaceSource): string {
  return source.kind === 'github' ? `https://github.com/${source.repo}.git` : source.url;
}

/**
 * Codex CLI and Codex desktop, which share `~/.codex`: `codex plugin …` in the user scope;
 * the project scope is `.codex/config.toml` (`[marketplaces.<name>]`, `[plugins."<id>"]`), since the command has no scope option.
 */
export const codex: Adapter = {
  async known(scope, ctx) {
    const marketplaces = objectAt(await readTomlFile(configPath(scope, ctx)), 'marketplaces');
    return new Map(
      Object.entries(marketplaces).map(([name, entry]) => {
        const url = str((entry as { source?: unknown }).source);
        let id = 'unknown';
        try {
          if (url && (entry as { source_type?: unknown }).source_type === 'git') id = marketplaceSourceId({ kind: 'git', url });
        } catch {
          // Reported as unknown, so the plan refuses to reuse the name.
        }
        return [name, id];
      }),
    );
  },

  async install(plan, _plugin, ctx) {
    if (plan.mechanism === 'cli') {
      const steps: CliStep[] = plan.actions.map((action) => {
        if (action.kind === 'install') return { executable: EXE, args: ['plugin', 'add', action.id, '--json'] };
        const base = action.source.kind === 'github' ? action.source.repo : action.source.url;
        return { executable: EXE, args: ['plugin', 'marketplace', 'add', base, ...(action.source.ref ? ['--ref', action.source.ref] : []), '--json'] };
      });
      await runSteps(steps, ctx);
      return;
    }
    const set = plan.actions.map((action) =>
      action.kind === 'add-marketplace'
        ? { key: ['marketplaces', action.name], value: { source_type: 'git', source: gitUrl(action.source), ...(action.source.ref ? { ref: action.source.ref } : {}) } }
        : { key: ['plugins', action.id, 'enabled'], value: true },
    );
    await applyEdit({ path: configPath(plan.scope, ctx), format: 'toml', set }, ctx);
  },

  async uninstall(id, scope, ctx) {
    if (scope === 'user') {
      const { plugin, marketplace } = parsePluginId(id);
      await runSteps([{ executable: EXE, args: ['plugin', 'remove', plugin, '--marketplace', marketplace, '--json'] }], ctx);
      return;
    }
    await applyEdit({ path: configPath(scope, ctx), format: 'toml', remove: [['plugins', id]] }, ctx);
  },

  async installed(scope, ctx) {
    if (scope === 'project') {
      const plugins = objectAt(await readTomlFile(configPath(scope, ctx)), 'plugins');
      return Object.entries(plugins).map(([id, entry]): InstalledEntry => ({ id, scope, enabled: (entry as { enabled?: unknown }).enabled !== false }));
    }
    const output = await readCommand(EXE, ['plugin', 'list', '--json'], ctx);
    return objectsIn(output, ['installed']).flatMap((entry): InstalledEntry[] => {
      const name = str(entry.name);
      const marketplace = str(entry.marketplaceName) ?? str(entry.marketplace);
      const id = str(entry.pluginId) ?? (name && marketplace ? `${name}@${marketplace}` : name);
      if (!id) return [];
      const version = str(entry.version);
      return [{ id, scope, enabled: entry.enabled !== false, ...(version ? { version } : {}) }];
    });
  },
};
