import { expect, it } from 'vitest';
import { compatibleAgents } from '../src/compat.js';

it('a .claude-plugin manifest reaches every level 1 agent', () => {
  expect(compatibleAgents({ files: ['.claude-plugin/plugin.json', 'skills/a/SKILL.md'] })).toEqual([
    'claude-code',
    'claude-desktop',
    'copilot-cli',
    'droid',
  ]);
});

it('a .github/plugin manifest alone reaches Copilot CLI only', () => {
  expect(compatibleAgents({ files: ['.github/plugin/plugin.json'] })).toEqual(['copilot-cli']);
});

it('both manifests reach the union, without duplicates', () => {
  expect(compatibleAgents({ files: ['.github/plugin/plugin.json', '.claude-plugin/plugin.json'] })).toEqual([
    'claude-code',
    'claude-desktop',
    'copilot-cli',
    'droid',
  ]);
});

it('a .factory-plugin manifest reaches Droid', () => {
  expect(compatibleAgents({ files: ['.factory-plugin/plugin.json'] })).toEqual(['droid']);
});

it('a plugin without a manifest reaches no agent, unless a Claude marketplace entry stands in for it', () => {
  expect(compatibleAgents({ files: ['skills/a/SKILL.md'] })).toEqual([]);
  expect(compatibleAgents({ files: ['skills/a/SKILL.md'], marketplaceFile: '.claude-plugin/marketplace.json' })).toEqual(['claude-code']);
  expect(compatibleAgents({ files: ['.github/plugin/plugin.json'], marketplaceFile: '.claude-plugin/marketplace.json' })).toEqual(['copilot-cli']);
});

it('reads the level 2 manifests', () => {
  expect(compatibleAgents({ files: ['.cursor-plugin/plugin.json'] })).toEqual(['cursor']);
  expect(compatibleAgents({ files: ['.codex-plugin/plugin.json'] })).toEqual(['codex-cli', 'codex-desktop']);
  expect(compatibleAgents({ files: ['plugin.json'] })).toEqual(['copilot-cli', 'codex-cli', 'codex-desktop', 'cursor']);
});
