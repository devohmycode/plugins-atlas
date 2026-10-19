import type { AgentId, Catalog, Plugin } from './types.js';

export interface SearchQuery {
  /** Words matched against name, description, keywords and id. All must match. */
  query?: string;
  /** Exact theme id. */
  theme?: string;
  /** Keep only plugins this agent can install. */
  agent?: AgentId;
  /** When true, keep only official plugins. */
  official?: boolean;
}

/** Filters a snapshot. Official plugins seen in several origins come first, then official ones, then `id`. */
export function searchCatalog(catalog: Catalog, query: SearchQuery = {}): Plugin[] {
  return searchPlugins(catalog.plugins, query);
}

export function searchPlugins(plugins: readonly Plugin[], query: SearchQuery = {}): Plugin[] {
  const tokens = (query.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return plugins
    .filter((plugin) => {
      if (query.official === true && !plugin.official) return false;
      if (query.theme !== undefined && !plugin.themes.includes(query.theme)) return false;
      if (query.agent !== undefined && !plugin.agents.includes(query.agent)) return false;
      if (tokens.length === 0) return true;
      const haystack = [plugin.name, plugin.description ?? '', ...plugin.keywords, plugin.id].join('\n').toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

function rank(plugin: Plugin): number {
  if (plugin.official && plugin.origins.length > 1) return 0;
  return plugin.official ? 1 : 2;
}
