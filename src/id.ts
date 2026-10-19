import type { MarketplaceSource } from './types.js';

export class IdError extends Error {
  readonly name = 'IdError';
  constructor(id: string) {
    super(`Unusable id ${JSON.stringify(id)}`);
  }
}

export interface PluginId {
  plugin: string;
  marketplace: string;
}

/** A plugin or marketplace name: starts with a letter or digit, then letters, digits, `.`, `_`, `-`, never `..`. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isName(name: string): boolean {
  return NAME.test(name) && !name.includes('..');
}

/** `plugin@marketplace`, split. Anything else, or a name that could pass for an option, throws {@link IdError}. */
export function parsePluginId(id: string): PluginId {
  const parts = id.split('@');
  const [plugin, marketplace] = parts;
  if (parts.length !== 2 || plugin === undefined || marketplace === undefined || !isName(plugin) || !isName(marketplace)) {
    throw new IdError(id);
  }
  return { plugin, marketplace };
}

export function formatPluginId(id: PluginId): string {
  const text = `${id.plugin}@${id.marketplace}`;
  parsePluginId(text);
  return text;
}

const GITHUB_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `owner/repo` from a github.com URL (https or ssh), or undefined when it is not one. */
export function githubFromUrl(url: string): string | undefined {
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i.exec(url);
  let owner: string | undefined;
  let repo: string | undefined;
  if (ssh) {
    [, owner, repo] = ssh;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return undefined;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return undefined;
    [owner, repo] = parts;
  }
  repo = repo?.replace(/\.git$/, '');
  if (!owner || !repo || !GITHUB_PART.test(owner) || !GITHUB_PART.test(repo)) return undefined;
  return `${owner}/${repo}`;
}

function isGitUrl(url: string): boolean {
  if (/\s/.test(url) || url.startsWith('-')) return false;
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(url)) return true;
  try {
    return ['https:', 'http:', 'ssh:', 'git:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** A marketplace's id: `github:owner/repo`, or the git URL. A GitHub URL becomes the `github:` form. `ref` is not part of it. */
export function marketplaceSourceId(source: MarketplaceSource): string {
  if (source.kind === 'github') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.repo)) throw new IdError(source.repo);
    return `github:${source.repo}`;
  }
  const github = githubFromUrl(source.url);
  if (github) return `github:${github}`;
  if (!isGitUrl(source.url)) throw new IdError(source.url);
  return source.url;
}

/** The source behind a marketplace id, without `ref`. */
export function parseMarketplaceSourceId(id: string): MarketplaceSource {
  const source: MarketplaceSource = id.startsWith('github:')
    ? { kind: 'github', repo: id.slice('github:'.length) }
    : { kind: 'git', url: id };
  if (marketplaceSourceId(source) !== id) throw new IdError(id);
  return source;
}
