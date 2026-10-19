import { expect, it } from 'vitest';
import { dedupe } from '../src/dedupe.js';
import type { Marketplace, RawPlugin } from '../src/types.js';

const official: Marketplace = { name: 'claude-plugins-official', source: { kind: 'github', repo: 'anthropics/claude-plugins-official' } };
const other: Marketplace = { name: 'acme', source: { kind: 'github', repo: 'acme/market' } };

it('merges the same plugin seen by a directory and by its marketplace', () => {
  const directory: RawPlugin = {
    origin: 'claude-plugins.dev',
    name: 'demo',
    marketplace: official,
    source: { kind: 'github', repo: 'old/copy' },
    description: 'A much longer description from the directory',
    version: '0.9.0',
    keywords: ['a', 'b'],
  };
  const fromMarketplace: RawPlugin = {
    origin: 'official',
    name: 'demo',
    marketplace: official,
    source: { kind: 'path', path: 'plugins/demo' },
    description: 'Short',
    version: '1.0.0',
    keywords: ['b', 'c'],
    category: 'testing',
  };
  const [plugin, ...rest] = dedupe([directory, fromMarketplace]);
  expect(rest).toEqual([]);
  expect(plugin).toMatchObject({
    id: 'demo@claude-plugins-official',
    origins: ['claude-plugins.dev', 'official'],
    description: 'A much longer description from the directory',
    version: '1.0.0',
    source: { kind: 'path', path: 'plugins/demo' },
    keywords: ['a', 'b', 'c'],
    category: 'testing',
    official: true,
    agents: [],
    themes: [],
  });
});

it('keeps the marketplace version when a directory comes after it', () => {
  const [plugin] = dedupe([
    { origin: 'github', name: 'demo', marketplace: other, source: { kind: 'path', path: 'd' }, version: '2.0.0' },
    { origin: 'claude-plugins.dev', name: 'demo', marketplace: other, source: { kind: 'path', path: 'x' }, version: '1.0.0' },
  ]);
  expect(plugin).toMatchObject({ version: '2.0.0', source: { kind: 'path', path: 'd' }, official: false });
});

it('keeps two marketplaces that list the same repository as two entries', () => {
  const repository = { url: 'https://github.com/a/b' };
  const plugins = dedupe([
    { origin: 'official', name: 'demo', marketplace: official, source: { kind: 'github', repo: 'a/b' }, repository },
    { origin: 'github', name: 'demo', marketplace: other, source: { kind: 'github', repo: 'a/b' }, repository },
  ]);
  expect(plugins.map((p) => p.id)).toEqual(['demo@claude-plugins-official', 'demo@acme']);
  expect(plugins.every((p) => p.repository?.url === repository.url)).toBe(true);
});

it('keeps the first marketplace when another repository uses the same name', () => {
  const impostor: Marketplace = { name: 'acme', source: { kind: 'github', repo: 'evil/acme' } };
  const [plugin, ...rest] = dedupe([
    { origin: 'github', name: 'demo', marketplace: other, source: { kind: 'path', path: 'd' } },
    { origin: 'github', name: 'demo', marketplace: impostor, source: { kind: 'path', path: 'x' }, description: 'longer description' },
  ]);
  expect(rest).toEqual([]);
  expect(plugin).toMatchObject({ marketplace: other, source: { kind: 'path', path: 'd' } });
  expect(plugin?.description).toBeUndefined();
});

it('takes the marketplace file from the marketplace reading', () => {
  const [plugin] = dedupe([
    { origin: 'claude-plugins.dev', name: 'demo', marketplace: other },
    { origin: 'github', name: 'demo', marketplace: { ...other, file: '.claude-plugin/marketplace.json' }, source: { kind: 'path', path: 'd' } },
  ]);
  expect(plugin?.marketplace.file).toBe('.claude-plugin/marketplace.json');
  expect(plugin?.source).toEqual({ kind: 'path', path: 'd' });
});

it('drops a record whose name cannot form an id', () => {
  expect(dedupe([{ origin: 'github', name: '-y', marketplace: other, source: { kind: 'path', path: 'x' } }])).toEqual([]);
});
