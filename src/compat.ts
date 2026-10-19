import { AGENTS } from './agents.js';
import { AGENT_IDS, type AgentId } from './types.js';

export interface CompatInput {
  /** Every file of the plugin, relative to its root. */
  files: readonly string[];
  /** The marketplace file the plugin is listed in, relative to the marketplace root. */
  marketplaceFile?: string;
}

/**
 * Agents that can install the plugin: those that read one of its manifests.
 * Claude Code also takes its marketplace entry as the manifest when the plugin has none (docs/agents.md).
 */
export function compatibleAgents(input: CompatInput): AgentId[] {
  const present = new Set(input.files);
  const hasAnyManifest = AGENT_IDS.some((id) => AGENTS[id].manifests.some((path) => present.has(path)));
  return AGENT_IDS.filter((id) => {
    const spec = AGENTS[id];
    if (spec.manifests.some((path) => present.has(path))) return true;
    return id === 'claude-code' && !hasAnyManifest && input.marketplaceFile === '.claude-plugin/marketplace.json';
  });
}
