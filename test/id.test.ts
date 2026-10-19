import { expect, it } from 'vitest';
import { formatPluginId, IdError, marketplaceSourceId, parseMarketplaceSourceId, parsePluginId } from '../src/id.js';

it('parses and formats plugin@marketplace', () => {
  expect(parsePluginId('code-review@claude-plugins-official')).toEqual({ plugin: 'code-review', marketplace: 'claude-plugins-official' });
  expect(formatPluginId({ plugin: 'a.b_c', marketplace: 'm1' })).toBe('a.b_c@m1');
});

it('rejects an empty, spaced, option-like or malformed id', () => {
  for (const id of ['', ' ', 'a b@m', 'plugin', '@m', 'p@', 'p@m@x', '-y', '-y@m', 'p@-m', '../p@m', 'p..q@m', 'p/q@m']) {
    expect(() => parsePluginId(id), id).toThrow(IdError);
  }
  expect(() => formatPluginId({ plugin: '-y', marketplace: 'm' })).toThrow(IdError);
});

it('names a marketplace by its GitHub repository, whatever the URL form', () => {
  expect(marketplaceSourceId({ kind: 'github', repo: 'anthropics/claude-plugins-official', ref: 'v1' })).toBe(
    'github:anthropics/claude-plugins-official',
  );
  expect(marketplaceSourceId({ kind: 'git', url: 'https://github.com/a/b.git' })).toBe('github:a/b');
  expect(marketplaceSourceId({ kind: 'git', url: 'git@github.com:a/b.git' })).toBe('github:a/b');
  expect(marketplaceSourceId({ kind: 'git', url: 'https://gitlab.com/a/b.git' })).toBe('https://gitlab.com/a/b.git');
});

it('round-trips a marketplace id and rejects an unusable one', () => {
  expect(parseMarketplaceSourceId('github:a/b')).toEqual({ kind: 'github', repo: 'a/b' });
  expect(parseMarketplaceSourceId('https://gitlab.com/a/b.git')).toEqual({ kind: 'git', url: 'https://gitlab.com/a/b.git' });
  for (const id of ['', 'github:a', 'github:a/b/c', 'github:-a/b', '-y', 'not a url', 'file:///etc', 'https://github.com/a/b']) {
    expect(() => parseMarketplaceSourceId(id), id).toThrow(IdError);
  }
});
