import { fetchJson, type FetchOptions } from '../http.js';
import { parseMarketplace } from '../marketplace.js';
import type { Source } from '../source.js';
import type { Origin, RawPlugin } from '../types.js';

export interface MarketplaceFile {
  origin: Origin;
  /** `owner/repo` on GitHub. */
  repo: string;
  /** The marketplace file, relative to the repository root. */
  file: string;
  ref?: string;
}

/** Reads one marketplace file from GitHub. Its entries become raw plugins of `origin`. */
export async function readMarketplaceFile(target: MarketplaceFile, opts: FetchOptions = {}): Promise<RawPlugin[]> {
  const revision = target.ref ?? 'HEAD';
  const url = `https://raw.githubusercontent.com/${target.repo}/${encodeURIComponent(revision)}/${target.file}`;
  const source = { kind: 'github' as const, repo: target.repo, ...(target.ref ? { ref: target.ref } : {}) };
  const parsed = parseMarketplace(await fetchJson(url, opts), target.origin, source);
  return parsed.plugins.map((plugin) => ({ ...plugin, marketplace: { ...plugin.marketplace, file: target.file } }));
}

export function marketplaceFileSource(target: MarketplaceFile, opts: FetchOptions = {}): Source {
  return { origin: target.origin, fetch: () => readMarketplaceFile(target, opts) };
}

/** The official marketplaces of docs/agents.md, read on 2026-10-19. */
export const OFFICIAL_MARKETPLACES = {
  anthropic: { origin: 'official', repo: 'anthropics/claude-plugins-official', file: '.claude-plugin/marketplace.json' },
  codex: { origin: 'codex', repo: 'openai/plugins', file: '.agents/plugins/marketplace.json' },
  cursor: { origin: 'cursor', repo: 'cursor/plugins', file: '.cursor-plugin/marketplace.json' },
} as const satisfies Record<string, MarketplaceFile>;
