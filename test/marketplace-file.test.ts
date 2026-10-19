import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { marketplaceFileSource, OFFICIAL_MARKETPLACES } from '../src/sources/marketplace-file.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const files: Record<string, string> = {
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/HEAD/.claude-plugin/marketplace.json': fixture('official-marketplace.json'),
  'https://raw.githubusercontent.com/openai/plugins/HEAD/.agents/plugins/marketplace.json': fixture('codex-marketplace.json'),
  'https://raw.githubusercontent.com/cursor/plugins/HEAD/.cursor-plugin/marketplace.json': fixture('cursor-marketplace.json'),
};
const fetchImpl: typeof fetch = async (url) => {
  const body = files[String(url)];
  return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
};

it('reads each official marketplace under its own origin, with its file', async () => {
  for (const [key, origin, name, count] of [
    ['anthropic', 'official', 'claude-plugins-official', 6],
    ['codex', 'codex', 'openai-curated', 3],
    ['cursor', 'cursor', 'cursor-plugins', 3],
  ] as const) {
    const target = OFFICIAL_MARKETPLACES[key];
    const source = marketplaceFileSource(target, { fetch: fetchImpl, env: {} });
    expect(source.origin).toBe(origin);
    const plugins = await source.fetch();
    expect(plugins).toHaveLength(count);
    expect(plugins.every((p) => p.origin === origin && p.marketplace.name === name && p.marketplace.file === target.file)).toBe(true);
    expect(plugins[0]?.marketplace.source).toEqual({ kind: 'github', repo: target.repo });
  }
});

it('fails the source when the file is missing', async () => {
  const source = marketplaceFileSource({ origin: 'github', repo: 'a/b', file: 'x.json' }, { fetch: fetchImpl, env: {} });
  await expect(source.fetch()).rejects.toThrow('404');
});
