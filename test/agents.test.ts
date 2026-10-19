import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AGENTS, agentHome, distinctAgents } from '../src/agents.js';
import { AGENT_IDS } from '../src/types.js';

it('describes every agent once, under its own id', () => {
  expect(Object.keys(AGENTS).sort()).toEqual([...AGENT_IDS].sort());
  for (const [id, spec] of Object.entries(AGENTS)) expect(spec.id).toBe(id);
});

it('names an executable for every cli mechanism', () => {
  for (const spec of Object.values(AGENTS)) {
    if (Object.values(spec.install).includes('cli')) expect(spec.executable).toBeDefined();
  }
});

it('puts the Codex agents on level 2 with shared files', () => {
  expect(AGENTS['codex-cli'].level).toBe(2);
  expect(AGENTS['codex-desktop'].sharesWith).toBe('codex-cli');
  expect(agentHome('codex-desktop', '/h', {})).toBe(agentHome('codex-cli', '/h', {}));
});

it('resolves the home folder, moved by its environment variable', () => {
  expect(agentHome('claude-code', '/h', {})).toBe(join('/h', '.claude'));
  expect(agentHome('claude-code', '/h', { CLAUDE_CONFIG_DIR: '/x' })).toBe('/x');
  expect(agentHome('droid', '/h', { CLAUDE_CONFIG_DIR: '/x' })).toBe(join('/h', '.factory'));
  expect(agentHome('claude-desktop', '/h', {})).toBeUndefined();
});

it('makes one install for Codex CLI and Codex desktop together', () => {
  expect(distinctAgents(['codex-cli', 'codex-desktop', 'cursor'])).toEqual(['codex-cli', 'cursor']);
  expect(distinctAgents(['codex-desktop'])).toEqual(['codex-desktop']);
});
