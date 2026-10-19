import { IdError, parsePluginId } from './id.js';
import type { InstalledView } from './installed.js';
import { PlanError, planInstall, type InstallPlan, type PlanInput } from './plan.js';
import type { Catalog, Plugin } from './types.js';

export class BundleError extends Error {
  readonly name = 'BundleError';
}

export interface Bundle {
  pluginsAtlas: 1;
  plugins: string[];
}

/** The plugins tied to a catalog id, once each, sorted. */
export function exportBundle(view: Pick<InstalledView, 'matched'>): Bundle {
  const ids = new Set(view.matched.flatMap((row) => (row.plugin ? [row.plugin.id] : [])));
  return { pluginsAtlas: 1, plugins: [...ids].sort() };
}

/** Reads a bundle. A malformed id, or one that could pass for an option, stops the import before any action. */
export function parseBundle(text: string): Bundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BundleError('Not JSON');
  }
  const v = value as { pluginsAtlas?: unknown; plugins?: unknown };
  if (typeof value !== 'object' || value === null || v.pluginsAtlas !== 1) throw new BundleError('Expected { "pluginsAtlas": 1, "plugins": [...] }');
  if (!Array.isArray(v.plugins) || !v.plugins.every((id) => typeof id === 'string')) throw new BundleError('plugins: expected a list of ids');
  for (const id of v.plugins as string[]) {
    try {
      parsePluginId(id);
    } catch (err) {
      if (err instanceof IdError) throw new BundleError(`plugins: ${err.message}`);
      throw err;
    }
  }
  return { pluginsAtlas: 1, plugins: [...new Set(v.plugins as string[])] };
}

export interface ImportPlan {
  ready: { plugin: Plugin; plans: InstallPlan[] }[];
  /** Ids absent from the catalog: named and skipped. */
  missing: string[];
  /** Plugins the plan of T27 refused, each with why. */
  refused: { id: string; error: string }[];
}

/** The plan of T27 for each id of the bundle. Nothing is written or run. */
export function planImport(bundle: Bundle, catalog: Catalog, input: Omit<PlanInput, 'plugin'>): ImportPlan {
  const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  const result: ImportPlan = { ready: [], missing: [], refused: [] };
  for (const id of bundle.plugins) {
    const plugin = byId.get(id);
    if (!plugin) {
      result.missing.push(id);
      continue;
    }
    try {
      result.ready.push({ plugin, plans: planInstall({ ...input, plugin }) });
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      result.refused.push({ id, error: err.message });
    }
  }
  return result;
}
