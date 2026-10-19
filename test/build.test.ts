import { expect, it } from 'vitest';
import { buildCatalog, CatalogError } from '../src/build.js';
import type { PluginFiles } from '../src/repo.js';
import type { Source } from '../src/source.js';
import type { Marketplace, Plugin, RawPlugin } from '../src/types.js';

const market: Marketplace = { name: 'claude-plugins-official', source: { kind: 'github', repo: 'anthropics/claude-plugins-official' }, file: '.claude-plugin/marketplace.json' };
const acme: Marketplace = { name: 'acme', source: { kind: 'github', repo: 'acme/m' }, file: '.claude-plugin/marketplace.json' };

const source = (origin: Source['origin'], plugins: RawPlugin[]): Source => ({ origin, fetch: async () => plugins });
const failing = (origin: Source['origin']): Source => ({ origin, fetch: async () => { throw new Error(`${origin} down`); } });

const files = (list: string[]): PluginFiles => ({
  location: { repo: 'x/y', revision: 'HEAD', root: '' },
  files: list,
  components: { skills: [], commands: ['commands/review.md'], agents: [], hooks: [], mcpServers: [] },
});

const official: RawPlugin[] = [
  { origin: 'official', name: 'code-review', marketplace: market, source: { kind: 'path', path: 'plugins/code-review' }, description: 'Code review for pull requests' },
  { origin: 'official', name: 'broken', marketplace: market, source: { kind: 'path', path: 'plugins/broken' } },
];
const directory: RawPlugin[] = [
  { origin: 'claude-plugins.dev', name: 'code-review', marketplace: { name: market.name, source: market.source }, keywords: ['review'] },
  { origin: 'claude-plugins.dev', name: 'docker-helper', marketplace: acme, description: 'Deploy with docker' },
];

const readRepo = async (plugin: Plugin) => {
  if (plugin.name === 'broken') throw new Error('HTTP 404');
  return files(['.claude-plugin/plugin.json', 'commands/review.md']);
};

it('merges the sources, reads repositories, works out agents and themes, and counts', async () => {
  const catalog = await buildCatalog({ sources: [source('official', official), source('claude-plugins.dev', directory)], readRepo, generatedAt: 'T' });
  expect(catalog.plugins.map((p) => p.id)).toEqual(['code-review@claude-plugins-official', 'broken@claude-plugins-official', 'docker-helper@acme']);
  const review = catalog.plugins[0];
  expect(review).toMatchObject({ origins: ['official', 'claude-plugins.dev'], official: true, agents: ['claude-code', 'claude-desktop', 'copilot-cli', 'droid'] });
  expect(review?.themes[0]).toBe('code-quality');
  expect(review?.components?.commands).toEqual(['commands/review.md']);
  expect(catalog.plugins[1]?.components).toBeUndefined();
  expect(catalog.plugins[2]).toMatchObject({ agents: [], themes: ['devops'] });
  expect(catalog.stats).toMatchObject({
    raw: { official: 2, 'claude-plugins.dev': 2 },
    merged: 3,
    official: 2,
    repos: { read: 1, failed: 1, unread: 1 },
    repoErrors: [{ id: 'broken@claude-plugins-official', error: 'HTTP 404' }],
    byAgent: { 'claude-code': 1, droid: 1 },
  });
  expect(catalog).toMatchObject({ version: 1, generatedAt: 'T' });
});

it('names and skips a failed source, and fails only when every source fails', async () => {
  const catalog = await buildCatalog({ sources: [source('official', official), failing('github')], readRepo });
  expect(catalog.stats.sources.github).toEqual({ status: 'error', count: 0, error: 'github: github down' });
  await expect(buildCatalog({ sources: [failing('official'), failing('github')] })).rejects.toBeInstanceOf(CatalogError);
});

it('reads at most repoLimit repositories, official first', async () => {
  const seen: string[] = [];
  const acmePlugin: RawPlugin = { origin: 'github', name: 'a', marketplace: acme, source: { kind: 'path', path: 'a' } };
  await buildCatalog({
    sources: [source('github', [acmePlugin]), source('official', official)],
    readRepo: async (plugin) => {
      seen.push(plugin.name);
      return files([]);
    },
    repoLimit: 1,
  });
  expect(seen).toEqual(['code-review']);
});
