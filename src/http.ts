import { VERSION } from './version.js';

/** Stop a cursor that never ends. Callers can pass a lower cap. */
export const MAX_PAGES = 500;
const TIMEOUT_MS = 30_000;
export const USER_AGENT = `plugins-atlas/${VERSION}`;

/** The only hosts that ever receive `GITHUB_TOKEN`. */
const GITHUB_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);

export class HttpError extends Error {
  readonly name = 'HttpError';
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export class NotJsonError extends Error {
  readonly name = 'NotJsonError';
  constructor(
    readonly url: string,
    options?: { cause?: unknown },
  ) {
    super(`Response from ${url} is not JSON`);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export class NotTextError extends Error {
  readonly name = 'NotTextError';
  constructor(readonly url: string) {
    super(`Response from ${url} is not text`);
  }
}

export class PageLimitError extends Error {
  readonly name = 'PageLimitError';
  constructor(
    readonly maxPages: number,
    readonly url: string,
  ) {
    super(`Page limit of ${maxPages} reached before ${url}`);
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Read for `GITHUB_TOKEN`. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

interface Page<T> {
  items: T[];
  nextUrl?: string;
}

/** Request headers, with the GitHub token only for an https GitHub host. */
export function requestHeaders(url: string, accept: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept };
  const token = env.GITHUB_TOKEN?.trim();
  if (token) {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'https:' && GITHUB_HOSTS.has(hostname)) headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * GET JSON once. No retry. Sends a User-Agent and aborts after the timeout.
 * A body that does not parse throws {@link NotJsonError}.
 */
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetch ?? fetch;
  const res = await fetchImpl(url, {
    headers: requestHeaders(url, 'application/json', opts.env),
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(url, res.status);
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new NotJsonError(url, { cause: err });
  }
}

const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);

/**
 * GET text once. No retry. Accepts `text/plain` and `text/markdown`.
 * Sends a User-Agent and aborts after the timeout.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const fetchImpl = opts.fetch ?? fetch;
  const res = await fetchImpl(url, {
    headers: requestHeaders(url, 'text/plain, text/markdown', opts.env),
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(url, res.status);
  const media = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (media !== '' && !TEXT_TYPES.has(media)) throw new NotTextError(url);
  return res.text();
}

/** Waits before each retry of a page. */
const RETRY_DELAYS_MS = [1_000, 4_000];

/**
 * One page of a crawl: a timeout, a network error or a 5xx is retried twice, since one
 * slow page among hundreds would otherwise drop the whole source. A 4xx is final.
 */
async function fetchPage(url: string, opts: FetchOptions & { retryDelaysMs?: readonly number[] }): Promise<unknown> {
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchJson(url, opts);
    } catch (err) {
      const transient = err instanceof HttpError ? err.status >= 500 : !(err instanceof NotJsonError);
      if (!transient || attempt >= delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * Follows `nextUrl` until it is absent. The page after `maxPages` throws
 * {@link PageLimitError} and is not requested.
 */
export async function fetchJsonPages<T>(
  firstUrl: string,
  read: (body: unknown) => Page<T>,
  opts: FetchOptions & { maxPages?: number; retryDelaysMs?: readonly number[] } = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  let pages = 0;
  while (url !== undefined) {
    if (pages >= maxPages) throw new PageLimitError(maxPages, url);
    const page = read(await fetchPage(url, opts));
    pages += 1;
    items.push(...page.items);
    url = page.nextUrl;
  }
  return items;
}
