import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { decodeCatalog } from '../src/catalog.js';
import { USER_AGENT } from '../src/http.js';
import { cacheDir, loadLatestCatalog, MAX_AGE_MS } from '../src/refresh.js';
import type { Catalog } from '../src/types.js';

const URL = 'https://example.test/catalog.json.gz';
const NOW = 1_800_000_000_000;

function snapshot(generatedAt: string): Catalog {
  return {
    version: 1,
    generatedAt,
    themes: [],
    plugins: [],
    stats: { raw: {}, sources: {}, merged: 0, official: 0, byTheme: {}, byAgent: {}, repos: { read: 0, failed: 0, unread: 0 }, repoErrors: [] },
  };
}

function gzip(catalog: Catalog): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(catalog)));
}

function stage(): { dir: string; bundled: string } {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-atlas-refresh-'));
  const bundled = join(dir, 'bundled.json.gz');
  writeFileSync(bundled, gzip(snapshot('2020-01-01T00:00:00.000Z')));
  return { dir, bundled };
}

function meta(dir: string, checkedAt: number, etag?: string): void {
  writeFileSync(join(dir, 'catalog.meta.json'), `${JSON.stringify({ checkedAt, etag })}\n`);
}

it('keeps the cache under XDG_CACHE_HOME or ~/.cache/plugins-atlas', () => {
  expect(cacheDir({ XDG_CACHE_HOME: '/var/cache' }, '/home/ada').replaceAll('\\', '/')).toBe('/var/cache/plugins-atlas');
  expect(cacheDir({}, '/home/ada').replaceAll('\\', '/')).toBe('/home/ada/.cache/plugins-atlas');
});

it('serves the bundled snapshot offline and does not fetch', async () => {
  const { dir, bundled } = stage();
  let calls = 0;
  try {
    const catalog = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      offline: true,
      refresh: true,
      now: NOW,
      url: URL,
      fetch: () => {
        calls += 1;
        throw new Error('network');
      },
    });
    expect(calls).toBe(0);
    expect(catalog.generatedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(existsSync(join(dir, 'catalog.json.gz'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('returns the newer of the cache and the bundled snapshot', async () => {
  const { dir, bundled } = stage();
  writeFileSync(join(dir, 'catalog.json.gz'), gzip(snapshot('2026-06-01T00:00:00.000Z')));
  try {
    const catalog = await loadLatestCatalog({ dir, bundledPath: bundled, offline: true, now: NOW, url: URL });
    expect(catalog.generatedAt).toBe('2026-06-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('does not check again for 12 hours', async () => {
  const { dir, bundled } = stage();
  writeFileSync(join(dir, 'catalog.json.gz'), gzip(snapshot('2026-06-01T00:00:00.000Z')));
  meta(dir, NOW - MAX_AGE_MS + 1);
  let calls = 0;
  try {
    const catalog = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      now: NOW,
      url: URL,
      fetch: () => {
        calls += 1;
        throw new Error('network');
      },
    });
    expect(calls).toBe(0);
    expect(catalog.generatedAt).toBe('2026-06-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('checks when the cache is 12 hours old and keeps a validated snapshot', async () => {
  const { dir, bundled } = stage();
  writeFileSync(join(dir, 'catalog.json.gz'), gzip(snapshot('2024-01-01T00:00:00.000Z')));
  meta(dir, NOW - MAX_AGE_MS);
  const fresh = gzip(snapshot('2026-08-01T00:00:00.000Z'));
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    expect(String(input)).toBe(URL);
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
    return new Response(new Uint8Array(fresh), { status: 200, headers: { etag: '"v2"' } });
  };
  try {
    const catalog = await loadLatestCatalog({ dir, bundledPath: bundled, now: NOW, url: URL, fetch: fetchImpl });
    expect(catalog.generatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(decodeCatalog(readFileSync(join(dir, 'catalog.json.gz'))).generatedAt).toBe('2026-08-01T00:00:00.000Z');
    const saved = JSON.parse(readFileSync(join(dir, 'catalog.meta.json'), 'utf8')) as { etag: string; checkedAt: number };
    expect(saved).toEqual({ etag: '"v2"', checkedAt: NOW });

    const again = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      now: NOW + 1,
      url: URL,
      fetch: () => {
        calls += 1;
        throw new Error('network');
      },
    });
    expect(calls).toBe(1);
    expect(again.generatedAt).toBe('2026-08-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('forces a check with refresh', async () => {
  const { dir, bundled } = stage();
  writeFileSync(join(dir, 'catalog.json.gz'), gzip(snapshot('2026-06-01T00:00:00.000Z')));
  meta(dir, NOW);
  let calls = 0;
  try {
    await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      refresh: true,
      now: NOW,
      url: URL,
      fetch: async () => {
        calls += 1;
        return new Response(new Uint8Array(gzip(snapshot('2026-09-01T00:00:00.000Z'))), { status: 200 });
      },
    });
    expect(calls).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('keeps the bundled snapshot when the download fails, and waits 12 hours', async () => {
  const { dir, bundled } = stage();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error('down');
  };
  try {
    const catalog = await loadLatestCatalog({ dir, bundledPath: bundled, now: NOW, url: URL, fetch: fetchImpl });
    expect(catalog.generatedAt).toBe('2020-01-01T00:00:00.000Z');
    const saved = JSON.parse(readFileSync(join(dir, 'catalog.meta.json'), 'utf8')) as { checkedAt: number };
    expect(saved.checkedAt).toBe(NOW);
    await loadLatestCatalog({ dir, bundledPath: bundled, now: NOW + 1, url: URL, fetch: fetchImpl });
    expect(calls).toBe(1);
    await loadLatestCatalog({ dir, bundledPath: bundled, refresh: true, now: NOW + 1, url: URL, fetch: fetchImpl });
    expect(calls).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('does not cache a snapshot that fails the schema', async () => {
  const { dir, bundled } = stage();
  try {
    const catalog = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      now: NOW,
      url: URL,
      fetch: async () => new Response(new Uint8Array(Buffer.from('not gzip')), { status: 200 }),
    });
    expect(catalog.generatedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(existsSync(join(dir, 'catalog.json.gz'))).toBe(false);
    expect(existsSync(join(dir, 'catalog.meta.json'))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('revalidates with the ETag and keeps the cached bytes on 304', async () => {
  const { dir, bundled } = stage();
  const cached = gzip(snapshot('2026-06-01T00:00:00.000Z'));
  writeFileSync(join(dir, 'catalog.json.gz'), cached);
  meta(dir, NOW - MAX_AGE_MS, '"abc"');
  try {
    const catalog = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      now: NOW,
      url: URL,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('if-none-match')).toBe('"abc"');
        expect(headers.get('user-agent')).toBe(USER_AGENT);
        return new Response(null, { status: 304 });
      },
    });
    expect(catalog.generatedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(readFileSync(join(dir, 'catalog.json.gz')).equals(cached)).toBe(true);
    const saved = JSON.parse(readFileSync(join(dir, 'catalog.meta.json'), 'utf8')) as { checkedAt: number; etag: string };
    expect(saved).toEqual({ checkedAt: NOW, etag: '"abc"' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('prefers a newer bundled snapshot over an older download', async () => {
  const { dir, bundled } = stage();
  try {
    const catalog = await loadLatestCatalog({
      dir,
      bundledPath: bundled,
      now: NOW,
      url: URL,
      fetch: async () => new Response(new Uint8Array(gzip(snapshot('2019-01-01T00:00:00.000Z'))), { status: 200 }),
    });
    expect(catalog.generatedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(decodeCatalog(readFileSync(join(dir, 'catalog.json.gz'))).generatedAt).toBe('2019-01-01T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('fails readably when no snapshot exists', async () => {
  const { dir } = stage();
  try {
    await expect(
      loadLatestCatalog({
        dir,
        bundledPath: join(dir, 'missing.json.gz'),
        offline: true,
        now: NOW,
        url: URL,
      }),
    ).rejects.toThrow(/catalog/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

