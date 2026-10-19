import { githubFromUrl } from './id.js';
import type { Components, MarketplaceSource, PluginSource } from './types.js';

export type RiskLevel = 'high' | 'medium' | 'info';

export type RiskCode =
  | 'pipe-to-shell'
  | 'unpinned-package'
  | 'secret-path'
  | 'foreign-url'
  | 'hook-command'
  | 'unpinned-source'
  | 'sensitive-name'
  | 'text-only';

export interface Risk {
  level: RiskLevel;
  code: RiskCode;
  detail: string;
}

export interface RiskInput {
  components: Components;
  /** Where the plugin's files come from. Absent: not judged. */
  source?: PluginSource;
  marketplace: MarketplaceSource;
  /** Declared repository. Its host is allowed for a remote URL. */
  repositoryUrl?: string;
}

/** Hosts of registries and code hosts a command may legitimately reach. */
const KNOWN_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
  'npmjs.com',
  'pypi.org',
  'files.pythonhosted.org',
  'registry.modelcontextprotocol.io',
]);

const LEVEL_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, info: 2 };
const SENSITIVE_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
const PIPE_TO_SHELL = /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(?:iex|Invoke-Expression)\b/i;
const SECRET_PATH = /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[\\/]\.(?:ssh|aws)(?![a-z0-9])/i;

/**
 * Reads hooks and MCP servers as text. Nothing is executed.
 * High: a download piped into a shell, `npx -y` or `uvx` without a version, a secret path, or a URL in a hook
 * or local server command whose host is neither the repository nor a known registry.
 * Medium: every command hook (it runs on its event without asking), a remote MCP server on such a host,
 * a source pinned by neither `ref` nor `sha`, a variable name that carries a credential word.
 * Info: a plugin made only of skills, commands and agents.
 */
export function assessRisks(input: RiskInput): Risk[] {
  const risks: Risk[] = [];
  const add = (level: RiskLevel, code: RiskCode, detail: string) => {
    if (!risks.some((r) => r.code === code && r.detail === detail)) risks.push({ level, code, detail });
  };
  const allowed = allowedHosts(input);
  const scan = (where: string, text: string) => {
    if (PIPE_TO_SHELL.test(text)) add('high', 'pipe-to-shell', `${where} downloads and runs a script`);
    const unpinned = unpinnedPackage(text);
    if (unpinned) add('high', 'unpinned-package', `${where} runs ${unpinned} without a version`);
    if (SECRET_PATH.test(text)) add('high', 'secret-path', `${where} reads ~/.ssh or ~/.aws`);
    for (const host of hostsIn(text)) {
      if (!allowed.has(host)) add('high', 'foreign-url', `${where} reaches ${host}, neither the repository nor a registry`);
    }
  };
  const { components } = input;
  for (const hook of components.hooks) {
    const where = `Hook ${hook.event}`;
    add('medium', 'hook-command', `${where} runs \`${hook.command}\``);
    scan(where, hook.command);
  }
  for (const server of components.mcpServers) {
    const where = `MCP server ${server.name}`;
    scan(where, [server.command, ...(server.args ?? []), ...Object.values(server.env ?? {})].filter(Boolean).join(' '));
    // A remote server runs nothing here: an unknown host is worth reading, not a block. A URL in a command stays high.
    const remote = hostOf(server.url);
    if (remote && !allowed.has(remote)) add('medium', 'foreign-url', `${where} is a remote server at ${remote}, neither the repository nor a registry`);
    for (const name of Object.keys(server.env ?? {})) {
      const hit = SENSITIVE_NAME.exec(name);
      if (hit) add('medium', 'sensitive-name', `${where} variable ${name} contains ${hit[0].toUpperCase()}`);
    }
  }
  const source = input.source;
  if (source && source.kind !== 'path' && !source.ref && !source.sha) add('medium', 'unpinned-source', 'Plugin source has neither ref nor sha');
  if (source?.kind === 'path' && !input.marketplace.ref) add('medium', 'unpinned-source', 'Marketplace source has no ref');
  if (components.hooks.length === 0 && components.mcpServers.length === 0) {
    add('info', 'text-only', 'Only skills, commands and agents');
  }
  return risks.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/** An exact npm or PEP 440 version: `1.2.3`, `1.2.3-beta.1`, `1.0rc1`. A dist-tag, `*` or a range is not one. */
const EXACT_VERSION = /^v?\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;

function isExact(version: string): boolean {
  return EXACT_VERSION.test(version.replace(/["';),]+$/, ''));
}

/** The first `npx -y` or `uvx` package with no exact version, or undefined. */
function unpinnedPackage(text: string): string | undefined {
  for (const match of text.matchAll(/(?:^|[\s;&|"'])npx\s+((?:-{1,2}[^\s]+\s+)*)([^\s-][^\s]*)/gi)) {
    const flags = match[1] ?? '';
    const pkg = match[2] ?? '';
    if (!/(?:^|\s)(?:-y|--yes)(?:\s|$)/.test(flags)) continue;
    // `@scope/name@1.2.3` or `name@1.2.3`: the version follows the last `@` after the first character.
    const at = pkg.lastIndexOf('@');
    if (at <= 0 || !isExact(pkg.slice(at + 1))) return `npx ${pkg}`;
  }
  for (const match of text.matchAll(/(?:^|[\s;&|"'])uvx\s+((?:-{1,2}[^\s]+\s+)*)([^\s-][^\s]*)/gi)) {
    const pkg = match[2] ?? '';
    const version = /(?:==|@)([^=@]*)$/.exec(pkg)?.[1];
    if (version === undefined || !isExact(version)) return `uvx ${pkg}`;
  }
  return undefined;
}

function allowedHosts(input: RiskInput): Set<string> {
  const allowed = new Set(KNOWN_HOSTS);
  for (const url of [input.repositoryUrl, input.marketplace.kind === 'git' ? input.marketplace.url : undefined]) {
    const host = hostOf(url);
    if (host) allowed.add(host);
  }
  return allowed;
}

function hostsIn(text: string): string[] {
  const hosts = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s'")`]+/gi)) {
    const host = hostOf(match[0]);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (githubFromUrl(url)) return 'github.com';
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}
