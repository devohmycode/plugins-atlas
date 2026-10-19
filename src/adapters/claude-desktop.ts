import { marketplaceArg, type Adapter } from './common.js';

/**
 * Claude Desktop / Cowork: installs belong to the claude.ai account and no outside mechanism is documented
 * (docs/agents.md). Install and uninstall print the steps in the application and write nothing.
 */
export const claudeDesktop: Adapter = {
  async known() {
    return new Map();
  },

  async install(plan, plugin, ctx) {
    const log = ctx.log ?? ((line: string) => console.log(line));
    log(`Claude Desktop: nothing is written. In the app, open Customize > Plugins:`);
    if (plan.actions.some((action) => action.kind === 'add-marketplace')) {
      log(`  Add > Add marketplace: ${marketplaceArg(plugin.marketplace.source)}`);
    }
    log(`  Discover: install ${plugin.name} from ${plugin.marketplace.name}`);
  },

  async uninstall(id, _scope, ctx) {
    const log = ctx.log ?? ((line: string) => console.log(line));
    log(`Claude Desktop: nothing is written. In the app, open Customize > Plugins, choose ${id}, then Remove.`);
  },

  async update(id, _scope, ctx) {
    const log = ctx.log ?? ((line: string) => console.log(line));
    log(`Claude Desktop: nothing is written. In the app, open Customize > Plugins, then Check for updates on the marketplace of ${id}.`);
    return true;
  },

  async installed() {
    // Kept on the claude.ai account; no local file is documented.
    return [];
  },
};
