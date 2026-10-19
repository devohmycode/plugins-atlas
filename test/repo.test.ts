import { expect, it } from 'vitest';
import { HttpError } from '../src/http.js';
import { locate, readPluginRepo, RepoError } from '../src/repo.js';
import type { MarketplaceSource } from '../src/types.js';

const marketplace: MarketplaceSource = { kind: 'github', repo: 'acme/market' };

/** A local stand-in for GitHub: URL to body. Records every URL asked. */
function github(routes: Record<string, unknown>) {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    seen.push(String(url));
    const body = routes[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  };
  return { fetchImpl, seen };
}

const tree = {
  tree: [
    { path: 'plugins/demo/.claude-plugin/plugin.json', type: 'blob' },
    { path: 'plugins/demo/skills/pdf/SKILL.md', type: 'blob' },
    { path: 'plugins/demo/hooks/hooks.json', type: 'blob' },
    { path: 'plugins/demo/README.md', type: 'blob' },
    { path: 'plugins/demo/skills', type: 'tree' },
    { path: 'plugins/other/.claude-plugin/plugin.json', type: 'blob' },
  ],
};

it('locates a plugin from each source form', () => {
  expect(locate({ kind: 'path', path: 'plugins/demo' }, { kind: 'github', repo: 'acme/market', ref: 'v2' })).toEqual({
    repo: 'acme/market',
    revision: 'v2',
    root: 'plugins/demo',
  });
  expect(locate({ kind: 'github', repo: 'a/b', ref: 'main', sha: 'f'.repeat(40), path: 'x' }, marketplace)).toEqual({
    repo: 'a/b',
    revision: 'f'.repeat(40),
    root: 'x',
  });
  expect(locate({ kind: 'git', url: 'https://github.com/a/b.git' }, marketplace)).toEqual({ repo: 'a/b', revision: 'HEAD', root: '' });
  expect(locate({ kind: 'git', url: 'https://gitlab.com/a/b.git' }, marketplace)).toBeUndefined();
  expect(locate({ kind: 'path', path: 'p' }, { kind: 'git', url: 'https://gitlab.com/a/m.git' })).toBeUndefined();
});

it('reads tree, manifest, hooks and README of one plugin, at its revision, without cloning', async () => {
  const raw = 'https://raw.githubusercontent.com/acme/market/HEAD/plugins/demo';
  const { fetchImpl, seen } = github({
    'https://api.github.com/repos/acme/market/git/trees/HEAD?recursive=1': tree,
    [`${raw}/.claude-plugin/plugin.json`]: { name: 'demo' },
    [`${raw}/hooks/hooks.json`]: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } },
    [`${raw}/README.md`]: '# Demo',
  });
  const read = await readPluginRepo({ kind: 'path', path: 'plugins/demo' }, marketplace, { fetch: fetchImpl, env: {} });
  expect(read).toMatchObject({
    files: ['.claude-plugin/plugin.json', 'skills/pdf/SKILL.md', 'hooks/hooks.json', 'README.md'],
    manifest: { name: 'demo' },
    readme: '# Demo',
    components: { skills: ['skills/pdf'], hooks: [{ event: 'Stop', command: 'echo bye' }] },
  });
  expect(seen.every((url) => url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/'))).toBe(true);
  expect(seen).toHaveLength(4);
});

it('asks the tree of one repository once for all its plugins', async () => {
  const { fetchImpl, seen } = github({ 'https://api.github.com/repos/acme/market/git/trees/HEAD?recursive=1': tree });
  const opts = { fetch: fetchImpl, env: {}, trees: new Map() };
  await readPluginRepo({ kind: 'path', path: 'plugins/other' }, marketplace, opts).catch(() => undefined);
  await readPluginRepo({ kind: 'path', path: 'plugins/demo' }, marketplace, opts).catch(() => undefined);
  expect(seen.filter((url) => url.includes('/git/trees/'))).toHaveLength(1);
});

it('marks a plugin outside GitHub as unknown, and names a missing or truncated tree', async () => {
  const { fetchImpl } = github({
    'https://api.github.com/repos/a/b/git/trees/HEAD?recursive=1': { tree: [], truncated: true },
  });
  expect(await readPluginRepo({ kind: 'git', url: 'https://gitlab.com/a/b.git' }, marketplace, { fetch: fetchImpl })).toBeUndefined();
  await expect(readPluginRepo({ kind: 'github', repo: 'a/b' }, marketplace, { fetch: fetchImpl, env: {} })).rejects.toBeInstanceOf(RepoError);
  await expect(readPluginRepo({ kind: 'github', repo: 'a/c' }, marketplace, { fetch: fetchImpl, env: {} })).rejects.toBeInstanceOf(HttpError);
});
