import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildCatalog } from '../src/build.js';
import { CatalogShapeError, decodeCatalog, encodeCatalog, loadCatalog, saveCatalog } from '../src/catalog.js';
import type { Catalog } from '../src/types.js';

async function sample(): Promise<Catalog> {
  const marketplace = { name: 'm', source: { kind: 'github', repo: 'a/m' }, file: '.claude-plugin/marketplace.json' } as const;
  return buildCatalog({
    sources: [{ origin: 'official', fetch: async () => [{ origin: 'official', name: 'p', marketplace, source: { kind: 'path', path: 'p' } }] }],
    readRepo: async () => ({
      location: { repo: 'a/m', revision: 'HEAD', root: 'p' },
      files: ['.claude-plugin/plugin.json'],
      components: { skills: [], commands: [], agents: [], hooks: [{ event: 'Stop', command: 'echo' }], mcpServers: [{ name: 's', command: 'node', args: ['x'], env: { A: '1' } }] },
    }),
    generatedAt: '2026-10-19T00:00:00.000Z',
  });
}

it('round-trips a built catalog through the gzip snapshot', async () => {
  const catalog = await sample();
  expect(decodeCatalog(encodeCatalog(catalog))).toEqual(catalog);
  const dir = await mkdtemp(join(tmpdir(), 'plugins-atlas-'));
  try {
    const path = join(dir, 'data', 'catalog.json.gz');
    await saveCatalog(catalog, path);
    expect((await loadCatalog(path)).generatedAt).toBe('2026-10-19T00:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('names the field of a snapshot in an old shape', async () => {
  const catalog = (await sample()) as unknown as { plugins: { agents: unknown }[] };
  (catalog.plugins[0] as { agents: unknown }).agents = ['vim'];
  expect(() => encodeCatalog(catalog as unknown as Catalog)).toThrow(CatalogShapeError);
  expect(() => encodeCatalog(catalog as unknown as Catalog)).toThrow('plugins.0.agents.0');
  const { generatedAt: _, ...rest } = await sample();
  expect(() => encodeCatalog(rest as Catalog)).toThrow('generatedAt');
});

it('names a truncated file', async () => {
  const bytes = encodeCatalog(await sample());
  expect(() => decodeCatalog(bytes.subarray(0, bytes.length - 8))).toThrow('catalog: truncated snapshot');
});
