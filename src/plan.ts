import { AGENTS, distinctAgents, type Mechanism } from './agents.js';
import { auditAllows, auditPlugin, type AuditResult } from './audit.js';
import { marketplaceSourceId } from './id.js';
import type { AgentId, MarketplaceSource, Plugin, Scope } from './types.js';

export class PlanError extends Error {
  readonly name = 'PlanError';
}

export type Action =
  | { kind: 'add-marketplace'; name: string; source: MarketplaceSource }
  | { kind: 'install'; id: string };

/** One agent's install, in order. Codex CLI and Codex desktop share files, so they are one plan. */
export interface InstallPlan {
  agents: AgentId[];
  scope: Scope;
  mechanism: Mechanism;
  actions: Action[];
  audit: AuditResult;
}

type PlanPlugin = Pick<Plugin, 'id' | 'marketplace' | 'source' | 'components' | 'repository' | 'agents'>;

export interface PlanInput {
  plugin: PlanPlugin;
  agents: readonly AgentId[];
  scope: Scope;
  /** Marketplaces each agent already knows: name to source id (`github:owner/repo` or git URL). */
  known: (agent: AgentId) => ReadonlyMap<string, string>;
  /** Persistent audit switch. `audit: false` allows a plan that would otherwise be refused. */
  config?: { audit?: boolean };
  /** Pass `false` for `--no-audit` on this invocation. */
  enabled?: boolean;
}

/**
 * Describes the install of one plugin, per agent. Nothing is written or run.
 * An incompatible agent, a scope the agent lacks, a marketplace name already taken by another source,
 * or a failed audit throws {@link PlanError} and gives no plan.
 */
export function planInstall(input: PlanInput): InstallPlan[] {
  const { plugin, scope } = input;
  const audit = auditPlugin(plugin);
  if (!auditAllows(audit, input.config ?? {}, input.enabled)) {
    const high = audit.risks.filter((risk) => risk.level === 'high').map((risk) => risk.detail);
    throw new PlanError(`Audit failed for ${plugin.id}: ${high.join('; ')}`);
  }
  const wanted = marketplaceSourceId(plugin.marketplace.source);
  return distinctAgents(input.agents).map((agent) => {
    const spec = AGENTS[agent];
    const shared = input.agents.filter((id) => id === agent || AGENTS[id].sharesWith === agent);
    if (!plugin.agents.includes(agent)) throw new PlanError(`${plugin.id} has no manifest ${spec.label} reads`);
    const mechanism = spec.install[scope];
    if (!mechanism) throw new PlanError(`${spec.label} cannot install in the ${scope} scope`);
    const actions: Action[] = [];
    const current = input.known(agent).get(plugin.marketplace.name);
    if (current === undefined) {
      actions.push({ kind: 'add-marketplace', name: plugin.marketplace.name, source: plugin.marketplace.source });
    } else if (current !== wanted) {
      throw new PlanError(`${spec.label} already has a marketplace ${plugin.marketplace.name} from ${current}, not ${wanted}`);
    }
    actions.push({ kind: 'install', id: plugin.id });
    return { agents: shared, scope, mechanism, actions, audit };
  });
}
