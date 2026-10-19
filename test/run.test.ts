import { posix } from 'node:path';
import { expect, it } from 'vitest';
import { resolveExecutable, RunError, runSteps, type Exec, type RunOptions } from '../src/run.js';

const linux = (paths: string[], exec?: Exec): RunOptions => ({
  platform: 'linux',
  home: '/h',
  env: { PATH: '/usr/bin' },
  exists: (p) => paths.includes(p),
  log: () => {},
  ...(exec ? { exec } : {}),
});

it('runs each step without a shell, as an argument list', async () => {
  const calls: [string, readonly string[]][] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, args]);
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const bin = posix.join('/usr/bin', 'claude');
  await runSteps(
    [
      { executable: 'claude', args: ['plugin', 'marketplace', 'add', 'acme/market'] },
      { executable: 'claude', args: ['plugin', 'install', 'demo@acme', '--scope', 'user'] },
    ],
    linux([bin], exec),
  );
  expect(calls).toEqual([
    [bin, ['plugin', 'marketplace', 'add', 'acme/market']],
    [bin, ['plugin', 'install', 'demo@acme', '--scope', 'user']],
  ]);
});

it('stops at the first failure and reports stderr', async () => {
  let calls = 0;
  const exec: Exec = async () => {
    calls += 1;
    return { code: 1, stdout: '', stderr: 'Marketplace not found\n' };
  };
  const steps = [{ executable: 'droid', args: ['plugin', 'install', 'x@m'] }, { executable: 'droid', args: ['plugin', 'list'] }];
  await expect(runSteps(steps, linux([posix.join('/usr/bin', 'droid')], exec))).rejects.toThrow('droid plugin install x@m failed (exit 1): Marketplace not found');
  expect(calls).toBe(1);
});

it('prints and runs nothing in dry-run, and names a missing executable', async () => {
  const lines: string[] = [];
  const exec: Exec = async () => {
    throw new Error('should not run');
  };
  await runSteps([{ executable: 'copilot', args: ['plugin', 'install', 'x@m'] }], { ...linux([], exec), dryRun: true, log: (l) => lines.push(l) });
  expect(lines).toEqual(['dry-run copilot plugin install x@m']);
  await expect(runSteps([{ executable: 'copilot', args: [] }], linux([], exec))).rejects.toThrow('copilot is not on the PATH');
});

it('runs a Windows npm launcher through Node, without cmd.exe', () => {
  const opts: RunOptions = {
    platform: 'win32',
    home: 'C:\\Users\\ada',
    env: { Path: 'C:\\npm', PATHEXT: '.EXE;.CMD' },
    exists: (p) => p === 'C:\\npm\\codex.cmd',
    readText: () => '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
  };
  expect(resolveExecutable('codex', opts)).toEqual({ file: process.execPath, prefix: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'] });
  expect(() => resolveExecutable('codex', { ...opts, readText: () => 'echo %*' })).toThrow(RunError);
  expect(resolveExecutable('claude', { ...opts, exists: (p) => p === 'C:\\npm\\claude.exe' })).toEqual({ file: 'C:\\npm\\claude.exe', prefix: [] });
});
