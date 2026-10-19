import { z } from 'zod';
import { fetchJsonPages, type FetchOptions } from '../http.js';
import { githubFromUrl, isName } from '../id.js';
import { ContractError, type Source } from '../source.js';
import type { MarketplaceSource, RawPlugin } from '../types.js';

const BASE = 'https://claude-plugins.dev/api/plugins';
const PAGE_SIZE = 100;
/** Pages fetched at once. */
const CONCURRENCY = 4;

const pageSchema = z.object({ plugins: z.array(z.unknown()), total: z.number().int().nonnegative() });

const entrySchema = z.object({
  name: z.string().min(1),
  /** `@owner/marketplace-name`. */
  namespace: z.string(),
  /** The marketplace's repository. */
  gitUrl: z.string(),
  description: z.string().nullish(),
  version: z.string().nullish(),
  author: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
  category: z.string().nullish(),
  metadata: z.object({ repository: z.string().nullish() }).loose().nullish(),
});

function readPage(body: unknown): z.infer<typeof pageSchema> {
  const page = pageSchema.safeParse(body);
  if (!page.success) throw new ContractError('claude-plugins.dev', `page: ${page.error.issues[0]?.path.join('.') ?? '?'}`);
  return page.data;
}

/**
 * Some directory texts are UTF-8 read as Latin-1 upstream (`rÃ´les` for `rôles`). Decoding them again fixes them;
 * a text that does not decode cleanly, or has no such sequence, is kept as it is.
 */
export function repairMojibake(text: string): string {
  if (!/[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–-™]/.test(text)) return text;
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const byte = code <= 0xff ? code : CP1252.get(code);
    if (byte === undefined) return text;
    bytes.push(byte);
  }
  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('�') ? text : fixed;
}

/** Windows-1252 characters of bytes 0x80 to 0x9F, the way most mojibake was decoded. */
const CP1252 = new Map<number, number>(
  [
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
    [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
    [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ],
);

/**
 * One directory entry as a raw plugin. The directory names the plugin and its marketplace, not where its files
 * are, so `source` stays empty until the marketplace file is read. An entry that names no usable marketplace is dropped.
 */
export function mapEntry(value: unknown): RawPlugin | undefined {
  const parsed = entrySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const e = parsed.data;
  const marketplaceName = /^@[^/\s]+\/([^/\s]+)$/.exec(e.namespace)?.[1];
  if (!marketplaceName || !isName(marketplaceName) || !isName(e.name)) return undefined;
  const repo = githubFromUrl(e.gitUrl);
  const source: MarketplaceSource = repo ? { kind: 'github', repo } : { kind: 'git', url: e.gitUrl };
  if (!repo && !/^https:\/\/\S+$/.test(e.gitUrl)) return undefined;
  const keywords = e.keywords?.filter(Boolean) ?? [];
  return {
    origin: 'claude-plugins.dev',
    name: e.name,
    marketplace: { name: marketplaceName, source },
    ...(e.description ? { description: repairMojibake(e.description.trim()) } : {}),
    ...(e.version ? { version: e.version } : {}),
    ...(e.author ? { author: { name: e.author } } : {}),
    ...(e.metadata?.repository ? { repository: { url: e.metadata.repository } } : {}),
    ...(e.category ? { category: e.category } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

/** The claude-plugins.dev directory, paged by offset. A page in the wrong shape throws {@link ContractError}. */
export function claudePluginsDev(opts: FetchOptions & { retryDelaysMs?: readonly number[] } = {}): Source {
  const page = async (offset: number) => {
    const [body] = await fetchJsonPages(`${BASE}?limit=${PAGE_SIZE}&offset=${offset}`, (b) => ({ items: [b] }), { ...opts, maxPages: 1 });
    return readPage(body);
  };
  return {
    origin: 'claude-plugins.dev',
    async fetch() {
      const first = await page(0);
      const offsets: number[] = [];
      for (let offset = PAGE_SIZE; offset < first.total; offset += PAGE_SIZE) offsets.push(offset);
      const entries = [...first.plugins];
      for (let i = 0; i < offsets.length; i += CONCURRENCY) {
        const pages = await Promise.all(offsets.slice(i, i + CONCURRENCY).map(page));
        for (const p of pages) entries.push(...p.plugins);
      }
      return entries.map(mapEntry).filter((plugin): plugin is RawPlugin => plugin !== undefined);
    },
  };
}
