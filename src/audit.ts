import { assessRisks, type Risk } from './risk.js';
import type { Plugin } from './types.js';

export type AuditStatus = 'pass' | 'fail' | 'unaudited';

export interface AuditResult {
  id: string;
  /**
   * `fail` when a high risk was found. `unaudited` when a component could not be read:
   * that is not a failure. `pass` otherwise, info and medium included.
   */
  status: AuditStatus;
  risks: Risk[];
  /** Set when `status` is `unaudited`. */
  reason?: string;
}

type AuditedPlugin = Pick<Plugin, 'id' | 'components' | 'source' | 'marketplace' | 'repository'>;

/** Reads the plugin's hooks, MCP servers and source. Nothing is executed. */
export function auditPlugin(plugin: AuditedPlugin): AuditResult {
  if (!plugin.components) return { id: plugin.id, status: 'unaudited', risks: [], reason: 'Components could not be read' };
  const risks = assessRisks({
    components: plugin.components,
    marketplace: plugin.marketplace.source,
    ...(plugin.source ? { source: plugin.source } : {}),
    ...(plugin.repository ? { repositoryUrl: plugin.repository.url } : {}),
  });
  return { id: plugin.id, status: risks.some((risk) => risk.level === 'high') ? 'fail' : 'pass', risks };
}

/** A high risk fails the audit. An unreadable plugin does not. */
export function failsAudit(result: AuditResult): boolean {
  return result.status === 'fail';
}

/**
 * The audit runs unless this invocation passes `false` (`--no-audit`) or the saved config
 * has `audit: false`. On is the default, and a high risk then blocks.
 */
export function auditEnabled(config: { audit?: boolean } = {}, enabled?: boolean): boolean {
  return enabled !== false && config.audit !== false;
}

/** Whether an install may proceed. Refusal is the default. */
export function auditAllows(result: AuditResult, config: { audit?: boolean } = {}, enabled?: boolean): boolean {
  return !auditEnabled(config, enabled) || !failsAudit(result);
}
