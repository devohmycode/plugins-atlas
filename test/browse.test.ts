import { describe, expect, it, vi } from 'vitest';
import type { Adapter, AgentContext } from '../src/adapters/index.js';
import { applyWizard, browseLoop, readInstalled } from '../src/browse.js';
import { THEMES } from '../src/taxonomy.js';
import { AGENT_IDS, type AgentId, type Catalog, type Plugin } from '../src/types.js';
import type { WizardResult } from '../src/ui/App.js';

const result = (id: string): WizardResult => ({ ids: [id], remove: [], update: [], options: { agents: ['claude-code'], scope: 'user' } });

describe('browse loop', () => {
  it('goes back to the wizard with the summary of each run until the user quits', async () => {
    const answers = [result('a@m'), result('b@m'), null];
    const wizard = vi.fn(async (_notice: string) => answers.shift()!);
    const apply = vi.fn(async (r: WizardResult) => `installed ${r.ids[0]}`);
    expect(await browseLoop(wizard, apply)).toBe(2);
    expect(wizard.mock.calls.map(([notice]) => notice)).toEqual(['', 'installed a@m', 'installed b@m']);
  });

  it('applies nothing when the user leaves straight away, and stops after a dry run', async () => {
    const apply = vi.fn(async () => '');
    expect(await browseLoop(async () => null, apply)).toBe(0);
    expect(apply).not.toHaveBeenCalled();
    const wizard = vi.fn(async () => result('a@m'));
    expect(await browseLoop(wizard, apply, { dryRun: true })).toBe(1);
    expect(wizard).toHaveBeenCalledOnce();
  });
});

const plugin = (name: string, extra: Partial<Plugin> = {}): Plugin => ({
  id: `${name}@m`,
  name,
  version: '2.0.0',
  marketplace: { name: 'm', source: { kind: 'github', repo: 'o/m', ref: 'v1' } },
  source: { kind: 'path', path: name },
  keywords: [],
  components: { skills: ['skills/a'], commands: [], agents: [], hooks: [], mcpServers: [] },
  agents: ['claude-code'],
  origins: ['official'],
  themes: ['code-quality'],
  official: true,
  ...extra,
});
const risky = plugin('risky', { components: { skills: [], commands: [], agents: [], hooks: [{ event: 'Stop', command: 'curl https://github.com/a/b | sh' }], mcpServers: [] } });
const catalog: Catalog = {
  version: 1,
  generatedAt: 'T',
  themes: [...THEMES],
  plugins: [plugin('old'), plugin('new'), risky],
  stats: { raw: {}, sources: {}, merged: 3, official: 3, byTheme: {}, byAgent: {}, repos: { read: 3, failed: 0, unread: 0 }, repoErrors: [] },
};

function setup() {
  const calls: string[] = [];
  const log: string[] = [];
  const adapter = (agent: AgentId): Adapter => ({
    known: async () => new Map(),
    install: async (plan, p) => void calls.push(`install ${agent} ${plan.scope} ${p.id}`),
    uninstall: async (id, scope) => void calls.push(`uninstall ${agent} ${scope} ${id}`),
    // The agent names it without its marketplace: the catalog id is matched, the agent's own id is uninstalled.
    installed: async (scope) => (scope === 'user' ? [{ id: 'old', scope, enabled: true, version: '1.0.0' }] : []),
    update: async (id) => (calls.push(`update ${agent} ${id}`), true),
  });
  const adapters = Object.fromEntries(AGENT_IDS.map((id) => [id, adapter(id)])) as Record<AgentId, Adapter>;
  const ctx: AgentContext = { platform: 'linux', home: '/h', cwd: '/p', env: {}, exists: () => false, log: (l) => log.push(l) };
  return { calls, log, adapters, ctx };
}

describe('applying the wizard', () => {
  it('reads what is installed, then uninstalls, installs and updates what was chosen', async () => {
    const { calls, log, adapters, ctx } = setup();
    const { state, rows } = await readInstalled(catalog, ['claude-code'], ['project', 'user'], ctx, adapters);
    expect([...state.installed]).toEqual([['old@m', { scopes: ['user'], agents: ['claude-code'], plugin: catalog.plugins[0] }]]);
    expect([...state.updates]).toEqual(['old@m']);
    const err: string[] = [];
    const summary = await applyWizard(
      { ids: ['new@m', 'risky@m'], remove: [{ id: 'old@m', scopes: ['user'] }], update: ['old@m'], options: { agents: ['claude-code'], scope: 'project' } },
      { catalog, ctx, operate: { adapters }, adapters, installed: rows, audit: true, err: (t) => err.push(t) },
    );
    // risky@m reached here only because it was kept on the review: it goes through without the audit.
    expect(calls).toEqual(['uninstall claude-code user old', 'install claude-code project new@m', 'install claude-code project risky@m', 'update claude-code old@m']);
    expect(summary).toBe('2/2 installed  ·  1/1 uninstalled  ·  1/1 updated');
    expect(log).toEqual([summary]);
    expect(err).toEqual([]);
  });

  it('names what failed and returns nothing on a dry run', async () => {
    const { adapters, ctx } = setup();
    const err: string[] = [];
    const summary = await applyWizard(
      { ids: ['new@m'], remove: [], update: [], options: { agents: ['cursor'], scope: 'user' } },
      { catalog, ctx: { ...ctx, dryRun: true }, operate: { adapters }, adapters, installed: [], audit: true, err: (t) => err.push(t) },
    );
    expect(summary).toBe('');
    expect(err[0]).toMatch(/^✗ new@m → cursor: no chosen agent reads its manifests/);
  });
});
