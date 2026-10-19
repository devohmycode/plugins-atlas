import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ADAPTERS, type AgentContext } from '../src/adapters/index.js';
import { planInstall } from '../src/plan.js';
import type { Exec } from '../src/run.js';
import type { AgentId, Plugin, Scope } from '../src/types.js';

let dir = '';
let calls: string[][] = [];
let stdout: Record<string, string> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plugins-atlas-adapters-'));
  calls = [];
  stdout = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const exec: Exec = async (file, args) => {
  calls.push([posix.basename(file), ...args]);
  return { code: 0, stdout: stdout[args.join(' ')] ?? '', stderr: '' };
};

function ctx(extra: Partial<AgentContext> = {}): AgentContext {
  return {
    platform: 'linux',
    home: join(dir, 'home'),
    cwd: join(dir, 'project'),
    env: { PATH: '/bin' },
    exists: (path) => ['/bin/claude', '/bin/copilot', '/bin/droid', '/bin/codex'].includes(path),
    exec,
    log: () => {},
    ...extra,
  };
}

const plugin: Plugin = {
  id: 'demo@acme',
  name: 'demo',
  marketplace: { name: 'acme', source: { kind: 'github', repo: 'acme/market', ref: 'v1' } },
  source: { kind: 'path', path: 'plugins/demo' },
  keywords: [],
  components: { skills: ['skills/a'], commands: [], agents: [], hooks: [], mcpServers: [] },
  agents: ['claude-code', 'claude-desktop', 'copilot-cli', 'droid', 'codex-cli', 'codex-desktop', 'cursor'],
  origins: ['github'],
  themes: ['other'],
  official: false,
};

async function install(agent: AgentId, scope: Scope, c = ctx()) {
  const adapter = ADAPTERS[agent];
  const known = await adapter.known(scope, c);
  const [plan] = planInstall({ plugin, agents: [agent], scope, known: () => known });
  await adapter.install(plan!, plugin, c);
}

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

it('Claude Code: adds the marketplace, installs, uninstalls and lists with its own command', async () => {
  await install('claude-code', 'project');
  await ADAPTERS['claude-code'].uninstall('demo@acme', 'project', ctx());
  expect(calls).toEqual([
    ['claude', 'plugin', 'marketplace', 'add', 'acme/market#v1', '--scope', 'project'],
    ['claude', 'plugin', 'install', 'demo@acme', '--scope', 'project'],
    ['claude', 'plugin', 'uninstall', 'demo@acme', '--scope', 'project'],
  ]);
  stdout['plugin list --json'] = JSON.stringify([
    { id: 'demo@acme', version: '1.0.0', scope: 'user', enabled: true },
    { id: 'other@acme', scope: 'project', enabled: false },
  ]);
  expect(await ADAPTERS['claude-code'].installed('user', ctx())).toEqual([{ id: 'demo@acme', scope: 'user', enabled: true, version: '1.0.0' }]);
});

it('Claude Code: a marketplace it already knows from the same source is not added again', async () => {
  mkdirSync(join(dir, 'home', '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(dir, 'home', '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ acme: { source: { source: 'github', repo: 'acme/market' } } }));
  await install('claude-code', 'user');
  expect(calls).toEqual([['claude', 'plugin', 'install', 'demo@acme', '--scope', 'user']]);
});

it('Claude Desktop: prints the steps in the app and writes nothing', async () => {
  const lines: string[] = [];
  await install('claude-desktop', 'user', ctx({ log: (l) => lines.push(l) }));
  expect(lines.join('\n')).toContain('Add marketplace: acme/market#v1');
  expect(calls).toEqual([]);
  expect(existsSync(join(dir, 'home'))).toBe(false);
  expect(await ADAPTERS['claude-desktop'].installed('user', ctx())).toEqual([]);
});

it('Copilot CLI: its command in the user scope, its settings file in the project scope', async () => {
  stdout['plugin marketplace list --json'] = '[]';
  await install('copilot-cli', 'user');
  expect(calls.slice(1)).toEqual([
    ['copilot', 'plugin', 'marketplace', 'add', 'acme/market#v1'],
    ['copilot', 'plugin', 'install', 'demo@acme'],
  ]);
  await install('copilot-cli', 'project');
  const settings = join(dir, 'project', '.github', 'copilot', 'settings.json');
  expect(json(settings)).toEqual({
    extraKnownMarketplaces: { acme: { source: { source: 'github', repo: 'acme/market', ref: 'v1' } } },
    enabledPlugins: { 'demo@acme': true },
  });
  expect(await ADAPTERS['copilot-cli'].installed('project', ctx())).toEqual([{ id: 'demo@acme', scope: 'project', enabled: true }]);
  await ADAPTERS['copilot-cli'].uninstall('demo@acme', 'project', ctx());
  expect(json(settings).enabledPlugins).toEqual({});
});

it('Droid: its command with --scope, its settings for what is installed', async () => {
  await install('droid', 'user');
  expect(calls).toEqual([
    ['droid', 'plugin', 'marketplace', 'add', 'acme/market#v1'],
    ['droid', 'plugin', 'install', 'demo@acme', '--scope', 'user'],
  ]);
  mkdirSync(join(dir, 'home', '.factory'), { recursive: true });
  writeFileSync(join(dir, 'home', '.factory', 'settings.json'), JSON.stringify({ enabledPlugins: { 'demo@acme': true, 'off@acme': false } }));
  expect(await ADAPTERS.droid.installed('user', ctx())).toEqual([
    { id: 'demo@acme', scope: 'user', enabled: true },
    { id: 'off@acme', scope: 'user', enabled: false },
  ]);
});

it('Codex: its command in the user scope, .codex/config.toml in the project scope', async () => {
  await install('codex-cli', 'user');
  expect(calls).toEqual([
    ['codex', 'plugin', 'marketplace', 'add', 'acme/market', '--ref', 'v1', '--json'],
    ['codex', 'plugin', 'add', 'demo@acme', '--json'],
  ]);
  await install('codex-desktop', 'project');
  const config = readFileSync(join(dir, 'project', '.codex', 'config.toml'), 'utf8');
  expect(config).toContain('[marketplaces.acme]');
  expect(config).toContain('source = "https://github.com/acme/market.git"');
  expect(config).toContain('[plugins."demo@acme"]');
  expect(await ADAPTERS['codex-cli'].known('project', ctx())).toEqual(new Map([['acme', 'github:acme/market']]));
  await ADAPTERS['codex-cli'].uninstall('demo@acme', 'project', ctx());
  expect(await ADAPTERS['codex-cli'].installed('project', ctx())).toEqual([]);
  stdout['plugin list --json'] = JSON.stringify({ installed: [{ name: 'demo', marketplaceName: 'acme', version: '2.0.0', enabled: true }], available: [] });
  expect(await ADAPTERS['codex-cli'].installed('user', ctx())).toEqual([{ id: 'demo@acme', scope: 'user', enabled: true, version: '2.0.0' }]);
});

it('Cursor: downloads the plugin folder, marks it, lists it, and removes only its own folder', async () => {
  const routes: Record<string, string> = {
    'https://api.github.com/repos/acme/market/git/trees/v1?recursive=1': JSON.stringify({
      tree: [{ path: 'plugins/demo/.cursor-plugin/plugin.json', type: 'blob' }, { path: 'plugins/demo/skills/a/SKILL.md', type: 'blob' }],
    }),
    'https://raw.githubusercontent.com/acme/market/v1/plugins/demo/.cursor-plugin/plugin.json': '{"name":"demo"}',
    'https://raw.githubusercontent.com/acme/market/v1/plugins/demo/skills/a/SKILL.md': '# A',
  };
  const fetchImpl: typeof fetch = async (url) => {
    const body = routes[String(url)];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  const c = ctx({ repo: { fetch: fetchImpl, env: {} } });
  await install('cursor', 'user', c);
  const folder = join(dir, 'home', '.cursor', 'plugins', 'local', 'demo');
  expect(readFileSync(join(folder, 'skills', 'a', 'SKILL.md'), 'utf8')).toBe('# A');
  expect(readdirSync(join(dir, 'home', '.cursor', 'plugins', 'local'))).toEqual(['demo']);
  expect(await ADAPTERS.cursor.installed('user', c)).toEqual([{ id: 'demo@acme', scope: 'user', enabled: true }]);

  mkdirSync(join(dir, 'home', '.cursor', 'plugins', 'local', 'mine'));
  await expect(ADAPTERS.cursor.uninstall('mine@acme', 'user', c)).rejects.toThrow('not installed by plugins-atlas');
  await ADAPTERS.cursor.uninstall('demo@acme', 'user', c);
  expect(existsSync(folder)).toBe(false);
  expect(existsSync(join(dir, 'home', '.cursor', 'plugins', 'local', 'mine'))).toBe(true);
});

it('dry-run runs no command and writes no file', async () => {
  const c = ctx({ dryRun: true });
  await install('claude-code', 'user', c);
  await install('codex-cli', 'project', c);
  expect(calls).toEqual([]);
  expect(existsSync(join(dir, 'project'))).toBe(false);
});
