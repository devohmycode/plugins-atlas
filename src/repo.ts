import { COMPONENT_MANIFESTS, componentFiles, readComponents } from './components.js';
import { fetchJson, fetchText, type FetchOptions } from './http.js';
import { githubFromUrl } from './id.js';
import type { Components, MarketplaceSource, PluginSource } from './types.js';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class RepoError extends Error {
  readonly name = 'RepoError';
}

/** Where a plugin's files are on GitHub: repository, revision, and the folder that is the plugin root. */
export interface GithubLocation {
  repo: string;
  /** A `sha` wins over a `ref`; `HEAD` when neither is declared. */
  revision: string;
  root: string;
}

export interface PluginFiles {
  location: GithubLocation;
  /** Every file of the plugin, relative to its root. */
  files: string[];
  manifest?: unknown;
  components: Components;
  readme?: string;
}

function marketplaceRepo(source: MarketplaceSource): { repo: string; ref?: string } | undefined {
  if (source.kind === 'github') return { repo: source.repo, ...(source.ref ? { ref: source.ref } : {}) };
  const repo = githubFromUrl(source.url);
  return repo ? { repo, ...(source.ref ? { ref: source.ref } : {}) } : undefined;
}

/** The GitHub location of a plugin, or undefined when its files are not on GitHub: "composants inconnus". */
export function locate(source: PluginSource, marketplace: MarketplaceSource): GithubLocation | undefined {
  if (source.kind === 'path') {
    const repo = marketplaceRepo(marketplace);
    return repo && { repo: repo.repo, revision: repo.ref ?? 'HEAD', root: source.path };
  }
  const repo = source.kind === 'github' ? source.repo : githubFromUrl(source.url);
  if (!repo) return undefined;
  return { repo, revision: source.sha ?? source.ref ?? 'HEAD', root: source.path ?? '' };
}

interface TreeEntry {
  path?: unknown;
  type?: unknown;
}

/** Every file path of one repository at one revision, from one recursive tree request. Nothing is cloned. */
async function fetchTree(repo: string, revision: string, opts: FetchOptions): Promise<string[]> {
  const url = `${API}/repos/${repo}/git/trees/${encodeURIComponent(revision)}?recursive=1`;
  const body = (await fetchJson(url, opts)) as { tree?: unknown; truncated?: unknown };
  if (!Array.isArray(body.tree)) throw new RepoError(`No file tree for ${repo}`);
  // shortcut: a truncated tree (over GitHub's 100,000 entries) fails the plugin; walk sub-trees if a real plugin hits it.
  if (body.truncated === true) throw new RepoError(`File tree of ${repo} is truncated`);
  return (body.tree as TreeEntry[])
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => entry.path as string);
}

export interface RepoOptions extends FetchOptions {
  /** Trees already asked, by `repo@revision`: the plugins of one marketplace cost one tree request. */
  trees?: Map<string, Promise<string[]>>;
}

/** Files under `root`, made relative to it. */
async function listFiles(location: GithubLocation, opts: RepoOptions): Promise<string[]> {
  const key = `${location.repo}@${location.revision}`;
  let tree = opts.trees?.get(key);
  if (!tree) {
    tree = fetchTree(location.repo, location.revision, opts);
    opts.trees?.set(key, tree);
  }
  const prefix = location.root === '' ? '' : `${location.root}/`;
  return (await tree).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

function rawUrl(location: GithubLocation, path: string): string {
  const full = location.root === '' ? path : `${location.root}/${path}`;
  return `${RAW}/${location.repo}/${encodeURIComponent(location.revision)}/${full.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Reads a plugin from GitHub file by file: its tree, its manifest, its hooks and MCP files, its README.
 * Nothing is cloned and nothing is run. Returns undefined when the plugin is not on GitHub.
 */
export async function readPluginRepo(
  source: PluginSource,
  marketplace: MarketplaceSource,
  opts: RepoOptions = {},
): Promise<PluginFiles | undefined> {
  const location = locate(source, marketplace);
  if (!location) return undefined;
  const files = await listFiles(location, opts);
  if (files.length === 0) throw new RepoError(`No files under ${location.root || '/'} in ${location.repo}`);
  const manifestPath = COMPONENT_MANIFESTS.find((path) => files.includes(path));
  const manifest = manifestPath === undefined ? undefined : await fetchJson(rawUrl(location, manifestPath), opts);
  const json: Record<string, unknown> = {};
  for (const path of componentFiles(manifest, files)) json[path] = await fetchJson(rawUrl(location, path), opts);
  const readmePath = files.find((file) => file.toLowerCase() === 'readme.md');
  const readme = readmePath === undefined ? undefined : await fetchText(rawUrl(location, readmePath), opts);
  return {
    location,
    files,
    ...(manifest === undefined ? {} : { manifest }),
    components: readComponents({ manifest, files, json }),
    ...(readme === undefined ? {} : { readme }),
  };
}
