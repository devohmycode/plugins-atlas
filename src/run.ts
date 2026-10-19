import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { whichPath, type DetectContext } from './detect.js';

const TIMEOUT_MS = 120_000;

export class RunError extends Error {
  readonly name = 'RunError';
}

/** One call of an agent's own command. */
export interface CliStep {
  executable: string;
  args: string[];
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (file: string, args: readonly string[], opts: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>;

export interface RunOptions extends DetectContext {
  dryRun?: boolean;
  log?: (line: string) => void;
  timeoutMs?: number;
  /** Injected in tests. Defaults to `execFile` without a shell. */
  exec?: Exec;
  /** Reads a Windows `.cmd` launcher. Injected in tests. */
  readText?: (path: string) => string;
}

const defaultExec: Exec = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(file, [...args], { timeout: opts.timeoutMs, env: opts.env, shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: err && !stderr ? err.message : String(stderr) });
    });
  });

/**
 * The file and leading arguments that run `executable`. On Windows a `.cmd` or `.bat` launcher cannot run without
 * a shell, so the npm launcher is read and its JavaScript target is run with this Node: no argument meets a shell.
 */
export function resolveExecutable(executable: string, opts: RunOptions): { file: string; prefix: string[] } {
  const found = whichPath(executable, opts);
  if (!found) throw new RunError(`${executable} is not on the PATH`);
  if (opts.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(found)) return { file: found, prefix: [] };
  const text = (opts.readText ?? ((path: string) => readFileSync(path, 'utf8')))(found);
  // npm launchers end with: "%_prog%"  "%dp0%\node_modules\pkg\bin\cli.js" %*
  const target = /"%dp0%\\([^"]+\.(?:c|m)?js)"\s+%\*/i.exec(text)?.[1];
  if (!target) throw new RunError(`${found} is not an npm launcher this tool can run without a shell`);
  return { file: process.execPath, prefix: [win32.join(win32.dirname(found), target)] };
}

/** Runs each step in order, and stops at the first failure. `dryRun` prints the commands and runs nothing. */
export async function runSteps(steps: readonly CliStep[], opts: RunOptions): Promise<ExecResult[]> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const results: ExecResult[] = [];
  for (const step of steps) {
    const shown = [step.executable, ...step.args].join(' ');
    if (opts.dryRun) {
      log(`dry-run ${shown}`);
      continue;
    }
    const { file, prefix } = resolveExecutable(step.executable, opts);
    const result = await (opts.exec ?? defaultExec)(file, [...prefix, ...step.args], { timeoutMs: opts.timeoutMs ?? TIMEOUT_MS, env: opts.env });
    if (result.code !== 0) throw new RunError(`${shown} failed (exit ${result.code}): ${result.stderr.trim().slice(0, 500)}`);
    results.push(result);
  }
  return results;
}
