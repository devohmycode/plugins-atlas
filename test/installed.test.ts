import { expect, it } from 'vitest';
import type { Adapter, AgentContext, InstalledEntry } from '../src/adapters/index.js';
import { installedView } from '../src/installed.js';
import type { AgentId, Catalog, Plugin, Scope } from '../src/types.js';

function plugin(id: string): Plugin {
  const [name = id, market = 'm'] = id.split('@');
  return { id, name, marketplace: { name: market, source: { kind: 'github', repo: `o/${market}` } }, keywords: [], agents: [], origins: ['github'], themes: [], official: false };
}

const catalog = {
  version: 1,
  generatedAt: 'T',
  themes: [],
  plugins: [plugin('demo@acme'), plugin('twin@a'), plugin('twin@b'), plugin('solo@acme')],
  stats: {} as Catalog['stats'],
} satisfies Catalog;

function adapter(lists: Partial<Record<Scope, InstalledEntry[] | Error>>): Adapter {
  return {
    known: async () => new Map(),
    install: async () => {},
    uninstall: async () => {},
    installed: async (scope) => {
      const list = lists[scope] ?? [];
      if (list instanceof Error) throw list;
      return list;
    },
  };
}

const ctx = {} as AgentContext;

it('ties entries to catalog ids, lists unknown ones apart, and marks disabled ones', async () => {
  const codexCalls: Scope[] = [];
  const codex = adapter({ user: [{ id: 'demo@acme', scope: 'user', enabled: false }] });
  const adapters = {
    'claude-code': adapter({
      user: [
        { id: 'demo@acme', scope: 'user', enabled: true, version: '1.0.0' },
        { id: 'local@nowhere', scope: 'user', enabled: true },
      ],
      project: [{ id: 'twin', scope: 'project', enabled: true }, { id: 'solo', scope: 'project', enabled: true }],
    }),
    'codex-cli': { ...codex, installed: async (scope: Scope) => { codexCalls.push(scope); return codex.installed(scope, ctx); } },
    'codex-desktop': codex,
  } as unknown as Record<AgentId, Adapter>;

  const view = await installedView(catalog, ['claude-code', 'codex-cli', 'codex-desktop'], ctx, adapters);
  expect(view.matched.map((r) => [r.agents, r.scope, r.id, r.enabled, r.plugin?.id])).toEqual([
    [['claude-code'], 'user', 'demo@acme', true, 'demo@acme'],
    [['claude-code'], 'project', 'solo', true, 'solo@acme'],
    [['codex-cli', 'codex-desktop'], 'user', 'demo@acme', false, 'demo@acme'],
  ]);
  expect(view.unknown.map((r) => r.id)).toEqual(['local@nowhere', 'twin']);
  expect(codexCalls).toEqual(['user', 'project']);
});

it('names an agent whose list cannot be read, and goes on', async () => {
  const adapters = {
    droid: adapter({ user: new Error('droid is not on the PATH') }),
    'claude-code': adapter({ user: [{ id: 'demo@acme', scope: 'user', enabled: true }] }),
  } as unknown as Record<AgentId, Adapter>;
  const view = await installedView(catalog, ['droid', 'claude-code'], ctx, adapters);
  expect(view.errors).toEqual([{ agent: 'droid', scope: 'user', error: 'droid is not on the PATH' }]);
  expect(view.matched).toHaveLength(1);
});
