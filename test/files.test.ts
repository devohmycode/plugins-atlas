import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { applyEdit, editText, FileEditError } from '../src/files.js';

function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-atlas-files-'));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

it('sets and removes only the keys it names, in JSON', () => {
  const text = JSON.stringify({ theme: 'dark', enabledPlugins: { 'old@m': true } });
  const body = editText(
    {
      path: 'settings.json',
      format: 'json',
      set: [
        { key: ['enabledPlugins', 'demo@acme'], value: true },
        { key: ['extraKnownMarketplaces', 'acme'], value: { source: { source: 'github', repo: 'acme/market' } } },
      ],
      remove: [['enabledPlugins', 'old@m'], ['missing', 'key']],
    },
    text,
  );
  expect(JSON.parse(body)).toEqual({
    theme: 'dark',
    enabledPlugins: { 'demo@acme': true },
    extraKnownMarketplaces: { acme: { source: { source: 'github', repo: 'acme/market' } } },
  });
});

it('sets a dotted table key in TOML and keeps the other tables', () => {
  const text = 'model = "o4"\n\n[mcp_servers.db]\ncommand = "node"\n';
  const body = editText({ path: 'config.toml', format: 'toml', set: [{ key: ['plugins', 'demo@acme', 'enabled'], value: true }] }, text);
  expect(body).toContain('model = "o4"');
  expect(body).toContain('[mcp_servers.db]');
  expect(body).toContain('[plugins."demo@acme"]');
  expect(body).toContain('enabled = true');
});

it('refuses a file it cannot parse, or a key through a value that is not an object', () => {
  expect(() => editText({ path: 'a.json', format: 'json', set: [{ key: ['a'], value: 1 }] }, '{nope')).toThrow(FileEditError);
  expect(() => editText({ path: 'a.json', format: 'json', set: [{ key: ['a', 'b'], value: 1 }] }, '{"a": 3}')).toThrow('not an object');
  expect(() => editText({ path: 'a.json', format: 'json' }, '[1]')).toThrow('does not hold an object');
});

it('writes atomically with a backup, and creates the missing folder', () =>
  withDir(async (dir) => {
    const path = join(dir, 'nested', '.claude', 'settings.json');
    const first = await applyEdit({ path, format: 'json', set: [{ key: ['enabledPlugins', 'a@m'], value: true }] }, { log: () => {} });
    expect(first.written).toBe(true);
    expect(existsSync(`${path}.bak`)).toBe(false);
    await applyEdit({ path, format: 'json', set: [{ key: ['enabledPlugins', 'b@m'], value: true }] }, { log: () => {} });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ enabledPlugins: { 'a@m': true, 'b@m': true } });
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8'))).toEqual({ enabledPlugins: { 'a@m': true } });
    expect(readdirSync(join(dir, 'nested', '.claude')).sort()).toEqual(['settings.json', 'settings.json.bak']);
  }));

it('prints in dry-run and creates nothing; an edit that changes nothing writes nothing', () =>
  withDir(async (dir) => {
    const lines: string[] = [];
    const path = join(dir, 'new', 'settings.json');
    const result = await applyEdit({ path, format: 'json', set: [{ key: ['x'], value: 1 }] }, { dryRun: true, log: (l) => lines.push(l) });
    expect(result).toMatchObject({ written: false, dryRun: true });
    expect(lines[0]).toBe(`dry-run ${path}`);
    expect(existsSync(join(dir, 'new'))).toBe(false);

    const same = join(dir, 'same.json');
    writeFileSync(same, '{\n  "x": 1\n}\n');
    expect((await applyEdit({ path: same, format: 'json', set: [{ key: ['x'], value: 1 }] }, { log: () => {} })).written).toBe(false);
    expect(existsSync(`${same}.bak`)).toBe(false);
  }));
