import { posix, win32 } from 'node:path';
import { AGENTS, agentHome } from './agents.js';
import { AGENT_IDS, type AgentId } from './types.js';

export interface DetectContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Injected so detection never reads the machine it is tested on. */
  exists: (path: string) => boolean;
}

/** Desktop applications whose presence marks an agent that has no executable of its own. */
const APPS: Partial<Record<AgentId, readonly string[]>> = {
  // `claude-desktop.exe` is the alias the Microsoft Store build puts in WindowsApps.
  'claude-desktop': ['Claude', 'claude-desktop'],
  'codex-desktop': ['ChatGPT', 'Codex'],
  cursor: ['Cursor'],
};

/** Agents found on this machine: executable on the PATH, config folder, or desktop app. */
export function detectAgents(ctx: DetectContext): AgentId[] {
  return AGENT_IDS.filter((id) => isDetected(id, ctx));
}

function isDetected(id: AgentId, ctx: DetectContext): boolean {
  if (appPaths(id, ctx).some(ctx.exists)) return true;
  // `~/.codex` and `codex` belong to the CLI: Codex desktop is marked by its application only.
  if (id === 'codex-desktop') return false;
  const spec = AGENTS[id];
  if (spec.executable && onPath(spec.executable, ctx)) return true;
  const home = agentHome(id, ctx.home, ctx.env);
  return home !== undefined && ctx.exists(home);
}

/** True when `name` is an executable file in one of the PATH folders. */
export function onPath(name: string, ctx: DetectContext): boolean {
  return whichPath(name, ctx) !== undefined;
}

/** The first `name` file in the PATH folders, with a PATHEXT extension on Windows, or undefined. */
export function whichPath(name: string, ctx: DetectContext): string | undefined {
  const path = ctx.platform === 'win32' ? win32 : posix;
  const dirs = (ctx.env.PATH ?? ctx.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = ctx.platform === 'win32' ? (ctx.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      for (const candidate of new Set([path.join(dir, name + ext.toLowerCase()), path.join(dir, name + ext)])) {
        if (ctx.exists(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function appPaths(id: AgentId, ctx: DetectContext): string[] {
  const names = APPS[id] ?? [];
  if (ctx.platform === 'darwin') {
    return names.flatMap((name) => [`/Applications/${name}.app`, posix.join(ctx.home, 'Applications', `${name}.app`)]);
  }
  if (ctx.platform !== 'win32') return [];
  const local = ctx.env.LOCALAPPDATA || win32.join(ctx.home, 'AppData', 'Local');
  return names.flatMap((name) => [
    win32.join(local, 'Microsoft', 'WindowsApps', `${name}.exe`),
    win32.join(local, 'Programs', name, `${name}.exe`),
  ]);
}
