import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { AGENTS } from '../agents.js';
import { auditPlugin, failsAudit, type AuditResult } from '../audit.js';
import type { Preview } from '../preview.js';
import type { SortOrder } from '../search.js';
import { AGENT_IDS, SCOPES, type AgentId, type Plugin, type Scope, type Theme } from '../types.js';
import { ACCENT, Banner, Header, Hints, Panel, useTerminalSize, type Hint, type StepId } from './Layout.js';
import { ListSelect } from './ListSelect.js';
import { m } from './messages.js';
import { isMouseInput } from './mouse.js';
import { TERMINAL_PALETTE as PALETTE } from './palette.js';
import { agentLabels, INSTALLED_THEME, scopesLabel, TreeSelect, type InstalledEntry, type TreeMemory } from './TreeSelect.js';
import { padEnd } from './width.js';

export interface InstallChoice {
  agents: AgentId[];
  scope: Scope;
}

export interface WizardResult {
  /** Plugins to install. */
  ids: string[];
  /** Installed plugins to uninstall, from every scope they are in. */
  remove: { id: string; scopes: Scope[] }[];
  /** Installed plugins to update to the catalog version. */
  update: string[];
  options: InstallChoice;
}

export interface InstalledState {
  installed: Map<string, InstalledEntry>;
  /** Installed plugin ids whose version is older than the catalog's. */
  updates: Set<string>;
}

export interface AppProps {
  themes: Theme[];
  plugins: Plugin[];
  /** Every catalog plugin, to show installed ones that the filters hide. */
  allPlugins?: Plugin[];
  /** Options given on the command line: their prompts are skipped. */
  preset: Partial<InstallChoice>;
  /** Pre-filled values for the prompts (user scope, detected agents). */
  defaults: InstallChoice;
  detectedAgents?: AgentId[];
  /** Plugins already chosen (the `install` command): the tree is skipped. */
  initialIds?: string[];
  sort?: SortOrder;
  search?: string;
  official?: boolean;
  /** Reads the agents in these scopes, to pre-tick what is installed. */
  loadInstalled?: (scopes: Scope[]) => Promise<InstalledState>;
  /** Summary of the previous run, shown above the tree. */
  notice?: string;
  treeMemory?: TreeMemory;
  /** Run the security audit on the review screen (on unless turned off). */
  audit?: boolean;
  loadPreview?: (plugin: Plugin) => Promise<Preview>;
  onDone: (result: WizardResult | null) => void;
}

type Step = 'loading' | 'tree' | 'scope' | 'agents' | 'confirm';
const ORDER: Step[] = ['loading', 'tree', 'scope', 'agents', 'confirm'];
const STEP_OF: Record<Step, StepId> = { loading: 'select', tree: 'select', scope: 'scope', agents: 'agents', confirm: 'confirm' };
/** The big logo needs about this many rows on top of the step content. */
const BANNER_MIN_ROWS = 26;

/** Agents that can install in `scope`. */
export const agentsIn = (scope: Scope): AgentId[] => AGENT_IDS.filter((id) => AGENTS[id].install[scope] !== undefined);

interface Answers {
  hasTree: boolean;
  installs: number;
}

/** First step after `from` (or the very first one) that still needs an answer. */
function nextStep(from: Step | undefined, preset: AppProps['preset'], a: Answers): Step {
  for (const s of ORDER.slice(from ? ORDER.indexOf(from) + 1 : 0)) {
    if ((s === 'loading' || s === 'tree') && a.hasTree) return s;
    // Scope and agents only matter for plugins to install, not for removals or updates.
    if (s === 'scope' && !preset.scope && a.installs > 0) return s;
    if (s === 'agents' && !preset.agents && a.installs > 0) return s;
  }
  return 'confirm';
}

export function App(props: AppProps) {
  const { themes, plugins, preset, defaults, detectedAgents = [], initialIds, loadInstalled, sort, search, official, notice, treeMemory, audit = true, loadPreview, onDone } = props;
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const hasTree = !initialIds;
  const [ids, setIds] = useState<string[]>(initialIds ?? []);
  const [removals, setRemovals] = useState<WizardResult['remove']>([]);
  const [updates, setUpdates] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentId[] | undefined>(preset.agents);
  const [scope, setScope] = useState<Scope | undefined>(preset.scope);
  const [state, setState] = useState<InstalledState>({ installed: new Map(), updates: new Set() });
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<Step>(() => nextStep(undefined, preset, { hasTree, installs: ids.length }));
  /** Steps shown so far, for going back; leaving the first one quits. */
  const [history, setHistory] = useState<Step[]>([]);
  /** Installed plugins are read in the scope given as a flag, else in both. */
  const readScopes: Scope[] = preset.scope ? [preset.scope] : [...SCOPES];

  const finish = (result: WizardResult | null) => {
    onDone(result);
    exit();
  };
  const next = (from: Step, installs = ids.length) => {
    if (from !== 'loading') setHistory((h) => [...h, from]);
    setStep(nextStep(from, preset, { hasTree, installs }));
  };
  const back = () => {
    const previous = history.at(-1);
    if (!previous) return finish(null);
    setHistory((h) => h.slice(0, -1));
    setStep(previous);
  };

  useEffect(() => {
    if (step !== 'loading') return;
    if (!loadInstalled) {
      setStep('tree');
      return;
    }
    let live = true;
    loadInstalled(readScopes)
      .then((data) => live && (setState(data), next('loading')))
      .catch((err: unknown) => {
        if (!live) return;
        setError(m.detectFailed(err instanceof Error ? err.message : String(err)));
        next('loading');
      });
    return () => {
      live = false;
    };
  }, [step]);

  const screen = (content: ReactNode) => (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      {step !== 'tree' && history.length === 0 && rows >= BANNER_MIN_ROWS && <Banner />}
      <Header step={STEP_OF[step]} />
      {content}
    </Box>
  );

  if (step === 'loading') return screen(<Text color={PALETTE.gold}>{m.loading(scopesLabel(readScopes))}</Text>);

  if (step === 'tree') {
    const installedIds = [...state.installed.keys()];
    const removed = new Set(removals.map((r) => r.id));
    const byId = new Map(plugins.map((p) => [p.id, p]));
    // Installed plugins get their own group first, whatever the filters.
    const treePlugins = state.installed.size
      ? plugins.map((p) => (state.installed.has(p.id) ? { ...p, themes: [INSTALLED_THEME.id, ...p.themes] } : p))
      : plugins;
    // Installed plugins hidden by the filters still show, so that they can be unticked.
    const all = new Map((props.allPlugins ?? []).map((p) => [p.id, p]));
    for (const id of installedIds) {
      const plugin = all.get(id) ?? state.installed.get(id)!.plugin;
      if (!byId.has(id) && plugin) treePlugins.push({ ...plugin, themes: [INSTALLED_THEME.id] });
    }
    return screen(
      <Box flexDirection="column">
        {error && <Text color={PALETTE.danger}>{error}</Text>}
        {notice && <Text>{notice}</Text>}
        <TreeSelect
          themes={state.installed.size ? [INSTALLED_THEME, ...themes] : themes}
          plugins={treePlugins}
          installed={state.installed}
          scopes={loadInstalled ? readScopes : undefined}
          initialSort={sort}
          initialSearch={search}
          initialOfficial={official}
          memory={treeMemory}
          updates={state.updates}
          loadPreview={loadPreview}
          initialSelected={[...ids, ...installedIds.filter((id) => !removed.has(id))]}
          onSubmit={(sel, update = []) => {
            const chosen = new Set(sel);
            const toInstall = sel.filter((id) => !state.installed.has(id));
            const toRemove = installedIds.filter((id) => !chosen.has(id));
            if (!toInstall.length && !toRemove.length && !update.length) return finish(null);
            setIds(toInstall);
            setUpdates(update);
            // An unticked plugin is uninstalled from every scope it was found in.
            setRemovals(toRemove.map((id) => ({ id, scopes: [...state.installed.get(id)!.scopes] })));
            next('tree', toInstall.length);
          }}
          onCancel={() => finish(null)}
        />
      </Box>,
    );
  }

  if (step === 'scope') {
    return screen(
      <ListSelect<Scope>
        key="scope"
        title={m.scope.title}
        initial={[scope ?? defaults.scope]}
        items={[
          { value: 'project', label: m.scope.project, hint: m.scope.projectHint(process.cwd()) },
          { value: 'user', label: m.scope.global, hint: m.scope.globalHint },
        ]}
        onSubmit={([value]) => {
          setScope(value);
          next('scope');
        }}
        onCancel={back}
      />,
    );
  }

  const chosenScope = scope ?? defaults.scope;
  const available = agentsIn(chosenScope);

  if (step === 'agents') {
    const detected = new Set(detectedAgents);
    const initial = (agents ?? defaults.agents).filter((id) => available.includes(id));
    return screen(
      <ListSelect<string>
        key="agents"
        title={m.agents.title}
        multiple
        initial={initial}
        items={[
          { value: '*', label: m.agents.all, hint: `${available.length}` },
          ...available.map((id) => ({ value: id, label: AGENTS[id].label, hint: id, badge: detected.has(id) ? m.agents.detected : undefined })),
        ]}
        onSubmit={(values) => {
          const chosen = values.includes('*') ? available : (values as AgentId[]);
          setAgents(chosen);
          next('agents');
        }}
        onCancel={back}
      />,
    );
  }

  const options: InstallChoice = { agents: (agents ?? defaults.agents).filter((id) => available.includes(id)), scope: chosenScope };
  const byId = new Map([...(props.allPlugins ?? []), ...plugins].map((p) => [p.id, p]));
  return screen(
    <Confirm
      ids={ids}
      remove={removals}
      update={updates}
      options={options}
      audit={audit}
      plugins={byId}
      onConfirm={(kept, keptUpdates) =>
        finish(kept.length || keptUpdates.length || removals.length ? { ids: kept, remove: removals, update: keptUpdates, options } : null)
      }
      onBack={back}
    />,
  );
}

interface ConfirmProps {
  ids: string[];
  remove: WizardResult['remove'];
  update: string[];
  options: InstallChoice;
  audit: boolean;
  plugins: Map<string, Plugin>;
  /** What to install and update, without the plugins left out after the audit. */
  onConfirm: (ids: string[], update: string[]) => void;
  onBack: () => void;
}

function Confirm({ ids, remove, update, options, audit, plugins, onConfirm, onBack }: ConfirmProps) {
  const audited = [...ids, ...update];
  const results: AuditResult[] = audit ? audited.flatMap((id) => (plugins.has(id) ? [auditPlugin(plugins.get(id)!)] : [])) : [];
  // Plugins that fail the audit are left out, unless the user ticks them here.
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const failing = results.filter(failsAudit);
  // Components unknown: read and audited when installed, so shown as they are.
  const unread = audited.filter((id) => plugins.has(id) && !plugins.get(id)!.components);
  const left = new Set(failing.map((r) => r.id).filter((id) => !keep.has(id)));
  const keptIds = ids.filter((id) => !left.has(id));
  const keptUpdates = update.filter((id) => !left.has(id));
  const confirm = () => onConfirm(keptIds, keptUpdates);
  const toggleKeep = (id: string) => {
    const next = new Set(keep);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKeep(next);
  };
  useInput((input, key) => {
    if (isMouseInput(input)) return;
    if (key.escape || input === 'n') onBack();
    else if (key.upArrow) setCursor(Math.max(0, cursor - 1));
    else if (key.downArrow) setCursor(Math.min(failing.length - 1, cursor + 1));
    else if (input === ' ' && failing[cursor]) toggleKeep(failing[cursor]!.id);
    else if (key.return || input === 'y') confirm();
  });
  const warned = results.filter((r) => !failsAudit(r) && r.risks.some((x) => x.level === 'medium'));
  const passed = results.filter((r) => r.status === 'pass' && !r.risks.some((x) => x.level !== 'info')).length;
  const riskLine = (r: AuditResult, level: 'high' | 'medium') =>
    r.risks
      .filter((x) => x.level === level)
      .slice(0, 2)
      .map((x) => (
        <Text key={x.code + x.detail} color={level === 'high' ? PALETTE.danger : PALETTE.gold} wrap="truncate-end">
          {`      ${m.tree.riskLevels[x.level]} · ${x.detail}`}
        </Text>
      ));
  const row = (label: string, value: string) => (
    <Text>
      <Text dimColor>{padEnd(label, 10)}</Text>
      {value}
    </Text>
  );
  /** Where a plugin goes: the chosen agents that read its manifests. */
  const target = (id: string) => {
    const plugin = plugins.get(id);
    if (!plugin?.components) return <Text dimColor>{`  ${m.confirm.auditUnread}`}</Text>;
    const into = options.agents.filter((a) => plugin.agents.includes(a));
    return into.length ? <Text dimColor>{`  → ${agentLabels(into)}`}</Text> : <Text color={PALETTE.danger}>{`  ${m.confirm.noAgent}`}</Text>;
  };
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{m.confirm.title}</Text>
      {remove.length > 0 && (
        <Panel color={PALETTE.danger} title={`− ${m.confirm.remove(remove.length)}`}>
          <Text wrap="wrap">{remove.map((r) => `${r.id} (${scopesLabel(r.scopes)})`).join('  ·  ')}</Text>
        </Panel>
      )}
      {!audit && audited.length > 0 && <Text dimColor>{`🛡 ${m.confirm.auditOff}`}</Text>}
      {failing.length > 0 && (
        <Panel color={PALETTE.danger} title={`🛡 ${m.confirm.auditFailed(failing.length)}`}>
          {failing.map((r, i) => (
            <Box key={r.id} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={ACCENT}>{i === cursor ? '❯ ' : '  '}</Text>
                <Text color={keep.has(r.id) ? PALETTE.danger : PALETTE.muted}>{keep.has(r.id) ? '◉ ' : '○ '}</Text>
                <Text bold={i === cursor}>{r.id}</Text>
                <Text dimColor>{`  ${keep.has(r.id) ? m.confirm.auditKept : m.confirm.auditLeftOut}`}</Text>
              </Text>
              {riskLine(r, 'high')}
            </Box>
          ))}
          <Text dimColor>{m.confirm.auditHint}</Text>
        </Panel>
      )}
      {warned.length > 0 && (
        <Box flexDirection="column">
          {warned.map((r) => (
            <Box key={r.id} flexDirection="column">
              <Text color={PALETTE.gold} wrap="truncate-end">{`⚠ ${r.id}`}</Text>
              {riskLine(r, 'medium')}
            </Box>
          ))}
        </Box>
      )}
      {audit && unread.length > 0 && (
        <Box flexDirection="column">
          {unread.map((id) => (
            <Text key={id} dimColor wrap="truncate-end">{`∅ ${id}  ${m.confirm.auditUnread}`}</Text>
          ))}
        </Box>
      )}
      {audit && passed > 0 && <Text color={PALETTE.success}>{`🛡 ✓ ${m.confirm.auditPassed(passed)}`}</Text>}
      {keptIds.length > 0 && (
        <Panel color={PALETTE.success} title={`+ ${m.confirm.install(keptIds.length)}`}>
          {keptIds.map((id) => (
            <Text key={id} wrap="truncate-end">
              {id}
              {target(id)}
            </Text>
          ))}
        </Panel>
      )}
      {keptUpdates.length > 0 && (
        <Panel color={PALETTE.gold} title={`↑ ${m.confirm.update(keptUpdates.length)}`}>
          <Text wrap="wrap">{keptUpdates.join('  ·  ')}</Text>
        </Panel>
      )}
      {keptIds.length > 0 && (
        <Box flexDirection="column">
          {row(m.confirm.scope, options.scope === 'user' ? m.scope.global : m.scope.project)}
          {row(m.confirm.agents, agentLabels(options.agents))}
        </Box>
      )}
      <Hints
        items={[
          ...(failing.length ? [['↑↓', m.keys.move] as Hint, [m.keyNames.space, m.keys.keep] as Hint] : []),
          [m.keyNames.enter, m.keys.apply, confirm],
          [m.keyNames.esc, m.keys.back, onBack],
        ]}
      />
    </Box>
  );
}
