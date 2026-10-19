import { join } from 'node:path';
import type { AgentId, Scope } from './types.js';

/**
 * How an install reaches the agent in one scope: its own command (`cli`), its files
 * (`files`), or only its application (`app`, nothing is written).
 */
export type Mechanism = 'cli' | 'files' | 'app';

export interface AgentSpec {
  id: AgentId;
  label: string;
  level: 1 | 2;
  /** Plugin manifests the agent reads, relative to the plugin root, in its lookup order. */
  manifests: readonly string[];
  /** Marketplace files it reads, relative to the marketplace root, in its lookup order. */
  marketplaces: readonly string[];
  /** The executable of its official command, when it has one. */
  executable?: string;
  /** Mechanism per scope. A scope absent here cannot be installed. */
  install: Partial<Record<Scope, Mechanism>>;
  /** Config folder under the home directory. Same name on Windows, macOS and Linux. */
  home?: string;
  /** Environment variable that moves `home`. */
  homeEnv?: string;
  /** Agent whose files this one shares; both make a single install. */
  sharesWith?: AgentId;
}

// Every value below comes from docs/agents.md (official docs read on 2026-10-19).
export const AGENTS: Record<AgentId, AgentSpec> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    level: 1,
    manifests: ['.claude-plugin/plugin.json'],
    marketplaces: ['.claude-plugin/marketplace.json'],
    executable: 'claude',
    install: { user: 'cli', project: 'cli' },
    home: '.claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
  },
  'claude-desktop': {
    id: 'claude-desktop',
    label: 'Claude Desktop / Cowork',
    level: 1,
    manifests: ['.claude-plugin/plugin.json'],
    marketplaces: ['.claude-plugin/marketplace.json'],
    // Installs belong to the claude.ai account; no outside mechanism is documented.
    install: { user: 'app' },
  },
  'copilot-cli': {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    level: 1,
    manifests: ['plugin.json', '.plugin/plugin.json', '.github/plugin/plugin.json', '.claude-plugin/plugin.json'],
    marketplaces: ['marketplace.json', '.plugin/marketplace.json', '.github/plugin/marketplace.json', '.claude-plugin/marketplace.json'],
    executable: 'copilot',
    // `copilot plugin install` has no scope option: the repository scope goes through its settings files.
    install: { user: 'cli', project: 'files' },
    home: '.copilot',
    homeEnv: 'COPILOT_HOME',
  },
  droid: {
    id: 'droid',
    label: 'Factory Droid',
    level: 1,
    manifests: ['.factory-plugin/plugin.json', '.claude-plugin/plugin.json'],
    marketplaces: ['.factory-plugin/marketplace.json', '.claude-plugin/marketplace.json'],
    executable: 'droid',
    install: { user: 'cli', project: 'cli' },
    home: '.factory',
  },
  'codex-cli': {
    id: 'codex-cli',
    label: 'Codex CLI',
    level: 2,
    manifests: ['plugin.json', '.codex-plugin/plugin.json'],
    marketplaces: ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'],
    executable: 'codex',
    // `codex plugin add` has no scope option: the project scope goes through `.codex/config.toml`.
    install: { user: 'cli', project: 'files' },
    home: '.codex',
    homeEnv: 'CODEX_HOME',
  },
  'codex-desktop': {
    id: 'codex-desktop',
    label: 'Codex desktop',
    level: 2,
    manifests: ['plugin.json', '.codex-plugin/plugin.json'],
    marketplaces: ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'],
    executable: 'codex',
    install: { user: 'cli', project: 'files' },
    home: '.codex',
    homeEnv: 'CODEX_HOME',
    sharesWith: 'codex-cli',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    level: 2,
    manifests: ['plugin.json', '.cursor-plugin/plugin.json'],
    marketplaces: ['.cursor-plugin/marketplace.json'],
    // Only `~/.cursor/plugins/local` is documented; the project scope has no documented file.
    // shortcut: the Windows home of `.cursor` is undocumented and assumed to be %USERPROFILE%, check when T35 starts.
    install: { user: 'files' },
    home: '.cursor',
  },
};

/** The agent's config folder, or undefined when it has none. `homeEnv` wins when set. */
export function agentHome(id: AgentId, home: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const spec = AGENTS[id];
  const moved = spec.homeEnv ? env[spec.homeEnv]?.trim() : undefined;
  if (moved) return moved;
  return spec.home === undefined ? undefined : join(home, spec.home);
}

/** One agent per set of shared files: `codex-desktop` folds into `codex-cli` when both are chosen. */
export function distinctAgents(ids: readonly AgentId[]): AgentId[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    const shared = AGENTS[id].sharesWith;
    return shared === undefined || !set.has(shared);
  });
}
