import { formatPluginId, IdError, marketplaceSourceId } from './id.js';
import type { MarketplaceSource, Origin, Plugin, RawPlugin } from './types.js';

/** Origins that read the marketplace file itself; the others are directories that copy it. */
const FROM_MARKETPLACE: ReadonlySet<Origin> = new Set(['official', 'github', 'codex', 'cursor']);

function sourceKey(source: MarketplaceSource): string {
  try {
    return marketplaceSourceId(source);
  } catch {
    return JSON.stringify(source);
  }
}

function longer(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.length > a.length ? b : a;
}

/**
 * One entry per `plugin@marketplace`. Origins and keywords are united, the longest description wins,
 * and a version read from the marketplace wins over one a directory reports.
 * Two marketplaces that list the same repository stay two entries, sharing `repository`.
 * A record whose name cannot form an id is dropped.
 */
export function dedupe(raw: readonly RawPlugin[]): Plugin[] {
  const byId = new Map<string, { plugin: Plugin; versionFromMarketplace: boolean; sourceFromMarketplace: boolean }>();
  for (const record of raw) {
    let id: string;
    try {
      id = formatPluginId({ plugin: record.name, marketplace: record.marketplace.name });
    } catch (err) {
      if (err instanceof IdError) continue;
      throw err;
    }
    const fromMarketplace = FROM_MARKETPLACE.has(record.origin);
    const seen = byId.get(id);
    if (!seen) {
      byId.set(id, {
        plugin: {
          id,
          name: record.name,
          marketplace: record.marketplace,
          ...(record.source === undefined ? {} : { source: record.source }),
          ...(record.description === undefined ? {} : { description: record.description }),
          ...(record.version === undefined ? {} : { version: record.version }),
          ...(record.author === undefined ? {} : { author: record.author }),
          ...(record.repository === undefined ? {} : { repository: record.repository }),
          ...(record.category === undefined ? {} : { category: record.category }),
          keywords: [...new Set(record.keywords ?? [])],
          agents: [],
          origins: [record.origin],
          themes: [],
          official: record.origin === 'official',
        },
        versionFromMarketplace: fromMarketplace && record.version !== undefined,
        sourceFromMarketplace: fromMarketplace && record.source !== undefined,
      });
      continue;
    }
    const { plugin } = seen;
    // A marketplace of the same name from another repository is another marketplace: the first one read keeps the id.
    if (sourceKey(record.marketplace.source) !== sourceKey(plugin.marketplace.source)) continue;
    if (fromMarketplace && record.marketplace.file && !plugin.marketplace.file) plugin.marketplace = record.marketplace;
    if (!plugin.origins.includes(record.origin)) plugin.origins.push(record.origin);
    plugin.official ||= record.origin === 'official';
    const description = longer(plugin.description, record.description);
    if (description !== undefined) plugin.description = description;
    if (record.version !== undefined && (plugin.version === undefined || (fromMarketplace && !seen.versionFromMarketplace))) {
      plugin.version = record.version;
      seen.versionFromMarketplace = fromMarketplace;
    }
    // The marketplace's own reading of where the files are beats a directory's copy.
    if (record.source !== undefined && (plugin.source === undefined || (fromMarketplace && !seen.sourceFromMarketplace))) {
      plugin.source = record.source;
      seen.sourceFromMarketplace = fromMarketplace;
    }
    plugin.author ??= record.author;
    plugin.repository ??= record.repository;
    plugin.category ??= record.category;
    plugin.keywords = [...new Set([...plugin.keywords, ...(record.keywords ?? [])])];
  }
  return [...byId.values()].map((entry) => entry.plugin);
}
