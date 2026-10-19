import { expect, it } from 'vitest';
import { fetchJson, fetchJsonPages, HttpError, NotJsonError, PageLimitError } from '../src/http.js';

function jsonFetch(body: unknown, onCall?: (init: RequestInit | undefined) => void): typeof fetch {
  return async (_url, init) => {
    onCall?.(init);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

it('sends a User-Agent and does not retry a failed request', async () => {
  let calls = 0;
  let ua = '';
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls += 1;
    ua = new Headers(init?.headers).get('user-agent') ?? '';
    throw new Error('down');
  };
  await expect(fetchJson('http://example.test/servers', { fetch: fetchImpl })).rejects.toThrow('down');
  expect(calls).toBe(1);
  expect(ua).toContain('plugins-atlas');
});

it('names a non-JSON body', async () => {
  const fetchImpl: typeof fetch = async () => new Response('nope', { status: 200 });
  await expect(fetchJson('http://example.test/servers', { fetch: fetchImpl })).rejects.toBeInstanceOf(NotJsonError);
});

it('names an HTTP error without a second attempt', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response('no', { status: 500 });
  };
  await expect(fetchJson('http://example.test/servers', { fetch: fetchImpl })).rejects.toBeInstanceOf(HttpError);
  expect(calls).toBe(1);
});

it('aborts when the timeout fires', async () => {
  const fetchImpl: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('missing signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  await expect(fetchJson('http://example.test/servers', { timeoutMs: 20, fetch: fetchImpl })).rejects.toMatchObject({
    name: 'TimeoutError',
  });
});

it('stops at the page cap and does not request the next page', async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ items: [String(url)], next: `${url}/next` }), { status: 200 });
  };
  await expect(
    fetchJsonPages('http://example.test/p', (body) => {
      const page = body as { items: string[]; next?: string };
      return { items: page.items, nextUrl: page.next };
    }, { maxPages: 2, fetch: fetchImpl }),
  ).rejects.toBeInstanceOf(PageLimitError);
  expect(seen).toEqual(['http://example.test/p', 'http://example.test/p/next']);
});

it('returns every page when the last one has no next url', async () => {
  const fetchImpl = jsonFetch({ items: [1] });
  const items = await fetchJsonPages('http://example.test/p', () => ({ items: [1] }), { fetch: fetchImpl });
  expect(items).toEqual([1]);
});

it('retries a crawl page after a 5xx or a timeout, never after a 4xx', async () => {
  const statuses = [503, 200];
  const flaky: typeof fetch = async () => new Response(JSON.stringify({ items: [1] }), { status: statuses.shift() ?? 200 });
  const read = (body: unknown) => ({ items: (body as { items: number[] }).items });
  expect(await fetchJsonPages('http://example.test/a', read, { fetch: flaky, retryDelaysMs: [0, 0] })).toEqual([1]);

  let calls = 0;
  const denied: typeof fetch = async () => {
    calls += 1;
    return new Response('no', { status: 401 });
  };
  await expect(fetchJsonPages('http://example.test/a', read, { fetch: denied, retryDelaysMs: [0, 0] })).rejects.toBeInstanceOf(HttpError);
  expect(calls).toBe(1);

  calls = 0;
  const down: typeof fetch = async () => {
    calls += 1;
    throw new Error('timeout');
  };
  await expect(fetchJsonPages('http://example.test/a', read, { fetch: down, retryDelaysMs: [0, 0] })).rejects.toThrow('timeout');
  expect(calls).toBe(3);
});

it('sends GITHUB_TOKEN only to the GitHub hosts over https', async () => {
  const env = { GITHUB_TOKEN: 'secret' };
  const auth: Record<string, string | null> = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    auth[String(url)] = new Headers(init?.headers).get('authorization');
    return new Response('{}', { status: 200 });
  };
  for (const url of [
    'https://api.github.com/repos/a/b',
    'https://raw.githubusercontent.com/a/b/main/x.json',
    'http://api.github.com/repos/a/b',
    'https://claude-plugins.dev/api/x',
    'https://api.github.com.evil.test/x',
  ]) {
    await fetchJson(url, { fetch: fetchImpl, env });
  }
  expect(auth).toEqual({
    'https://api.github.com/repos/a/b': 'Bearer secret',
    'https://raw.githubusercontent.com/a/b/main/x.json': 'Bearer secret',
    'http://api.github.com/repos/a/b': null,
    'https://claude-plugins.dev/api/x': null,
    'https://api.github.com.evil.test/x': null,
  });
});

it('sends no token when GITHUB_TOKEN is unset or blank', async () => {
  let auth: string | null = 'unset';
  const fetchImpl: typeof fetch = async (_url, init) => {
    auth = new Headers(init?.headers).get('authorization');
    return new Response('{}', { status: 200 });
  };
  await fetchJson('https://api.github.com/x', { fetch: fetchImpl, env: { GITHUB_TOKEN: ' ' } });
  expect(auth).toBeNull();
});
