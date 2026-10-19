import { expect, it } from 'vitest';
import { ContractError } from '../src/source.js';
import { githubSearch, MissingTokenError, searchMarketplaces } from '../src/sources/github-search.js';

const marketplace = (name: string) => JSON.stringify({ name, plugins: [{ name: 'p', source: './p' }] });

function github(searchPages: unknown[], files: Record<string, string>) {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const text = String(url);
    seen.push(text);
    if (text.startsWith('https://api.github.com/search/code')) {
      const page = Number(new URL(text).searchParams.get('page'));
      return new Response(JSON.stringify(searchPages[page - 1] ?? { items: [] }), { status: 200 });
    }
    const body = files[text];
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetchImpl, seen };
}

const item = (repo: string, extra: object = {}) => ({ path: '.claude-plugin/marketplace.json', repository: { full_name: repo, ...extra } });
const raw = (repo: string) => `https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`;

it('is skipped and named without GITHUB_TOKEN', async () => {
  await expect(githubSearch({ env: {} }).fetch()).rejects.toBeInstanceOf(MissingTokenError);
  await expect(githubSearch({ env: { GITHUB_TOKEN: ' ' } }).fetch()).rejects.toThrow('GITHUB_TOKEN');
});

it('reads each marketplace found, once, and names the ones it could not read or refused', async () => {
  const { fetchImpl } = github(
    [{ items: [item('a/one'), item('a/one'), item('b/fork', { fork: true }), item('c/gone'), item('d/fake'), { path: 'docs/marketplace.json', repository: { full_name: 'e/x' } }] }],
    { [raw('a/one')]: marketplace('one'), [raw('d/fake')]: marketplace('claude-plugins-official') },
  );
  const result = await searchMarketplaces({ fetch: fetchImpl, env: { GITHUB_TOKEN: 't' } });
  expect(result.plugins.map((p) => [p.origin, p.name, p.marketplace.name, p.marketplace.file])).toEqual([
    ['github', 'p', 'one', '.claude-plugin/marketplace.json'],
  ]);
  expect(result.failed.map((f) => f.repo)).toEqual(['c/gone', 'd/fake']);
  expect(result.failed[1]?.error).toContain('reserved name');
});

it('stops at the first short page, and at ten pages', async () => {
  const full = { items: Array.from({ length: 100 }, (_, i) => item(`o/r${i}`)) };
  const short = github([full, { items: [item('o/last')] }], {});
  await searchMarketplaces({ fetch: short.fetchImpl, env: { GITHUB_TOKEN: 't' } });
  expect(short.seen.filter((u) => u.includes('/search/code'))).toHaveLength(2);

  const many = github(Array.from({ length: 12 }, () => full), {});
  await searchMarketplaces({ fetch: many.fetchImpl, env: { GITHUB_TOKEN: 't' } });
  expect(many.seen.filter((u) => u.includes('/search/code'))).toHaveLength(10);
});

it('says the contract changed on a search page of the wrong shape', async () => {
  const { fetchImpl } = github([{ results: [] }], {});
  await expect(searchMarketplaces({ fetch: fetchImpl, env: { GITHUB_TOKEN: 't' } })).rejects.toBeInstanceOf(ContractError);
});
