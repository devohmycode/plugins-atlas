import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { AGENT_IDS, ORIGINS, type Catalog } from './types.js';

/** The snapshot failed the schema, or the file is truncated. `field` is the part at fault. */
export class CatalogShapeError extends Error {
  readonly name = 'CatalogShapeError';
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
  }
}

const originSchema = z.enum(ORIGINS);
const agentSchema = z.enum(AGENT_IDS);
const count = z.number().int().nonnegative();
const pin = { ref: z.string().optional(), sha: z.string().optional(), path: z.string().optional() };

const marketplaceSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), repo: z.string().min(1), ref: z.string().optional() }),
  z.object({ kind: z.literal('git'), url: z.string().min(1), ref: z.string().optional() }),
]);

const pluginSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string() }),
  z.object({ kind: z.literal('github'), repo: z.string().min(1), ...pin }),
  z.object({ kind: z.literal('git'), url: z.string().min(1), ...pin }),
]);

const componentsSchema = z.object({
  skills: z.array(z.string()),
  commands: z.array(z.string()),
  agents: z.array(z.string()),
  hooks: z.array(z.object({ event: z.string(), matcher: z.string().optional(), command: z.string() })),
  mcpServers: z.array(
    z.object({
      name: z.string(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      url: z.string().optional(),
    }),
  ),
});

const catalogSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().min(1),
  themes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().optional() })),
  plugins: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      marketplace: z.object({
        name: z.string().min(1),
        source: marketplaceSourceSchema,
        owner: z.string().optional(),
        file: z.string().optional(),
      }),
      source: pluginSourceSchema.optional(),
      description: z.string().optional(),
      version: z.string().optional(),
      author: z.object({ name: z.string(), email: z.string().optional(), url: z.string().optional() }).optional(),
      repository: z.object({ url: z.string().min(1) }).optional(),
      category: z.string().optional(),
      keywords: z.array(z.string()),
      components: componentsSchema.optional(),
      agents: z.array(agentSchema),
      origins: z.array(originSchema),
      themes: z.array(z.string()),
      official: z.boolean(),
    }),
  ),
  stats: z.object({
    raw: z.partialRecord(originSchema, count),
    sources: z.partialRecord(originSchema, z.object({ status: z.enum(['ok', 'error']), count, error: z.string().optional() })),
    merged: count,
    official: count,
    byTheme: z.record(z.string(), count),
    byAgent: z.partialRecord(agentSchema, count),
    repos: z.object({ read: count, failed: count, unread: count }),
    repoErrors: z.array(z.object({ id: z.string(), error: z.string() })),
  }),
});

/** `data/catalog.json.gz` beside the package, or under the current directory. */
export function defaultCatalogPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'data', 'catalog.json.gz');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'data', 'catalog.json.gz');
}

/** Checks a decoded snapshot. A missing or mistyped field is named on the error. */
export function parseCatalog(value: unknown): Catalog {
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'catalog';
    throw new CatalogShapeError(field, issue?.message ?? 'invalid catalog');
  }
  return parsed.data as Catalog;
}

/** Gzip bytes of a snapshot the schema accepts. */
export function encodeCatalog(catalog: Catalog): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(parseCatalog(catalog))));
}

/** Writes `data/catalog.json.gz` (or `path`) and refuses a snapshot the schema rejects. */
export async function saveCatalog(catalog: Catalog, path = defaultCatalogPath()): Promise<void> {
  const bytes = encodeCatalog(catalog);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** Reads gzip bytes and checks them. A truncated file names `catalog`. */
export function decodeCatalog(buf: Buffer): Catalog {
  let value: unknown;
  try {
    value = JSON.parse(gunzipSync(buf).toString('utf8')) as unknown;
  } catch {
    throw new CatalogShapeError('catalog', 'truncated snapshot');
  }
  return parseCatalog(value);
}

export async function loadCatalog(path = defaultCatalogPath()): Promise<Catalog> {
  return decodeCatalog(await readFile(path));
}
