import { expect, it } from 'vitest';
import { searchPlugins } from '../src/search.js';
import type { Plugin } from '../src/types.js';

function plugin(id: string, extra: Partial<Plugin> = {}): Plugin {
  const [name = id, market = 'm'] = id.split('@');
  return {
    id,
    name,
    marketplace: { name: market, source: { kind: 'github', repo: `o/${market}` } },
    keywords: [],
    agents: [],
    origins: ['github'],
    themes: ['other'],
    official: false,
    ...extra,
  };
}

const plugins = [
  plugin('zeta@m', { description: 'Docker deploy helper', themes: ['devops'], agents: ['claude-code'] }),
  plugin('alpha@official', { official: true, origins: ['official'], keywords: ['review'], themes: ['code-quality'], agents: ['claude-code', 'copilot-cli'] }),
  plugin('beta@official', { official: true, origins: ['official', 'claude-plugins.dev'], description: 'Code review', themes: ['code-quality'], agents: ['cursor'] }),
];

it('puts official plugins seen in several origins first, then official, then the rest', () => {
  expect(searchPlugins(plugins).map((p) => p.id)).toEqual(['beta@official', 'alpha@official', 'zeta@m']);
});

it('matches every word against name, description, keywords and id', () => {
  expect(searchPlugins(plugins, { query: 'review' }).map((p) => p.id)).toEqual(['beta@official', 'alpha@official']);
  expect(searchPlugins(plugins, { query: 'docker DEPLOY' }).map((p) => p.id)).toEqual(['zeta@m']);
  expect(searchPlugins(plugins, { query: 'docker review' })).toEqual([]);
});

it('filters by theme, by agent and by official', () => {
  expect(searchPlugins(plugins, { theme: 'devops' }).map((p) => p.id)).toEqual(['zeta@m']);
  expect(searchPlugins(plugins, { agent: 'claude-code' }).map((p) => p.id)).toEqual(['alpha@official', 'zeta@m']);
  expect(searchPlugins(plugins, { official: true, agent: 'cursor' }).map((p) => p.id)).toEqual(['beta@official']);
});
