import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MarketplaceError, parseMarketplace } from '../src/marketplace.js';
import type { MarketplaceSource } from '../src/types.js';

const official = JSON.parse(readFileSync(new URL('./fixtures/official-marketplace.json', import.meta.url), 'utf8')) as unknown;
const source: MarketplaceSource = { kind: 'github', repo: 'anthropics/claude-plugins-official' };

it('reads a real marketplace: path, url and git-subdir sources', () => {
  const parsed = parseMarketplace(official, 'official', source);
  expect(parsed.name).toBe('claude-plugins-official');
  expect(parsed.skipped).toEqual([]);
  expect(parsed.plugins.map((p) => [p.name, p.source])).toEqual([
    ['agent-sdk-dev', { kind: 'path', path: 'plugins/agent-sdk-dev' }],
    ['asana', { kind: 'path', path: 'external_plugins/asana' }],
    ['agentforce-adlc', { kind: 'github', repo: 'SalesforceAIResearch/agentforce-adlc', sha: '09bf1539d41f9ff355ba3eb5d05d4a75813423bb' }],
    ['ai-plugins', { kind: 'github', repo: 'endorlabs/ai-plugins', sha: '2de00883bd2be8b8578b46ab09baf2c8731376de' }],
    [
      '42crunch-api-security-testing',
      { kind: 'github', repo: '42Crunch-AI/claude-plugins', ref: 'v1.5.5', sha: 'faf5305385de8afed9468904e8639be737aff39e', path: 'plugins/api-security-testing' },
    ],
    [
      'adobe-for-creativity',
      { kind: 'github', repo: 'adobe/skills', ref: 'main', sha: '0f487c9b1b98d8e62dfc80ee4d28b29f5471261f', path: 'plugins/creative-cloud/adobe-for-creativity' },
    ],
  ]);
  const first = parsed.plugins[4];
  expect(first).toMatchObject({ origin: 'official', category: 'security', author: { name: '42Crunch' }, marketplace: { name: 'claude-plugins-official', source } });
});

it('reads the github, git and pluginRoot forms', () => {
  const parsed = parseMarketplace(
    {
      name: 'm',
      owner: { name: 'Ada' },
      metadata: { pluginRoot: './plugins' },
      plugins: [
        { name: 'bare', source: 'bare', author: 'Ada', keywords: ['a'], tags: ['a', 'b'] },
        { name: 'gh', source: { source: 'github', repo: 'a/b', ref: 'v1' } },
        { name: 'lab', source: { source: 'url', url: 'https://gitlab.com/a/b.git' } },
        { name: 'sub', source: { source: 'git-subdir', url: 'a/b', path: './tools/x' } },
      ],
    },
    'github',
    source,
  );
  expect(parsed.owner).toBe('Ada');
  expect(parsed.plugins.map((p) => p.source)).toEqual([
    { kind: 'path', path: 'plugins/bare' },
    { kind: 'github', repo: 'a/b', ref: 'v1' },
    { kind: 'git', url: 'https://gitlab.com/a/b.git' },
    { kind: 'github', repo: 'a/b', path: 'tools/x' },
  ]);
  expect(parsed.plugins[0]).toMatchObject({ author: { name: 'Ada' }, keywords: ['a', 'b'] });
});

it('skips and names an entry it cannot read, without failing the marketplace', () => {
  const parsed = parseMarketplace(
    {
      name: 'm',
      plugins: [
        { name: 'npm', source: { source: 'npm', package: '@x/y' } },
        { name: 'escape', source: './../x' },
        { name: 'badsha', source: { source: 'github', repo: 'a/b', sha: 'abc' } },
        { source: './x' },
        { name: 'ok', source: './ok' },
      ],
    },
    'github',
    source,
  );
  expect(parsed.plugins.map((p) => p.name)).toEqual(['ok']);
  expect(parsed.skipped.map((s) => [s.name, s.field])).toEqual([
    ['npm', 'plugins.0.source'],
    ['escape', 'plugins.1.source'],
    ['badsha', 'plugins.2.source'],
    [undefined, 'plugins.3.name'],
  ]);
});

it('names the field of a malformed marketplace', () => {
  expect(() => parseMarketplace({ plugins: [] }, 'github', source)).toThrow(MarketplaceError);
  expect(() => parseMarketplace({ name: 'm', plugins: {} }, 'github', source)).toThrow('plugins');
  expect(() => parseMarketplace('x', 'github', source)).toThrow(MarketplaceError);
});
