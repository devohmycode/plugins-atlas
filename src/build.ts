import { classify } from './classify.js';
import { compatibleAgents } from './compat.js';
import { dedupe } from './dedupe.js';
import { readPluginRepo, type PluginFiles, type RepoOptions } from './repo.js';
import type { Source } from './source.js';
import { THEMES } from './taxonomy.js';
import type { Catalog, CatalogStats, Plugin, RawPlugin } from './types.js';

/** Failed repository reads kept by name in the stats. */
const MAX_REPO_ERRORS = 50;
/** Plugin repositories read at once. */
const CONCURRENCY = 4;

export class CatalogError extends Error {
  readonly name = 'CatalogError';
}

export interface BuildOptions {
  /** The upstreams to read. One failed source is skipped; every source failing aborts. */
  sources: readonly Source[];
  /** Overrides the snapshot clock. */
  generatedAt?: string;
  /** Reads one plugin's files. Defaults to {@link readPluginRepo}; injected in tests. */
  readRepo?: (plugin: Plugin) => Promise<PluginFiles | undefined>;
  /** Network options of the default `readRepo`. */
  repo?: RepoOptions;
  /** At most this many repositories are read, official plugins first. The rest stay "composants inconnus". */
  repoLimit?: number;
}

/** Reads the sources, dedupes, reads each plugin's files, works out its agents, classifies, and counts. Nothing is run. */
export async function buildCatalog(opts: BuildOptions): Promise<Catalog> {
  const settled = await Promise.allSettled(opts.sources.map((source) => source.fetch()));
  if (settled.every((result) => result.status === 'rejected')) {
    const detail = opts.sources.map((source, i) => `${source.origin}: ${errorText((settled[i] as PromiseRejectedResult).reason)}`).join('; ');
    throw new CatalogError(detail ? `Every catalog source failed: ${detail}` : 'Every catalog source failed');
  }

  const raw: RawPlugin[] = [];
  const stats = emptyStats();
  opts.sources.forEach((source, i) => {
    const result = settled[i];
    const previous = stats.raw[source.origin] ?? 0;
    if (result?.status === 'fulfilled') {
      raw.push(...result.value);
      stats.raw[source.origin] = previous + result.value.length;
      stats.sources[source.origin] = { status: 'ok', count: previous + result.value.length };
      return;
    }
    stats.raw[source.origin] = previous;
    if (previous === 0) stats.sources[source.origin] = { status: 'error', count: 0, error: `${source.origin}: ${errorText(result?.reason)}` };
  });

  const plugins = dedupe(raw);
  await readRepos(plugins, opts, stats);
  for (const plugin of plugins) {
    plugin.themes = classify(plugin);
    stats.merged += 1;
    if (plugin.official) stats.official += 1;
    for (const theme of plugin.themes) stats.byTheme[theme] = (stats.byTheme[theme] ?? 0) + 1;
    for (const agent of plugin.agents) stats.byAgent[agent] = (stats.byAgent[agent] ?? 0) + 1;
  }
  return { version: 1, generatedAt: opts.generatedAt ?? new Date().toISOString(), themes: [...THEMES], plugins, stats };
}

async function readRepos(plugins: Plugin[], opts: BuildOptions, stats: CatalogStats): Promise<void> {
  const trees = new Map<string, Promise<string[]>>();
  const read =
    opts.readRepo ??
    ((plugin: Plugin) => (plugin.source ? readPluginRepo(plugin.source, plugin.marketplace.source, { ...opts.repo, trees }) : Promise.resolve(undefined)));
  const queue = plugins.filter((plugin) => plugin.source).sort((a, b) => Number(b.official) - Number(a.official));
  const limit = opts.repoLimit ?? Infinity;
  const picked = queue.slice(0, limit);
  stats.repos.unread = plugins.length - picked.length;
  for (let i = 0; i < picked.length; i += CONCURRENCY) {
    const batch = picked.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(read));
    settled.forEach((outcome, j) => {
      const plugin = batch[j] as Plugin;
      if (outcome.status === 'rejected') {
        stats.repos.failed += 1;
        if (stats.repoErrors.length < MAX_REPO_ERRORS) stats.repoErrors.push({ id: plugin.id, error: errorText(outcome.reason) });
        return;
      }
      if (!outcome.value) {
        stats.repos.unread += 1;
        return;
      }
      stats.repos.read += 1;
      plugin.components = outcome.value.components;
      plugin.agents = compatibleAgents({ files: outcome.value.files, ...(plugin.marketplace.file ? { marketplaceFile: plugin.marketplace.file } : {}) });
    });
  }
}

function emptyStats(): CatalogStats {
  const byTheme: Record<string, number> = {};
  for (const theme of THEMES) byTheme[theme.id] = 0;
  return { raw: {}, sources: {}, merged: 0, official: 0, byTheme, byAgent: {}, repos: { read: 0, failed: 0, unread: 0 }, repoErrors: [] };
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 300);
}
