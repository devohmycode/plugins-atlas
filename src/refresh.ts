import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeCatalog, defaultCatalogPath } from './catalog.js';
import { USER_AGENT } from './http.js';
import type { Catalog } from './types.js';

/** Placeholder until a snapshot is published. Callers and tests pass `url`. */
export const REMOTE_CATALOG_URL = 'https://github.com/devohmycode/plugins-atlas/raw/main/data/catalog.json.gz';
/** How long a check is trusted before asking again. */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;

export function cacheDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.XDG_CACHE_HOME?.trim() || join(home, '.cache');
  return join(base, 'plugins-atlas');
}

interface CacheMeta {
  etag?: string;
  /** Last time the remote snapshot was asked for, successfully or not (ms). */
  checkedAt: number;
}

export interface LatestOptions {
  /** Never download. The cache or the bundled snapshot is used, even when `--refresh` is also set. */
  offline?: boolean;
  /** Ask now, however recent the last check. */
  refresh?: boolean;
  bundledPath?: string;
  dir?: string;
  url?: string;
  now?: number;
  fetch?: typeof fetch;
}

/**
 * The newest snapshot: a cached download or the one bundled in the package,
 * by `generatedAt`. A failed download is not fatal. It still counts as the
 * check, so the next one waits 12 hours unless `refresh` is set. `offline`
 * never fetches.
 */
export async function loadLatestCatalog(opts: LatestOptions = {}): Promise<Catalog> {
  const dir = opts.dir ?? cacheDir();
  const file = join(dir, 'catalog.json.gz');
  const metaFile = join(dir, 'catalog.meta.json');
  const now = opts.now ?? Date.now();
  const doFetch = opts.fetch ?? fetch;

  let cached = await tryDecode(file);
  const meta = await readMeta(metaFile);
  const stale = opts.refresh === true || meta === undefined || now - meta.checkedAt >= MAX_AGE_MS;

  if (opts.offline !== true && stale) {
    try {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/gzip' };
      if (cached && meta?.etag) headers['if-none-match'] = meta.etag;
      const res = await doFetch(opts.url ?? REMOTE_CATALOG_URL, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 304 && cached) {
        await writeMeta(dir, metaFile, { etag: meta?.etag, checkedAt: now });
      } else if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        cached = decodeCatalog(buf);
        await writeCache(dir, file, metaFile, buf, { etag: res.headers.get('etag') ?? undefined, checkedAt: now });
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      await writeMeta(dir, metaFile, { etag: meta?.etag, checkedAt: now });
    }
  }

  const bundled = await tryDecode(opts.bundledPath ?? defaultCatalogPath());
  const newest = [cached, bundled]
    .filter((item): item is Catalog => item !== undefined)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  if (!newest) throw new Error('No catalog available. Check the connection or use a bundled snapshot.');
  return newest;
}

async function tryDecode(path: string): Promise<Catalog | undefined> {
  try {
    if (!existsSync(path)) return undefined;
    return decodeCatalog(await readFile(path));
  } catch {
    return undefined;
  }
}

async function readMeta(path: string): Promise<CacheMeta | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { etag?: unknown; checkedAt?: unknown };
    if (typeof parsed.checkedAt !== 'number') return undefined;
    return { checkedAt: parsed.checkedAt, etag: typeof parsed.etag === 'string' ? parsed.etag : undefined };
  } catch {
    return undefined;
  }
}

async function writeMeta(dir: string, metaFile: string, meta: CacheMeta): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(metaFile, `${JSON.stringify(meta)}\n`);
  } catch {
    // A read-only cache only means the next run checks again.
  }
}

async function writeCache(dir: string, file: string, metaFile: string, buf: Buffer, meta: CacheMeta): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
    await writeFile(metaFile, `${JSON.stringify(meta)}\n`);
  } catch {
    // Kept in memory for this run. The next check tries again.
  }
}
