import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadCatalog } from '../src/catalog.js';
import { crawl, CrawlError, defaultSources, repoLimitFor } from '../src/crawl.js';
import type { Source } from '../src/source.js';
import type { RawPlugin } from '../src/types.js';

const marketplace = { name: 'claude-plugins-official', source: { kind: 'github', repo: 'anthropics/claude-plugins-official' } } as const;
const plugin: RawPlugin = { origin: 'official', name: 'p', marketplace, source: { kind: 'path', path: 'p' } };
const ok = (origin: Source['origin'], plugins: RawPlugin[]): Source => ({ origin, fetch: async () => plugins });
const down = (origin: Source['origin']): Source => ({ origin, fetch: async () => { throw new Error('down'); } });
const build = { readRepo: async () => undefined };

function withDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-atlas-crawl-'));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

it('lists the five sources', () => {
  expect(defaultSources({}).map((s) => s.origin)).toEqual(['official', 'codex', 'cursor', 'github', 'claude-plugins.dev']);
});

it('writes the snapshot and prints the counts; another failed source does not fail', () =>
  withDir(async (dir) => {
    const lines: string[] = [];
    const out = join(dir, 'catalog.json.gz');
    await crawl({ sources: [ok('official', [plugin]), down('github'), ok('cursor', [])], out, log: (l) => lines.push(l), env: {}, build });
    expect(lines).toEqual(['official: 1', 'github: down', 'cursor: 0', 'merged: 1', 'official: 1', 'repositories: 0 read, 0 failed, 1 unread']);
    expect((await loadCatalog(out)).plugins.map((p) => p.id)).toEqual(['p@claude-plugins-official']);
  }));

it('fails without writing when the official marketplace gives zero plugins', () =>
  withDir(async (dir) => {
    const out = join(dir, 'catalog.json.gz');
    await expect(crawl({ sources: [ok('official', []), ok('cursor', [{ ...plugin, origin: 'cursor' }])], out, log: () => {}, env: {}, build })).rejects.toBeInstanceOf(CrawlError);
    await expect(crawl({ sources: [down('official'), ok('cursor', [{ ...plugin, origin: 'cursor' }])], out, log: () => {}, env: {}, build })).rejects.toThrow('zero plugins');
    expect(existsSync(out)).toBe(false);
  }));

it('reads few repositories without a token, more with one, or the number set', () => {
  expect(repoLimitFor({})).toBe(40);
  expect(repoLimitFor({ GITHUB_TOKEN: 't' })).toBe(3000);
  expect(repoLimitFor({ GITHUB_TOKEN: 't', PLUGINS_ATLAS_REPO_LIMIT: '0' })).toBe(0);
  expect(repoLimitFor({ PLUGINS_ATLAS_REPO_LIMIT: '-1' })).toBe(40);
});
