import { z } from 'zod';
import { fetchJsonPages, type FetchOptions } from '../http.js';
import { ContractError, type Source } from '../source.js';
import type { RawPlugin } from '../types.js';
import { readMarketplaceFile } from './marketplace-file.js';

const FILE = '.claude-plugin/marketplace.json';
const QUERY = 'filename:marketplace.json path:.claude-plugin';
const PER_PAGE = 100;
/** GitHub code search returns at most 1,000 results. */
const MAX_PAGES = 10;
/** Marketplace files read at once. */
const CONCURRENCY = 4;

export class MissingTokenError extends Error {
  readonly name = 'MissingTokenError';
  constructor() {
    super('skipped, GITHUB_TOKEN is not set');
  }
}

const pageSchema = z.object({
  items: z.array(z.object({ path: z.string(), repository: z.object({ full_name: z.string(), fork: z.boolean().optional() }) })),
});

/** Names Claude Code reserves; a copy outside Anthropic's organisation is not that marketplace. */
function impersonates(name: string, repo: string): boolean {
  const reserved = name === 'claude-plugins-official' || name.startsWith('anthropic');
  return reserved && !repo.toLowerCase().startsWith('anthropics/');
}

export interface SearchResult {
  plugins: RawPlugin[];
  /** Repositories whose marketplace file could not be read or was refused, each with why. */
  failed: { repo: string; error: string }[];
}

export async function searchMarketplaces(opts: FetchOptions = {}): Promise<SearchResult> {
  const env = opts.env ?? process.env;
  if (!env.GITHUB_TOKEN?.trim()) throw new MissingTokenError();
  const read = (body: unknown) => {
    const page = pageSchema.safeParse(body);
    if (!page.success) throw new ContractError('github', `search page: ${page.error.issues[0]?.path.join('.') ?? '?'}`);
    return { items: page.data.items };
  };
  const items: z.infer<typeof pageSchema>['items'] = [];
  // Pages 1 to 10, until one comes back short.
  for (let page = 1; page <= MAX_PAGES && items.length === (page - 1) * PER_PAGE; page++) {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(QUERY)}&per_page=${PER_PAGE}&page=${page}`;
    items.push(...(await fetchJsonPages(url, read, { ...opts, maxPages: 1 })));
  }
  const repos = [...new Set(items.filter((item) => item.path === FILE && !item.repository.fork).map((item) => item.repository.full_name))];
  const result: SearchResult = { plugins: [], failed: [] };
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((repo) => readMarketplaceFile({ origin: 'github', repo, file: FILE }, opts)));
    settled.forEach((outcome, j) => {
      const repo = batch[j] as string;
      if (outcome.status === 'rejected') {
        result.failed.push({ repo, error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
        return;
      }
      const name = outcome.value[0]?.marketplace.name;
      if (name !== undefined && impersonates(name, repo)) {
        result.failed.push({ repo, error: `uses the reserved name ${name}` });
        return;
      }
      result.plugins.push(...outcome.value);
    });
  }
  return result;
}

/** Marketplaces found by GitHub code search. Without `GITHUB_TOKEN` it fails with {@link MissingTokenError}, so the build names and skips it. */
export function githubSearch(opts: FetchOptions = {}): Source {
  return { origin: 'github', fetch: async () => (await searchMarketplaces(opts)).plugins };
}
