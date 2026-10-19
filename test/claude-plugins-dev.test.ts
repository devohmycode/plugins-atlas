import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ContractError } from '../src/source.js';
import { claudePluginsDev, mapEntry, repairMojibake } from '../src/sources/claude-plugins-dev.js';

const page = JSON.parse(readFileSync(new URL('./fixtures/claude-plugins-dev.json', import.meta.url), 'utf8')) as {
  plugins: unknown[];
  total: number;
};

it('maps a real directory entry to its marketplace, without a plugin source', () => {
  expect(mapEntry(page.plugins[0])).toEqual({
    origin: 'claude-plugins.dev',
    name: 'frontend-design',
    marketplace: { name: 'claude-code-plugins', source: { kind: 'github', repo: 'anthropics/claude-code' } },
    description: expect.stringContaining('frontend interfaces'),
    version: '1.1.0',
    author: { name: 'Prithvi Rajasekaran & Alexander Bricken' },
    category: 'development',
  });
  expect(mapEntry(page.plugins[2])?.keywords).toContain('code-review');
});

it('drops an entry without a usable marketplace', () => {
  const base = page.plugins[0] as Record<string, unknown>;
  expect(mapEntry({ ...base, namespace: 'no-owner' })).toBeUndefined();
  expect(mapEntry({ ...base, namespace: '@a/-y' })).toBeUndefined();
  expect(mapEntry({ ...base, gitUrl: 'file:///etc' })).toBeUndefined();
  expect(mapEntry({ name: 'x' })).toBeUndefined();
});

it('pages by offset until the total', async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ ...page, total: 250 }), { status: 200 });
  };
  const plugins = await claudePluginsDev({ fetch: fetchImpl, env: {} }).fetch();
  expect(seen.map((url) => new URL(url).searchParams.get('offset'))).toEqual(['0', '100', '200']);
  expect(plugins).toHaveLength(9);
});

it('says the contract changed when a page has the wrong shape', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
  await expect(claudePluginsDev({ fetch: fetchImpl, env: {} }).fetch()).rejects.toThrow(ContractError);
  await expect(claudePluginsDev({ fetch: fetchImpl, env: {} }).fetch()).rejects.toThrow('contract changed');
});

it('repairs text that was UTF-8 read as Latin-1 or Windows-1252, and leaves clean text alone', () => {
  const mojibake = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
  expect(repairMojibake(mojibake('Collection de rôles (Français)'))).toBe('Collection de rôles (Français)');
  expect(repairMojibake('Itâ€™s fast â€” really')).toBe('It’s fast — really');
  for (const clean of ['café crème', 'Plain ASCII', 'naïve — ok', '日本語']) expect(repairMojibake(clean)).toBe(clean);
});
