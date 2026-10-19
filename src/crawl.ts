import { pathToFileURL } from 'node:url';
import { buildCatalog } from './build.js';
import { defaultCatalogPath, saveCatalog } from './catalog.js';
import type { Source } from './source.js';
import { claudePluginsDev } from './sources/claude-plugins-dev.js';
import { githubSearch } from './sources/github-search.js';
import { marketplaceFileSource, OFFICIAL_MARKETPLACES } from './sources/marketplace-file.js';
import type { Catalog } from './types.js';

/** Repositories read without a token: GitHub allows 60 API calls an hour, and each repository costs one. */
const REPO_LIMIT_ANONYMOUS = 40;
const REPO_LIMIT_TOKEN = 3000;

export class CrawlError extends Error {
  readonly name = 'CrawlError';
}

export interface CrawlOptions {
  /** Defaults to the five sources. Tests inject their own. */
  sources?: readonly Source[];
  /** Defaults to `data/catalog.json.gz`. */
  out?: string;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** Passed to the build; tests inject a reader. */
  build?: Partial<Parameters<typeof buildCatalog>[0]>;
}

/** `PLUGINS_ATLAS_REPO_LIMIT` when it is a whole number, else a limit that fits the GitHub rate limit. */
export function repoLimitFor(env: NodeJS.ProcessEnv): number {
  const set = env.PLUGINS_ATLAS_REPO_LIMIT?.trim();
  if (set && /^\d+$/.test(set)) return Number(set);
  return env.GITHUB_TOKEN?.trim() ? REPO_LIMIT_TOKEN : REPO_LIMIT_ANONYMOUS;
}

export function defaultSources(env: NodeJS.ProcessEnv): Source[] {
  return [
    marketplaceFileSource(OFFICIAL_MARKETPLACES.anthropic, { env }),
    marketplaceFileSource(OFFICIAL_MARKETPLACES.codex, { env }),
    marketplaceFileSource(OFFICIAL_MARKETPLACES.cursor, { env }),
    githubSearch({ env }),
    claudePluginsDev({ env }),
  ];
}

/**
 * Builds a snapshot and prints one count per origin, then the merged, official and repository counts.
 * Zero plugins from the official marketplace throws before the file is written. Another empty or failed source is only printed.
 */
export async function crawl(opts: CrawlOptions = {}): Promise<Catalog> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const sources = opts.sources ?? defaultSources(env);
  const catalog = await buildCatalog({ sources, repoLimit: repoLimitFor(env), repo: { env }, ...opts.build });
  for (const source of sources) {
    const report = catalog.stats.sources[source.origin];
    log(report?.status === 'error' ? (report.error ?? `${source.origin}: error`) : `${source.origin}: ${report?.count ?? 0}`);
  }
  const { repos } = catalog.stats;
  log(`merged: ${catalog.stats.merged}`);
  log(`official: ${catalog.stats.official}`);
  log(`repositories: ${repos.read} read, ${repos.failed} failed, ${repos.unread} unread`);
  if ((catalog.stats.raw.official ?? 0) === 0) throw new CrawlError('The official marketplace returned zero plugins');
  await saveCatalog(catalog, opts.out ?? defaultCatalogPath());
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  crawl().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
