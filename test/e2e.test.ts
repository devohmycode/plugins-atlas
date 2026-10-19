import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { buildCatalog } from '../src/build.js';
import { loadCatalog, saveCatalog } from '../src/catalog.js';
import { createProgram } from '../src/cli.js';
import type { Exec } from '../src/run.js';
import { marketplaceFileSource } from '../src/sources/marketplace-file.js';
import type { Catalog } from '../src/types.js';

const root = mkdtempSync(join(tmpdir(), 'plugins-atlas-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const marketplace = JSON.stringify({
  name: 'acme',
  owner: { name: 'Acme' },
  plugins: [{ name: 'review', source: './plugins/review', description: 'Code review for pull requests', version: '1.2.0' }],
});
const tree = { tree: [{ path: 'plugins/review/.claude-plugin/plugin.json', type: 'blob' }, { path: 'plugins/review/.codex-plugin/plugin.json', type: 'blob' }, { path: 'plugins/review/commands/review.md', type: 'blob' }] };
const routes: Record<string, string> = {
  'https://raw.githubusercontent.com/acme/market/v1/.claude-plugin/marketplace.json': marketplace,
  'https://api.github.com/repos/acme/market/git/trees/v1?recursive=1': JSON.stringify(tree),
  'https://raw.githubusercontent.com/acme/market/v1/plugins/review/.claude-plugin/plugin.json': '{"name":"review"}',
};
const fetchImpl: typeof fetch = async (url) => {
  const body = routes[String(url)];
  return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
};

/** A stand-in for the `claude` executable: remembers what it installed and lists it. */
const installed = new Set<string>();
const commands: string[] = [];
const exec: Exec = async (file, args) => {
  commands.push([posix.basename(file), ...args].join(' '));
  const [, verb, id] = args;
  if (verb === 'install' && id) installed.add(id);
  if (verb === 'uninstall' && id) installed.delete(id);
  const list = [...installed].map((plugin) => ({ id: plugin, version: '1.2.0', scope: 'user', enabled: true }));
  return { code: 0, stdout: verb === 'list' ? JSON.stringify(list) : '', stderr: '' };
};

function cli(catalog: Catalog) {
  const out: string[] = [];
  const err: string[] = [];
  const run = async (...args: string[]) => {
    out.length = 0;
    err.length = 0;
    const program = createProgram({
      loadCatalog: async () => catalog,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readConfig: () => ({}),
      machine: { platform: 'linux', home: join(root, 'home'), cwd: join(root, 'project'), env: { PATH: '/bin' }, exists: (p) => p === '/bin/claude', exec },
    });
    program.exitOverride();
    await program.parseAsync(['node', 'plugins-atlas', ...args]);
  };
  return { out, err, run };
}

it('goes from fixtures to an install, the installed list and an uninstall, without the network', async () => {
  // Fixtures to snapshot and back.
  const source = marketplaceFileSource({ origin: 'official', repo: 'acme/market', file: '.claude-plugin/marketplace.json', ref: 'v1' }, { fetch: fetchImpl, env: {} });
  const built = await buildCatalog({ sources: [source], repo: { fetch: fetchImpl, env: {} }, generatedAt: '2026-10-19T00:00:00.000Z' });
  const path = join(root, 'data', 'catalog.json.gz');
  await saveCatalog(built, path);
  const catalog = await loadCatalog(path);
  expect(catalog.plugins.map((p) => [p.id, p.agents])).toEqual([['review@acme', ['claude-code', 'claude-desktop', 'copilot-cli', 'droid', 'codex-cli', 'codex-desktop']]]);

  const { out, err, run } = cli(catalog);
  await run('list', '-q', 'review');
  expect(out[0]).toMatch(/^review@acme/);
  await run('show', 'review@acme');
  expect(out).toContain('command  commands/review.md');
  expect(err.some((line) => line.startsWith('medium: Marketplace source'))).toBe(false);

  // Dry-run: nothing runs, nothing is written.
  await run('install', 'review@acme', '-a', 'claude-code', 'codex-cli', '-p', '--dry-run');
  expect(commands).toEqual([]);
  expect(readdirSync(root)).toEqual(['data']);

  // One agent through its own command, one through its files.
  await run('install', 'review@acme', '-a', 'claude-code', '-y');
  await run('install', 'review@acme', '-a', 'codex-cli', '-p', '-y');
  expect(commands).toEqual(['claude plugin marketplace add acme/market#v1 --scope user', 'claude plugin install review@acme --scope user']);
  expect(readFileSync(join(root, 'project', '.codex', 'config.toml'), 'utf8')).toContain('[plugins."review@acme"]');

  await run('installed', '-a', 'claude-code', 'codex-cli');
  expect(out).toEqual(['review@acme  claude-code (user)  1.2.0', 'review@acme  codex-cli (project)']);

  await run('uninstall', 'review@acme', '-a', 'claude-code');
  await run('uninstall', 'review@acme', '-a', 'codex-cli', '-p');
  await run('installed', '-a', 'claude-code', 'codex-cli');
  expect(out).toEqual([]);

  // Only the snapshot and the emptied project file remain; the test removes them.
  rmSync(join(root, 'data'), { recursive: true, force: true });
  rmSync(join(root, 'project'), { recursive: true, force: true });
  expect(readdirSync(root)).toEqual([]);
});
