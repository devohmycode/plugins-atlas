import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { ADAPTERS, type Adapter, type AgentContext } from './adapters/index.js';
import { AGENTS, distinctAgents } from './agents.js';
import { auditEnabled, auditPlugin } from './audit.js';
import { exportBundle, parseBundle, planImport } from './bundle.js';
import { loadCatalog as loadCatalogFile } from './catalog.js';
import { complete, completionScript } from './completion.js';
import { serveMcp } from './mcp.js';
import { readConfig, type UserConfig } from './config.js';
import { detectAgents } from './detect.js';
import { IdError, parsePluginId } from './id.js';
import { installedView } from './installed.js';
import { componentLines } from './preview.js';
import type { RepoOptions } from './repo.js';
import { applyProposals, describe, propose, withComponents as withComponentsOf, type OperateDeps } from './operate.js';
import { loadLatestCatalog } from './refresh.js';
import { searchCatalog } from './search.js';
import { AGENT_IDS, type AgentId, type Catalog, type Plugin, type Scope } from './types.js';
import { outdatedRows, updatePlugin } from './update.js';
import { VERSION } from './version.js';

export interface CatalogFlags {
  offline?: boolean;
  refresh?: boolean;
  /** A snapshot path that replaces the latest one. */
  catalog?: string;
}

/** Everything the commands touch, injected in tests. */
export interface CliDeps {
  loadCatalog?: (flags: CatalogFlags) => Promise<Catalog>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  adapters?: Record<AgentId, Adapter>;
  readConfig?: () => UserConfig;
  readText?: (path: string) => string;
  /** Network options when a plugin's repository is read at install time. */
  repo?: RepoOptions;
  /** The machine: home, project folder, environment, file checks, command runner. */
  machine?: Omit<AgentContext, 'dryRun' | 'log'>;
}

class CliError extends Error {
  readonly name = 'CliError';
}

interface ScopeFlags {
  global?: boolean;
  project?: boolean;
}

function scopeOf(flags: ScopeFlags): Scope {
  if (flags.global && flags.project) throw new CliError('Choose -g or -p, not both');
  return flags.project ? 'project' : 'user';
}

function parseAgents(values: readonly string[] | undefined): AgentId[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((value) => {
    if (!(AGENT_IDS as readonly string[]).includes(value)) throw new CliError(`Unknown agent ${value}. Run plugins-atlas agents.`);
    return value as AgentId;
  });
}

/** `lstat`, not `existsSync`: a Microsoft Store app alias in WindowsApps fails `stat` but is there. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function defaultMachine(): Omit<AgentContext, 'dryRun' | 'log'> {
  return { platform: process.platform, home: homedir(), cwd: process.cwd(), env: process.env, exists: pathExists };
}

function line(plugin: Plugin): string {
  const agents = plugin.agents.length > 0 ? plugin.agents.join(',') : 'composants inconnus';
  return `${plugin.id}  [${agents}]  ${(plugin.description ?? '').replace(/\s+/g, ' ').slice(0, 100)}`;
}

export function createProgram(deps: CliDeps = {}): Command {
  const out = deps.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
  const err = deps.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const adapters = deps.adapters ?? ADAPTERS;
  const machine = deps.machine ?? defaultMachine();
  let failed = false;
  const fail = (message: string) => {
    failed = true;
    err(message);
  };

  const program = new Command('plugins-atlas')
    .description('Browse public agent plugins and install them into compatible agents.')
    .version(VERSION)
    .option('--offline', 'use the cached or bundled snapshot, never the network')
    .option('--refresh', 'check for a newer snapshot now (otherwise at most every 12 hours)')
    .option('--catalog <path>', 'read this snapshot file instead');

  const catalog = (): Promise<Catalog> => {
    const flags = program.opts<CatalogFlags>();
    if (deps.loadCatalog) return deps.loadCatalog(flags);
    return flags.catalog ? loadCatalogFile(flags.catalog) : loadLatestCatalog({ offline: flags.offline, refresh: flags.refresh });
  };
  const ctx = (dryRun = false): AgentContext => ({ ...machine, dryRun, log: out });
  const config = () => (deps.readConfig ?? readConfig)();
  const findPlugin = (cat: Catalog, id: string): Plugin | undefined => {
    try {
      parsePluginId(id);
    } catch (e) {
      if (e instanceof IdError) throw new CliError(e.message);
      throw e;
    }
    return cat.plugins.find((plugin) => plugin.id === id);
  };
  const operate: OperateDeps = { adapters, ...(deps.repo ? { repo: deps.repo } : {}), config: config(), warn: err };
  const withComponents = (plugin: Plugin) => withComponentsOf(plugin, operate, machine.env);
  const targetAgents = (flag: string[] | undefined): AgentId[] => parseAgents(flag) ?? detectAgents(machine);
  const withScope = (command: Command) =>
    command.addOption(new Option('-g, --global', 'user scope (default)')).addOption(new Option('-p, --project', 'project scope, in the current folder'));

  program
    .command('themes')
    .description('themes and their plugin counts')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const cat = await catalog();
      const rows = cat.themes.map((theme) => ({ id: theme.id, label: theme.label, count: cat.stats.byTheme[theme.id] ?? 0 }));
      if (opts.json) return out(JSON.stringify(rows, null, 2));
      for (const row of rows) out(`${row.id.padEnd(14)} ${String(row.count).padStart(6)}  ${row.label}`);
    });

  program
    .command('list')
    .description('search the catalog')
    .option('-q, --query <words>', 'words matched against name, description, keywords and id')
    .option('-t, --theme <id>', 'theme id')
    .option('-a, --agent <id>', 'only plugins this agent can install')
    .option('--official', 'only official plugins')
    .option('-n, --limit <count>', 'at most this many rows', '50')
    .option('--json', 'machine-readable output')
    .action(async (opts: { query?: string; theme?: string; agent?: string; official?: boolean; limit: string; json?: boolean }) => {
      const agent = opts.agent ? parseAgents([opts.agent])?.[0] : undefined;
      const found = searchCatalog(await catalog(), {
        ...(opts.query ? { query: opts.query } : {}),
        ...(opts.theme ? { theme: opts.theme } : {}),
        ...(agent ? { agent } : {}),
        ...(opts.official ? { official: true } : {}),
      });
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 0) throw new CliError('-n expects a whole number');
      const shown = found.slice(0, limit);
      if (opts.json) return out(JSON.stringify(shown, null, 2));
      for (const plugin of shown) out(line(plugin));
      if (found.length > shown.length) err(`${found.length - shown.length} more; use -n or a narrower query`);
    });

  program
    .command('agents')
    .description('agent ids accepted by --agent (★ = detected here)')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      const detected = new Set(detectAgents(machine));
      const rows = AGENT_IDS.map((id) => ({ id, label: AGENTS[id].label, level: AGENTS[id].level, detected: detected.has(id), install: AGENTS[id].install }));
      if (opts.json) return out(JSON.stringify(rows, null, 2));
      for (const row of rows) {
        const how = Object.entries(row.install).map(([scope, mechanism]) => `${scope}:${mechanism}`).join(' ');
        out(`${row.detected ? '★' : ' '} ${row.id.padEnd(15)} level ${row.level}  ${row.label}  (${how})`);
      }
    });

  program
    .command('show <id>')
    .description('one plugin, its components and its risks (risks on stderr)')
    .option('--json', 'machine-readable output')
    .action(async (id: string, opts: { json?: boolean }) => {
      const found = findPlugin(await catalog(), id);
      if (!found) throw new CliError(`${id} is not in the catalog`);
      const plugin = await withComponents(found);
      const audit = auditPlugin(plugin);
      if (opts.json) return out(JSON.stringify({ plugin, audit }, null, 2));
      out(plugin.id);
      if (plugin.description) out(plugin.description);
      out(`agents: ${plugin.agents.join(', ') || 'none known'}`);
      out(`themes: ${plugin.themes.join(', ')}`);
      if (plugin.repository) out(`repository: ${plugin.repository.url}`);
      for (const text of plugin.components ? componentLines(plugin.components) : ['composants inconnus']) out(text);
      if (audit.status === 'unaudited') err(`audit: unaudited (${audit.reason ?? ''})`);
      for (const risk of audit.risks) err(`${risk.level}: ${risk.detail}`);
    });

  withScope(program.command('install <ids...>'))
    .description('install plugins; without -y the plan is printed and nothing changes')
    .option('-a, --agent <ids...>', 'agents to install into (default: detected and compatible)')
    .option('-y, --yes', 'apply the plan')
    .option('--dry-run', 'print what would run or be written, change nothing')
    .option('--no-audit', 'let a high risk through for this run')
    .action(async (ids: string[], opts: ScopeFlags & { agent?: string[]; yes?: boolean; dryRun?: boolean; audit: boolean }) => {
      if (opts.yes && !opts.agent) throw new CliError('install -y needs -a: name the agents to write');
      const cat = await catalog();
      const scope = scopeOf(opts);
      const agents = targetAgents(opts.agent);
      if (agents.length === 0) throw new CliError('No agent detected; name one with -a');
      const apply = opts.yes === true || opts.dryRun === true;
      const c = ctx(opts.dryRun === true || !opts.yes);
      const plugins: Plugin[] = [];
      for (const id of ids) {
        const found = findPlugin(cat, id);
        if (found) plugins.push(found);
        else fail(`${id}: not in the catalog`);
      }
      const proposals = await propose(plugins, agents, c, { scope, audit: opts.audit, explicit: opts.agent !== undefined }, operate);
      const results = apply ? await applyProposals(proposals, c, operate) : proposals;
      for (const { plugin, agent, plan, error } of results) {
        if (error || !plan) {
          fail(`${plugin.id} → ${agent}: ${error ?? 'no plan'}`);
          continue;
        }
        if (!auditEnabled(config(), opts.audit) && plan.audit.status === 'fail') err(`${plugin.id}: audit off, high risks let through`);
        if (!apply) out(`${plugin.id} → ${agent} (${scope}, ${plan.mechanism}): ${describe(plan)}`);
        else if (!opts.dryRun) out(`${plugin.id}: installed for ${agent} (${scope})`);
      }
      if (!apply) err('Nothing changed. Pass -y with -a to apply, or --dry-run to see each command.');
    });

  withScope(program.command('uninstall <ids...>'))
    .description('remove plugins from agents')
    .option('-a, --agent <ids...>', 'agents to remove from (default: detected)')
    .option('--dry-run', 'print what would run or be written, change nothing')
    .action(async (ids: string[], opts: ScopeFlags & { agent?: string[]; dryRun?: boolean }) => {
      const scope = scopeOf(opts);
      for (const id of ids) {
        try {
          parsePluginId(id);
        } catch (e) {
          fail((e as Error).message);
          continue;
        }
        for (const agent of distinctAgents(targetAgents(opts.agent))) {
          if (!AGENTS[agent].install[scope]) continue;
          try {
            await adapters[agent].uninstall(id, scope, ctx(opts.dryRun));
            if (!opts.dryRun) out(`${id}: removed from ${agent} (${scope})`);
          } catch (e) {
            fail(`${id} → ${agent}: ${(e as Error).message}`);
          }
        }
      }
    });

  const view = async (agentFlag: string[] | undefined) => {
    const result = await installedView(await catalog(), targetAgents(agentFlag), ctx(), adapters);
    for (const e of result.errors) err(`${e.agent} (${e.scope}): ${e.error}`);
    return result;
  };

  program
    .command('installed')
    .description('plugins installed in each agent')
    .option('-a, --agent <ids...>', 'agents to read (default: detected)')
    .option('--json', 'machine-readable output')
    .action(async (opts: { agent?: string[]; json?: boolean }) => {
      const result = await view(opts.agent);
      if (opts.json) return out(JSON.stringify({ matched: result.matched.map(({ plugin: _, ...row }) => row), unknown: result.unknown }, null, 2));
      for (const row of [...result.matched, ...result.unknown]) {
        out(`${row.id}  ${row.agents.join(',')} (${row.scope})${row.enabled ? '' : '  disabled'}${row.version ? `  ${row.version}` : ''}${row.plugin ? '' : '  not in the catalog'}`);
      }
    });

  program
    .command('outdated')
    .description('installed plugins behind the catalog, or whose version is unknown')
    .option('-a, --agent <ids...>', 'agents to read (default: detected)')
    .option('--json', 'machine-readable output')
    .action(async (opts: { agent?: string[]; json?: boolean }) => {
      const rows = outdatedRows((await view(opts.agent)).matched);
      if (opts.json) return out(JSON.stringify(rows.map(({ plugin, ...row }) => ({ ...row, latest: plugin?.version })), null, 2));
      for (const row of rows) out(`${row.id}  ${row.agents.join(',')} (${row.scope})  ${row.version ?? '?'} → ${row.plugin?.version ?? '?'}  ${row.status}`);
    });

  program
    .command('update [ids...]')
    .description('update outdated plugins (all of them without ids); without -y the list is printed')
    .option('-a, --agent <ids...>', 'agents to update (default: detected)')
    .option('-y, --yes', 'apply')
    .option('--dry-run', 'print what would run or be written, change nothing')
    .option('--no-audit', 'let a high risk through for this run')
    .action(async (ids: string[], opts: { agent?: string[]; yes?: boolean; dryRun?: boolean; audit: boolean }) => {
      const rows = outdatedRows((await view(opts.agent)).matched).filter((row) => ids.length === 0 || ids.includes(row.id));
      for (const row of rows) {
        const plugin = await withComponents(row.plugin as Plugin);
        const agent = row.agents[0] as AgentId;
        if (!opts.yes && !opts.dryRun) {
          out(`${plugin.id} → ${agent} (${row.scope}): ${row.version ?? '?'} → ${plugin.version ?? '?'}`);
          continue;
        }
        try {
          await updatePlugin(plugin, agent, row.scope, ctx(opts.dryRun), { config: config(), enabled: opts.audit, adapters });
          if (!opts.dryRun) out(`${plugin.id}: updated for ${agent} (${row.scope})`);
        } catch (e) {
          fail(`${plugin.id} → ${agent}: ${(e as Error).message}`);
        }
      }
      if (!opts.yes && !opts.dryRun && rows.length > 0) err('Nothing changed. Pass -y to apply.');
    });

  program
    .command('export')
    .description('installed plugins as a selection file, on stdout')
    .option('-a, --agent <ids...>', 'agents to read (default: detected)')
    .action(async (opts: { agent?: string[] }) => {
      out(JSON.stringify(exportBundle(await view(opts.agent)), null, 2));
    });

  withScope(program.command('import <file>'))
    .description('install the plugins of a selection file; without -y the plan is printed')
    .requiredOption('-a, --agent <ids...>', 'agents to install into')
    .option('-y, --yes', 'apply the plan')
    .option('--dry-run', 'print what would run or be written, change nothing')
    .option('--no-audit', 'let a high risk through for this run')
    .action(async (file: string, opts: ScopeFlags & { agent: string[]; yes?: boolean; dryRun?: boolean; audit: boolean }) => {
      const bundle = parseBundle((deps.readText ?? ((path: string) => readFileSync(path, 'utf8')))(file));
      const cat = await catalog();
      const scope = scopeOf(opts);
      const agents = parseAgents(opts.agent) ?? [];
      const c = ctx(opts.dryRun === true || !opts.yes);
      const known = new Map<AgentId, Map<string, string>>();
      for (const agent of distinctAgents(agents)) known.set(agent, await adapters[agent].known(scope, c));
      const enriched = { ...cat, plugins: await Promise.all(cat.plugins.map((p) => (bundle.plugins.includes(p.id) ? withComponents(p) : p))) };
      const result = planImport(bundle, enriched, { agents, scope, known: (agent) => known.get(agent) ?? new Map(), config: config(), enabled: opts.audit });
      for (const id of result.missing) fail(`${id}: not in the catalog`);
      for (const refused of result.refused) fail(`${refused.id}: ${refused.error}`);
      for (const { plugin, plans } of result.ready) {
        for (const plan of plans) {
          const agent = plan.agents[0] as AgentId;
          if (!opts.yes && !opts.dryRun) {
            out(`${plugin.id} → ${plan.agents.join(',')} (${scope}, ${plan.mechanism})`);
            continue;
          }
          try {
            await adapters[agent].install(plan, plugin, c);
          } catch (e) {
            fail(`${plugin.id} → ${agent}: ${(e as Error).message}`);
          }
        }
      }
      if (!opts.yes && !opts.dryRun) err('Nothing changed. Pass -y to apply.');
    });

  withScope(program.command('browse'))
    .description('the terminal tree: tick plugins, preview them, review before anything changes')
    .option('--no-audit', 'let a high-risk plugin ticked by itself through, for this run')
    .action(async (opts: ScopeFlags & { audit: boolean }) => {
      const { browse } = await import('./ui/run.js');
      await browse({ catalog: await catalog(), agents: detectAgents(machine), ctx: ctx(), operate, scope: scopeOf(opts), ...(opts.audit ? {} : { audit: false }) });
    });

  program
    .command('ui')
    .description('the local page on 127.0.0.1: same entries, same review before anything changes')
    .option('--port <n>', 'port to listen on (default: any free one)')
    .option('--demo', 'read-only: nothing can be installed')
    .action(async (opts: { port?: string; demo?: boolean }) => {
      const { startUi } = await import('./web/server.js');
      const port = opts.port === undefined ? undefined : Number(opts.port);
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new CliError('--port expects a port number');
      const server = await startUi({ catalog: await catalog(), agents: detectAgents(machine), ctx: ctx(), operate, ...(port === undefined ? {} : { port }), ...(opts.demo ? { demo: true } : {}) });
      out(`Open ${server.url} — Ctrl+C stops the server.`);
      await new Promise<void>((resolve) => process.once('SIGINT', () => void server.close().then(resolve)));
    });

  program
    .command('mcp')
    .description('speak MCP on stdio: search, show and install plugins; runs no plugin component')
    .action(async () => {
      await serveMcp({ loadCatalog: catalog, agents: detectAgents(machine), ctx: { ...ctx(), log: err }, operate });
    });

  program
    .command('completion')
    .description('print a completion script: bash, zsh, fish or powershell')
    .argument('<shell>', 'bash, zsh, fish, powershell')
    .action((shell: string) => {
      const script = completionScript(shell);
      if (!script) throw new CliError(`Unknown shell ${shell}: bash, zsh, fish or powershell`);
      out(script.trimEnd());
    });

  // Called by the completion scripts on Tab: one candidate per line, nothing else on stdout.
  program
    .command('__complete', { hidden: true })
    .argument('[words...]')
    .allowUnknownOption()
    .action(async (words: string[]) => {
      let ids: string[] = [];
      let themes: string[] = [];
      try {
        // Offline: Tab must answer at once, from the cached or bundled snapshot.
        const cat = deps.loadCatalog ? await deps.loadCatalog({ offline: true }) : await loadLatestCatalog({ offline: true });
        ids = cat.plugins.map((plugin) => plugin.id);
        themes = cat.themes.map((theme) => theme.id);
      } catch {
        ids = [];
      }
      const flags = (cmd: Command) => cmd.options.flatMap((o) => [o.short, o.long].filter((f): f is string => !!f));
      const candidates = complete(words.length ? words : [''], {
        commands: program.commands.filter((cmd) => !cmd.name().startsWith('_')).map((cmd) => ({ name: cmd.name(), options: flags(cmd) })),
        globalOptions: [...flags(program), '--help', '--version'],
        themes: () => themes,
        agents: [...AGENT_IDS],
        ids: (prefix) => ids.filter((id) => id.toLowerCase().startsWith(prefix.toLowerCase())).slice(0, 50),
      });
      if (candidates.length > 0) out(candidates.join('\n'));
    });

  program.hook('postAction', () => {
    if (failed) process.exitCode = 1;
  });
  return program;
}

export async function run(argv: string[], deps: CliDeps = {}): Promise<void> {
  const program = createProgram(deps);
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    (deps.stderr ?? ((text: string) => process.stderr.write(`${text}\n`)))(e.message);
    process.exitCode = 1;
  }
}

// Runs only as the entry point, not when a test imports this module.
const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  await run(process.argv);
}
