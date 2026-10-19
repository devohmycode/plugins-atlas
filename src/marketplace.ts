import { z } from 'zod';
import { ManifestError, pluginPath } from './components.js';
import { githubFromUrl } from './id.js';
import type { Author, MarketplaceSource, Origin, PluginSource, RawPlugin } from './types.js';

export class MarketplaceError extends Error {
  readonly name = 'MarketplaceError';
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`marketplace.json ${field}: ${message}`);
  }
}

const SHA = /^[0-9a-f]{40}$/;

const pin = { ref: z.string().min(1).optional(), sha: z.string().regex(SHA).optional() };

const sourceSchema = z.union([
  z.string().min(1),
  // Codex `{ source: "local", path }` and Cursor `{ path }`: a folder of the marketplace.
  z.object({ source: z.literal('local'), path: z.string().min(1) }),
  z.object({ source: z.undefined(), path: z.string().min(1) }),
  z.object({ source: z.literal('github'), repo: z.string().min(1), path: z.string().optional(), ...pin }),
  z.object({ source: z.literal('url'), url: z.string().min(1), ...pin }),
  z.object({ source: z.literal('git-subdir'), url: z.string().min(1), path: z.string().min(1), ...pin }),
]);

const authorSchema = z.union([z.string(), z.object({ name: z.string(), email: z.string().optional(), url: z.string().optional() })]);

const entrySchema = z.object({
  name: z.string().min(1),
  source: z.unknown(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: authorSchema.optional(),
  repository: z.string().optional(),
  homepage: z.string().optional(),
  category: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const marketplaceSchema = z.object({
  name: z.string().min(1),
  owner: z.object({ name: z.string() }).loose().optional(),
  metadata: z.object({ pluginRoot: z.string().optional() }).loose().optional(),
  plugins: z.array(z.unknown()),
});

function fieldOf(error: z.ZodError, prefix: string): string {
  const path = error.issues[0]?.path ?? [];
  return [prefix, ...path.map(String)].filter(Boolean).join('.');
}

export interface Skipped {
  name?: string;
  field: string;
  reason: string;
}

export interface ParsedMarketplace {
  name: string;
  owner?: string;
  plugins: RawPlugin[];
  /** Entries that could not be read, each named. They do not fail the marketplace. */
  skipped: Skipped[];
}

/** `owner/repo` shorthand of `git-subdir`, or a GitHub URL, becomes a `github` source. */
function gitSource(url: string, field: string, extra: { ref?: string; sha?: string; path?: string }): PluginSource {
  const repo = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url) ? url : githubFromUrl(url);
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  if (repo) return { kind: 'github', repo, ...clean };
  if (/\s/.test(url) || url.startsWith('-')) throw new ManifestError(field, `unusable url ${JSON.stringify(url)}`);
  return { kind: 'git', url, ...clean };
}

function readSource(value: unknown, field: string, pluginRoot: string | undefined): PluginSource {
  const parsed = sourceSchema.safeParse(value);
  if (!parsed.success) throw new ManifestError(field, 'unknown source form');
  const source = parsed.data;
  if (typeof source === 'string' || source.source === 'local' || source.source === undefined) {
    const path = typeof source === 'string' ? source : source.path;
    // A bare name resolves under `metadata.pluginRoot`; `./x` is relative to the marketplace root.
    const relative = path.startsWith('./') || pluginRoot === undefined ? path : `${pluginRoot}/${path}`;
    return { kind: 'path', path: pluginPath(field, relative) };
  }
  const subPath = 'path' in source && source.path !== undefined ? pluginPath(`${field}.path`, source.path) : undefined;
  const extra = { ref: source.ref, sha: source.sha, path: subPath };
  if (source.source === 'github') return gitSource(source.repo, field, extra);
  return gitSource(source.url, field, extra);
}

function readAuthor(author: z.infer<typeof authorSchema> | undefined): Author | undefined {
  if (author === undefined) return undefined;
  return typeof author === 'string' ? { name: author } : author;
}

/** Reads a `marketplace.json`. A malformed file throws {@link MarketplaceError}; a malformed entry is skipped and named. */
export function parseMarketplace(json: unknown, origin: Origin, source: MarketplaceSource): ParsedMarketplace {
  const top = marketplaceSchema.safeParse(json);
  if (!top.success) throw new MarketplaceError(fieldOf(top.error, ''), top.error.issues[0]?.message ?? 'invalid');
  const { name, owner, metadata } = top.data;
  const pluginRoot = metadata?.pluginRoot === undefined ? undefined : pluginPath('metadata.pluginRoot', metadata.pluginRoot);
  const marketplace = { name, source, ...(owner ? { owner: owner.name } : {}) };
  const plugins: RawPlugin[] = [];
  const skipped: Skipped[] = [];
  top.data.plugins.forEach((value, index) => {
    const prefix = `plugins.${index}`;
    const entry = entrySchema.safeParse(value);
    if (!entry.success) {
      const rawName = (value as { name?: unknown } | null)?.name;
      skipped.push({ ...(typeof rawName === 'string' ? { name: rawName } : {}), field: fieldOf(entry.error, prefix), reason: 'invalid entry' });
      return;
    }
    const e = entry.data;
    try {
      const keywords = [...new Set([...(e.keywords ?? []), ...(e.tags ?? [])])];
      const repository = e.repository;
      const author = readAuthor(e.author);
      plugins.push({
        origin,
        name: e.name,
        marketplace,
        source: readSource(e.source, `${prefix}.source`, pluginRoot),
        ...(e.description === undefined ? {} : { description: e.description }),
        ...(e.version === undefined ? {} : { version: e.version }),
        ...(author === undefined ? {} : { author }),
        ...(repository === undefined ? {} : { repository: { url: repository } }),
        ...(e.category === undefined ? {} : { category: e.category }),
        ...(keywords.length === 0 ? {} : { keywords }),
      });
    } catch (err) {
      if (!(err instanceof ManifestError)) throw err;
      skipped.push({ name: e.name, field: err.field, reason: err.message });
    }
  });
  return { name, ...(owner ? { owner: owner.name } : {}), plugins, skipped };
}
