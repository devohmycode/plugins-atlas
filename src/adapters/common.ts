import { readFile } from 'node:fs/promises';
import { parse } from 'smol-toml';
import { marketplaceSourceId } from '../id.js';
import type { InstallPlan } from '../plan.js';
import type { RepoOptions } from '../repo.js';
import { runSteps, type RunOptions } from '../run.js';
import type { MarketplaceSource, Plugin, Scope } from '../types.js';

/** Everything an adapter may touch: the machine (injected), the project folder, and the network for downloads. */
export interface AgentContext extends RunOptions {
  /** The project folder for the `project` scope. */
  cwd: string;
  repo?: RepoOptions;
}

export interface InstalledEntry {
  /** `plugin@marketplace` when the agent says which marketplace, else the plugin name. */
  id: string;
  scope: Scope;
  enabled: boolean;
  version?: string;
}

/** One agent's install, uninstall and listing, as docs/agents.md describes them. */
export interface Adapter {
  /** Marketplaces the agent already knows in this scope: name to source id, `unknown` when it does not say. */
  known(scope: Scope, ctx: AgentContext): Promise<Map<string, string>>;
  install(plan: InstallPlan, plugin: Plugin, ctx: AgentContext): Promise<void>;
  uninstall(id: string, scope: Scope, ctx: AgentContext): Promise<void>;
  installed(scope: Scope, ctx: AgentContext): Promise<InstalledEntry[]>;
  /** The agent's own update command, when docs/agents.md gives one for this scope. False: reinstall instead. */
  update?(id: string, scope: Scope, ctx: AgentContext): Promise<boolean>;
}

export class AdapterError extends Error {
  readonly name = 'AdapterError';
}

/** The source as `marketplace add` takes it: `owner/repo`, or the git URL, with `#ref` when pinned. */
export function marketplaceArg(source: MarketplaceSource): string {
  const base = source.kind === 'github' ? source.repo : source.url;
  return source.ref ? `${base}#${source.ref}` : base;
}

/** The source as Claude-format settings (`extraKnownMarketplaces`) declare it. */
export function settingsSource(source: MarketplaceSource): Record<string, string> {
  const pin: Record<string, string> = source.ref ? { ref: source.ref } : {};
  return source.kind === 'github' ? { source: 'github', repo: source.repo, ...pin } : { source: 'git', url: source.url, ...pin };
}

/** The source id of a `{ source: {...} }` registry or settings entry, or `unknown`. */
export function entrySourceId(entry: unknown): string {
  return sourceIdOf(typeof entry === 'object' && entry !== null ? (entry as { source?: unknown }).source : undefined);
}

/** A source id from a Claude-format settings source, or `unknown`. */
export function sourceIdOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'unknown';
  const v = value as { source?: unknown; repo?: unknown; url?: unknown };
  try {
    if (v.source === 'github' && typeof v.repo === 'string') return marketplaceSourceId({ kind: 'github', repo: v.repo });
    if ((v.source === 'git' || v.source === 'url') && typeof v.url === 'string') return marketplaceSourceId({ kind: 'git', url: v.url });
  } catch {
    // An unusable source is reported as unknown, so the plan refuses to reuse its name.
  }
  return 'unknown';
}

export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return readDoc(path, (text) => JSON.parse(text) as unknown);
}

export async function readTomlFile(path: string): Promise<Record<string, unknown>> {
  return readDoc(path, (text) => parse(text) as unknown);
}

async function readDoc(path: string, parseText: (text: string) => unknown): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  if (text.trim() === '') return {};
  const value = parseText(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AdapterError(`${path} does not hold an object`);
  return value as Record<string, unknown>;
}

export function objectAt(doc: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = doc[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The JSON a `--json` command printed: the whole output, else its last line that parses.
 * Several agents document a JSON output without a full schema, so readers stay lenient.
 */
export function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const lines = stdout.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // Try the line before.
      }
    }
    return undefined;
  }
}

/** The objects of a JSON output: the array itself, or the first array-valued field among `keys`. */
export function objectsIn(value: unknown, keys: readonly string[]): Record<string, unknown>[] {
  const list = Array.isArray(value)
    ? value
    : keys.map((key) => (value as Record<string, unknown> | undefined)?.[key]).find(Array.isArray) ?? [];
  return (list as unknown[]).filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Runs a read-only command even in dry-run, and returns its parsed JSON output. */
export async function readCommand(executable: string, args: string[], ctx: AgentContext): Promise<unknown> {
  const [result] = await runSteps([{ executable, args }], { ...ctx, dryRun: false });
  return parseJsonOutput(result?.stdout ?? '');
}
