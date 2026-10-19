import { posix } from 'node:path';
import type { Components, Hook, McpServer } from './types.js';

/** Default locations (docs/agents.md). `.mcp.json` is Claude Code's; Droid, Codex and Cursor read `mcp.json`. */
const SKILLS_DIR = 'skills';
const COMMANDS_DIR = 'commands';
const AGENTS_DIR = 'agents';
const HOOKS_FILE = 'hooks/hooks.json';
const MCP_FILES = ['.mcp.json', 'mcp.json'];

/**
 * Manifests that declare component paths, in the order one is chosen. `.claude-plugin`, `.cursor-plugin`
 * and `.codex-plugin` share the path fields; a root `plugin.json` (Agent Plugins) declares none of its own.
 */
export const COMPONENT_MANIFESTS = ['.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json'];

export class ManifestError extends Error {
  readonly name = 'ManifestError';
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A manifest path, made relative to the plugin root. A path that leaves the plugin throws. */
export function pluginPath(field: string, path: string): string {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) {
    throw new ManifestError(field, `path ${JSON.stringify(path)} leaves the plugin`);
  }
  const normal = posix.normalize(path.replace(/\\/g, '/')).replace(/\/$/, '');
  return normal === '.' ? '' : normal;
}

/** Path fields hold a string or a list of strings. An object (inline config) gives no path. */
function paths(manifest: Json, field: string): string[] {
  const value = manifest[field];
  if (value === undefined || isObject(value)) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (typeof item !== 'string') throw new ManifestError(field, 'expected a path or a list of paths');
    return pluginPath(field, item);
  });
}

function manifestObject(manifest: unknown): Json {
  if (manifest === undefined) return {};
  if (!isObject(manifest)) throw new ManifestError('plugin.json', 'expected an object');
  if (manifest.name !== undefined && typeof manifest.name !== 'string') throw new ManifestError('name', 'expected a string');
  return manifest;
}

/** JSON files whose content {@link readComponents} needs: hooks and MCP files, default or declared, that exist. */
export function componentFiles(manifest: unknown, files: readonly string[]): string[] {
  const m = manifestObject(manifest);
  const present = new Set(files);
  const wanted = new Set([HOOKS_FILE, ...MCP_FILES, ...paths(m, 'hooks'), ...paths(m, 'mcpServers')]);
  return [...wanted].filter((path) => present.has(path));
}

function under(files: readonly string[], dir: string): string[] {
  const prefix = dir === '' ? '' : `${dir}/`;
  return files.filter((file) => file.startsWith(prefix));
}

/** Markdown files at or under the given files or folders. */
function markdown(files: readonly string[], roots: readonly string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    if (root.endsWith('.md')) {
      if (files.includes(root)) found.add(root);
      continue;
    }
    for (const file of under(files, root)) if (file.endsWith('.md')) found.add(file);
  }
  return [...found].sort();
}

/** Skill folders: a `SKILL.md` at a root, or one level below it. */
function skills(files: readonly string[], roots: readonly string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    const prefix = root === '' ? '' : `${root}/`;
    for (const file of under(files, root)) {
      const rest = file.slice(prefix.length).split('/');
      if (rest.length === 1 && rest[0] === 'SKILL.md') found.add(root);
      if (rest.length === 2 && rest[1] === 'SKILL.md') found.add(prefix + rest[0]);
    }
  }
  return [...found].sort();
}

function readHooks(field: string, value: unknown): Hook[] {
  if (!isObject(value)) throw new ManifestError(field, 'expected an object of hook events');
  // hooks.json wraps the events in `hooks`; the inline form in plugin.json is the events object itself.
  const events = isObject(value.hooks) ? value.hooks : value;
  const hooks: Hook[] = [];
  for (const [event, groups] of Object.entries(events)) {
    if (event === 'description') continue;
    if (!Array.isArray(groups)) throw new ManifestError(`${field}.${event}`, 'expected a list');
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) throw new ManifestError(`${field}.${event}`, 'expected { hooks: [...] }');
      const matcher = typeof group.matcher === 'string' ? group.matcher : undefined;
      for (const hook of group.hooks) {
        // shortcut: only `command` hooks are kept, since they are the ones that run; other types need their own risk rule.
        if (!isObject(hook) || hook.type !== 'command') continue;
        if (typeof hook.command !== 'string') throw new ManifestError(`${field}.${event}`, 'command hook without a command');
        hooks.push({ event, ...(matcher === undefined ? {} : { matcher }), command: hook.command });
      }
    }
  }
  return hooks;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function readMcp(field: string, value: unknown): McpServer[] {
  if (!isObject(value)) throw new ManifestError(field, 'expected an object of MCP servers');
  const servers = isObject(value.mcpServers) ? value.mcpServers : value;
  return Object.entries(servers).map(([name, config]) => {
    if (!isObject(config)) throw new ManifestError(`${field}.${name}`, 'expected an object');
    const server: McpServer = { name };
    if (typeof config.command === 'string') server.command = config.command;
    const args = strings(config.args);
    if (args) server.args = args;
    if (isObject(config.env)) server.env = Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, String(v)]));
    if (typeof config.url === 'string') server.url = config.url;
    return server;
  });
}

export interface ComponentInput {
  /** Parsed `plugin.json`, or undefined when the plugin has none. */
  manifest?: unknown;
  /** Every file of the plugin, relative to its root, with `/` separators. */
  files: readonly string[];
  /** Parsed content of each path {@link componentFiles} returned. */
  json: Readonly<Record<string, unknown>>;
}

/** What a plugin bundles, from its default folders and from the paths its manifest declares. */
export function readComponents(input: ComponentInput): Components {
  const m = manifestObject(input.manifest);
  const { files } = input;
  const fileJson = (path: string): unknown => {
    if (!(path in input.json)) throw new ManifestError(path, 'file was not read');
    return input.json[path];
  };
  const hookFiles = [...new Set([HOOKS_FILE, ...paths(m, 'hooks')])].filter((path) => files.includes(path));
  const mcpFiles = [...new Set([...MCP_FILES, ...paths(m, 'mcpServers')])].filter((path) => files.includes(path));
  return {
    skills: skills(files, [SKILLS_DIR, ...paths(m, 'skills')]),
    commands: markdown(files, [COMMANDS_DIR, ...paths(m, 'commands')]),
    agents: markdown(files, [AGENTS_DIR, ...paths(m, 'agents')]),
    hooks: [
      ...hookFiles.flatMap((path) => readHooks(path, fileJson(path))),
      ...(isObject(m.hooks) ? readHooks('hooks', m.hooks) : []),
    ],
    mcpServers: [
      ...mcpFiles.flatMap((path) => readMcp(path, fileJson(path))),
      ...(isObject(m.mcpServers) ? readMcp('mcpServers', m.mcpServers) : []),
    ],
  };
}
