import { render } from 'ink';
import type { AgentContext } from '../adapters/index.js';
import { applyProposals, propose, type OperateDeps } from '../operate.js';
import { readPreview } from '../preview.js';
import type { AgentId, Catalog, Scope } from '../types.js';
import { App } from './App.js';

/** The tree in the terminal. Nothing is installed until the review is confirmed. */
export async function browse(opts: {
  catalog: Catalog;
  agents: AgentId[];
  ctx: AgentContext;
  operate: OperateDeps;
  scope?: Scope;
  /** `false` (`--no-audit`): a high-risk plugin ticked by itself may be installed. Otherwise the review shows it refused. */
  audit?: boolean;
}): Promise<void> {
  const { ctx, operate } = opts;
  const lifted = opts.audit === false;
  const app = render(
    <App
      catalog={opts.catalog}
      agents={opts.agents}
      {...(opts.scope ? { scope: opts.scope } : {})}
      propose={async (plugins, agents, scope, highRisk) => {
        // A high-risk plugin reaches here only when ticked by itself. As on the command line, only `--no-audit`
        // lifts the audit, and then for it alone; otherwise its proposal carries the refusal.
        const safe = plugins.filter((p) => !lifted || !highRisk.has(p.id));
        const risky = lifted ? plugins.filter((p) => highRisk.has(p.id)) : [];
        return [
          ...(await propose(safe, agents, ctx, { scope }, operate)),
          ...(risky.length ? await propose(risky, agents, ctx, { scope, audit: false }, operate) : []),
        ];
      }}
      apply={(proposals) => applyProposals(proposals, ctx, operate)}
      loadPreview={(plugin) => readPreview(plugin, operate.repo ?? ctx.repo ?? { env: ctx.env })}
    />,
    { incrementalRendering: false },
  );
  await app.waitUntilExit();
  // Ink leaves stdin raw and flowing after unmounting, which keeps the process alive.
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdin.unref();
}
