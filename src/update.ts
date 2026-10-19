import { ADAPTERS, type Adapter, type AgentContext } from './adapters/index.js';
import type { InstalledRow } from './installed.js';
import { planInstall } from './plan.js';
import type { AgentId, Plugin } from './types.js';

export type VersionStatus = 'current' | 'outdated' | 'unknown';

function parts(version: string): number[] | undefined {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(version.trim());
  return match?.[1]?.split('.').map(Number);
}

/** `unknown` without an installed version or a catalog version: never "up to date" by default. */
export function versionStatus(installed: string | undefined, latest: string | undefined): VersionStatus {
  if (installed === undefined || latest === undefined) return 'unknown';
  const a = parts(installed);
  const b = parts(latest);
  if (!a || !b) return installed === latest ? 'current' : 'outdated';
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 'outdated' : 'current';
  }
  return 'current';
}

/** Installed rows whose catalog entry is newer, or whose version cannot be told. */
export function outdatedRows(rows: readonly InstalledRow[]): (InstalledRow & { status: VersionStatus })[] {
  return rows
    .map((row) => ({ ...row, status: versionStatus(row.version, row.plugin?.version) }))
    .filter((row) => row.status !== 'current');
}

export interface UpdateOptions {
  config?: { audit?: boolean };
  enabled?: boolean;
  adapters?: Record<AgentId, Adapter>;
}

/**
 * Updates one installed plugin for one agent. The audit and checks of T27 run first, so a plugin that turned risky
 * is refused before anything changes. Then the agent's own update command, or uninstall and install again.
 */
export async function updatePlugin(plugin: Plugin, agent: AgentId, scope: InstalledRow['scope'], ctx: AgentContext, opts: UpdateOptions = {}): Promise<void> {
  const adapter = (opts.adapters ?? ADAPTERS)[agent];
  const known = await adapter.known(scope, ctx);
  const [plan] = planInstall({ plugin, agents: [agent], scope, known: () => known, ...opts });
  if (!plan) return;
  if (adapter.update && (await adapter.update(plugin.id, scope, ctx))) return;
  await adapter.uninstall(plugin.id, scope, ctx);
  const again = await adapter.known(scope, ctx);
  const [fresh] = planInstall({ plugin, agents: [agent], scope, known: () => again, ...opts });
  if (fresh) await adapter.install(fresh, plugin, ctx);
}
