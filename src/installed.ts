import { ADAPTERS, type Adapter, type AgentContext } from './adapters/index.js';
import { AGENTS, distinctAgents } from './agents.js';
import type { AgentId, Catalog, Plugin, Scope } from './types.js';

export interface InstalledRow {
  /** The agents that share this install: Codex CLI and Codex desktop count once. */
  agents: AgentId[];
  scope: Scope;
  /** As the agent reports it. */
  id: string;
  enabled: boolean;
  version?: string;
  /** The catalog entry, when the id names one. */
  plugin?: Plugin;
}

export interface InstalledView {
  matched: InstalledRow[];
  /** Entries no catalog id matches. They are listed, not forced into an id. */
  unknown: InstalledRow[];
  /** Agents whose list could not be read, each named. */
  errors: { agent: AgentId; scope: Scope; error: string }[];
}

/** `plugin@marketplace` matches its id; a bare name matches only when one catalog plugin has it. */
function match(catalog: Catalog, id: string): Plugin | undefined {
  if (id.includes('@')) return catalog.plugins.find((plugin) => plugin.id === id);
  const named = catalog.plugins.filter((plugin) => plugin.name === id);
  return named.length === 1 ? named[0] : undefined;
}

/** Reads every scope of every agent, and ties each entry to the catalog. Nothing is written. */
export async function installedView(
  catalog: Catalog,
  agents: readonly AgentId[],
  ctx: AgentContext,
  adapters: Record<AgentId, Adapter> = ADAPTERS,
): Promise<InstalledView> {
  const view: InstalledView = { matched: [], unknown: [], errors: [] };
  for (const agent of distinctAgents(agents)) {
    const shared = agents.filter((id) => id === agent || AGENTS[id].sharesWith === agent);
    for (const scope of Object.keys(AGENTS[agent].install) as Scope[]) {
      let entries;
      try {
        entries = await adapters[agent].installed(scope, ctx);
      } catch (err) {
        view.errors.push({ agent, scope, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      for (const entry of entries) {
        const plugin = match(catalog, entry.id);
        const row: InstalledRow = { agents: shared, ...entry, ...(plugin ? { plugin } : {}) };
        (plugin ? view.matched : view.unknown).push(row);
      }
    }
  }
  return view;
}
