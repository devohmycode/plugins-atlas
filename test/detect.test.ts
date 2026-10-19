import { join } from 'node:path';
import { expect, it } from 'vitest';
import { detectAgents, type DetectContext } from '../src/detect.js';

function ctx(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, ...paths: string[]): DetectContext {
  const wanted = new Set(paths);
  return { platform, home, env, exists: (path) => wanted.has(path) };
}

const linuxEnv = { PATH: '/usr/bin:/home/ada/.local/bin' };

it('detects an agent from its executable on the PATH or its config folder', () => {
  expect(detectAgents(ctx('linux', '/home/ada', linuxEnv, '/home/ada/.local/bin/copilot'))).toEqual(['copilot-cli']);
  expect(detectAgents(ctx('linux', '/home/ada', linuxEnv, join('/home/ada', '.factory')))).toEqual(['droid']);
  expect(detectAgents(ctx('linux', '/home/ada', { ...linuxEnv, CLAUDE_CONFIG_DIR: '/cfg' }, '/cfg'))).toEqual(['claude-code']);
  expect(detectAgents(ctx('linux', '/home/ada', linuxEnv))).toEqual([]);
});

it('finds a Windows executable through PATHEXT', () => {
  const env = { Path: 'C:\\bin', PATHEXT: '.EXE;.CMD' };
  expect(detectAgents(ctx('win32', 'C:\\Users\\ada', env, 'C:\\bin\\claude.cmd'))).toEqual(['claude-code']);
});

it('does not treat the Codex CLI files as the desktop app', () => {
  expect(detectAgents(ctx('linux', '/home/ada', linuxEnv, join('/home/ada', '.codex'), '/usr/bin/codex'))).toEqual(['codex-cli']);
  expect(detectAgents({ platform: 'linux', home: '/h', env: linuxEnv, exists: () => true })).not.toContain('codex-desktop');
  expect(detectAgents(ctx('darwin', '/Users/ada', {}, '/Applications/ChatGPT.app'))).toEqual(['codex-desktop']);
});

it('detects the desktop applications', () => {
  expect(detectAgents(ctx('darwin', '/Users/ada', {}, '/Applications/Claude.app'))).toEqual(['claude-desktop']);
  const env = { LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' };
  expect(detectAgents(ctx('win32', 'C:\\Users\\ada', env, 'C:\\Users\\ada\\AppData\\Local\\Programs\\Cursor\\Cursor.exe'))).toEqual(['cursor']);
});
