import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compatibleAgents } from '../src/compat.js';
import { readComponents } from '../src/components.js';
import { parseMarketplace } from '../src/marketplace.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

it('reads the Codex marketplace: local, url and git-subdir sources', () => {
  const parsed = parseMarketplace(fixture('codex-marketplace.json'), 'codex', { kind: 'github', repo: 'openai/plugins' });
  expect(parsed.name).toBe('openai-curated');
  expect(parsed.skipped).toEqual([]);
  expect(parsed.plugins.map((p) => [p.name, p.source, p.category])).toEqual([
    ['linear', { kind: 'path', path: 'plugins/linear' }, 'Productivity'],
    ['crowdstrike-falcon-foundry', { kind: 'github', repo: 'CrowdStrike/foundry-skills' }, expect.any(String)],
    ['qodo', { kind: 'github', repo: 'qodo-ai/qodo-skills', path: 'codex-packages/qodo' }, expect.any(String)],
  ]);
});

it('reads the Cursor marketplace: a bare folder name', () => {
  const parsed = parseMarketplace(fixture('cursor-marketplace.json'), 'cursor', { kind: 'github', repo: 'cursor/plugins' });
  expect(parsed.name).toBe('cursor-plugins');
  expect(parsed.owner).toBe('Cursor');
  expect(parsed.plugins.map((p) => p.source)).toEqual([
    { kind: 'path', path: 'teaching' },
    { kind: 'path', path: 'continual-learning' },
    { kind: 'path', path: 'cursor-team-kit' },
  ]);
});

it('reads the components a Cursor manifest declares, and its mcp.json', () => {
  const files = [
    '.cursor-plugin/plugin.json',
    'skills/ship/SKILL.md',
    'agents/verifier.md',
    'rules/style.mdc',
    'mcp.json',
  ];
  const components = readComponents({
    manifest: fixture('cursor-plugin.json'),
    files,
    json: { 'mcp.json': { mcpServers: { linear: { url: 'https://mcp.linear.app/sse' } } } },
  });
  expect(components).toMatchObject({
    skills: ['skills/ship'],
    agents: ['agents/verifier.md'],
    mcpServers: [{ name: 'linear', url: 'https://mcp.linear.app/sse' }],
  });
  expect(compatibleAgents({ files })).toEqual(['cursor']);
});
