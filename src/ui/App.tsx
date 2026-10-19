import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { AGENTS } from '../agents.js';
import { auditPlugin, type AuditResult } from '../audit.js';
import { describe, type Proposal } from '../operate.js';
import { componentLines, type Preview } from '../preview.js';
import { searchPlugins } from '../search.js';
import { THEMES } from '../taxonomy.js';
import { AGENT_IDS, type AgentId, type Catalog, type Plugin, type Scope } from '../types.js';

export interface AppProps {
  catalog: Catalog;
  /** Detected agents, ticked by default in the review. */
  agents: AgentId[];
  scope?: Scope;
  /** `highRisk` plugins were ticked one by one despite a failed audit. */
  propose: (plugins: Plugin[], agents: AgentId[], scope: Scope, highRisk: Set<string>) => Promise<Proposal[]>;
  apply: (proposals: Proposal[]) => Promise<Proposal[]>;
  loadPreview: (plugin: Plugin) => Promise<Preview>;
  /** Called once when the app leaves: the applied results, or null when nothing was confirmed. */
  onDone?: (results: Proposal[] | null) => void;
}

type Row = { kind: 'theme'; id: string; label: string; plugins: Plugin[] } | { kind: 'plugin'; plugin: Plugin; theme: string };
type Screen = 'tree' | 'preview' | 'review' | 'applying' | 'done';

const toggle = <T,>(set: ReadonlySet<T>, value: T, on = !set.has(value)) => {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
};

export function App({ catalog, agents: detected, scope: initialScope = 'project', propose, apply, loadPreview, onDone }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const height = Math.max(5, (stdout.rows || 24) - 8);
  const [screen, setScreen] = useState<Screen>('tree');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [agentFilter, setAgentFilter] = useState<AgentId>();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<{ plugin: Plugin; data?: Preview; error?: string }>();
  const [agents, setAgents] = useState<ReadonlySet<AgentId>>(new Set(detected));
  const [scope, setScope] = useState<Scope>(initialScope);
  const [reviewCursor, setReviewCursor] = useState(0);
  const [proposals, setProposals] = useState<Proposal[]>();
  const [results, setResults] = useState<Proposal[]>();

  const audits = useMemo(() => new Map(catalog.plugins.map((p) => [p.id, auditPlugin(p)])), [catalog]);
  const highRisk = (id: string) => audits.get(id)?.status === 'fail';
  const themes = catalog.themes.length > 0 ? catalog.themes : THEMES;

  const rows = useMemo(() => {
    const found = searchPlugins(catalog.plugins, { query, ...(agentFilter ? { agent: agentFilter } : {}) });
    const out: Row[] = [];
    for (const theme of themes) {
      const plugins = found.filter((p) => (p.themes.length > 0 ? p.themes.includes(theme.id) : theme.id === 'other'));
      if (plugins.length === 0) continue;
      out.push({ kind: 'theme', id: theme.id, label: theme.label, plugins });
      // A search unfolds every theme it matches, so results are never hidden.
      if (open.has(theme.id) || query) out.push(...plugins.map((plugin) => ({ kind: 'plugin' as const, plugin, theme: theme.id })));
    }
    return out;
  }, [catalog, themes, query, agentFilter, open]);
  const at = Math.min(cursor, Math.max(0, rows.length - 1));
  const row = rows[at];
  const chosen = catalog.plugins.filter((p) => checked.has(p.id));

  useEffect(() => {
    if (screen !== 'review') return;
    let live = true;
    setProposals(undefined);
    const ids = new Set(chosen.filter((p) => highRisk(p.id)).map((p) => p.id));
    propose(chosen, AGENT_IDS.filter((a) => agents.has(a)), scope, ids).then(
      (p) => live && setProposals(p),
      (e: unknown) => live && setProposals(chosen.map((plugin) => ({ plugin, agent: detected[0] ?? 'claude-code', scope, error: String(e) }))),
    );
    return () => {
      live = false;
    };
  }, [screen, agents, scope]);

  const leave = (r: Proposal[] | null) => {
    onDone?.(r);
    exit();
  };

  const openPreview = (plugin: Plugin) => {
    setPreview({ plugin });
    setScreen('preview');
    loadPreview(plugin).then(
      (data) => setPreview((p) => (p?.plugin === plugin ? { plugin, data } : p)),
      (e: unknown) => setPreview((p) => (p?.plugin === plugin ? { plugin, error: e instanceof Error ? e.message : String(e) } : p)),
    );
  };

  useInput((input, key) => {
    if (screen === 'done') return leave(results ?? null);
    if (screen === 'applying') return;
    if (screen === 'preview') {
      if (key.escape || key.return || input === 'p' || input === 'q') setScreen('tree');
      return;
    }
    if (screen === 'review') {
      // Rows: every agent, then the scope.
      if (key.escape) setScreen('tree');
      else if (key.upArrow) setReviewCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setReviewCursor((c) => Math.min(AGENT_IDS.length, c + 1));
      else if (input === ' ' && reviewCursor < AGENT_IDS.length) setAgents((s) => toggle(s, AGENT_IDS[reviewCursor] as AgentId));
      else if (input === 's' || (input === ' ' && reviewCursor === AGENT_IDS.length)) setScope((s) => (s === 'project' ? 'user' : 'project'));
      else if (key.return && proposals) {
        const retained = proposals.filter((p) => p.plan);
        if (retained.length === 0) return;
        setScreen('applying');
        apply(retained).then(
          (r) => (setResults(r), setScreen('done')),
          (e: unknown) => (setResults(retained.map((p) => ({ ...p, error: String(e) }))), setScreen('done')),
        );
      }
      return;
    }
    if (searching) {
      if (key.return || key.escape) setSearching(false);
      if (key.escape) setQuery('');
      else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
      else if (input && !key.ctrl && !key.meta && !key.return) setQuery((q) => q + input);
      setCursor(0);
      return;
    }
    if (key.upArrow) setCursor(Math.max(0, at - 1));
    else if (key.downArrow) setCursor(Math.min(rows.length - 1, at + 1));
    else if (key.rightArrow && row?.kind === 'theme') setOpen((s) => toggle(s, row.id, true));
    else if (key.leftArrow && row) {
      const id = row.kind === 'theme' ? row.id : row.theme;
      setOpen((s) => toggle(s, id, false));
      setCursor(Math.max(0, rows.findIndex((r) => r.kind === 'theme' && r.id === id)));
    } else if (input === ' ' && row?.kind === 'plugin') setChecked((s) => toggle(s, row.plugin.id));
    else if (input === ' ' && row?.kind === 'theme') {
      // A theme never ticks a high-risk plugin: those are ticked one by one.
      const safe = row.plugins.filter((p) => !highRisk(p.id));
      const on = !safe.every((p) => checked.has(p.id));
      setChecked((s) => safe.reduce((acc, p) => toggle(acc, p.id, on), s));
    } else if (input === '/') setSearching(true);
    else if (input === 'a') {
      const i = agentFilter ? AGENT_IDS.indexOf(agentFilter) + 1 : 0;
      setAgentFilter(AGENT_IDS[i]);
      setCursor(0);
    } else if (input === 'p' && row?.kind === 'plugin') openPreview(row.plugin);
    else if (key.return && checked.size > 0) {
      setReviewCursor(0);
      setScreen('review');
    } else if (input === 'q' || key.escape) leave(null);
  });

  if (screen === 'preview' && preview) return <PreviewScreen {...preview} audit={audits.get(preview.plugin.id)} height={height} />;
  if (screen === 'review' || screen === 'applying')
    return <Review proposals={proposals} agents={agents} scope={scope} cursor={reviewCursor} highRisk={highRisk} applying={screen === 'applying'} />;
  if (screen === 'done') return <Done results={results ?? []} />;

  const start = Math.max(0, Math.min(at - Math.floor(height / 2), rows.length - height));
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>plugins-atlas</Text>
        <Text dimColor>
          {'  '}
          {checked.size} ticked · agent: {agentFilter ? AGENTS[agentFilter].label : 'all'}
        </Text>
      </Text>
      <Text>
        Search: {query}
        {searching ? <Text inverse> </Text> : <Text dimColor>{query ? '' : '(press /)'}</Text>}
      </Text>
      {rows.length === 0 && <Text dimColor>No plugin matches.</Text>}
      {rows.slice(start, start + height).map((r, i) => {
        const here = start + i === at;
        if (r.kind === 'theme') {
          const n = r.plugins.filter((p) => checked.has(p.id)).length;
          return (
            <Text key={`t:${r.id}`} inverse={here} bold>
              {open.has(r.id) || query ? '▾' : '▸'} {r.label} <Text dimColor>({n}/{r.plugins.length})</Text>
            </Text>
          );
        }
        const high = highRisk(r.plugin.id);
        return (
          <Text key={`p:${r.theme}:${r.plugin.id}`} inverse={here}>
            {'   '}[{checked.has(r.plugin.id) ? 'x' : ' '}] {r.plugin.name}
            {r.plugin.official ? <Text color="cyan"> official</Text> : null}
            {high ? <Text color="red"> high risk</Text> : null}
            <Text dimColor> {r.plugin.description ?? ''}</Text>
          </Text>
        );
      })}
      <Text dimColor>↑↓ move · →← fold · space tick · / search · a agent · p preview · enter review · q quit</Text>
    </Box>
  );
}

function RiskLines({ audit }: { audit: AuditResult | undefined }) {
  if (!audit) return null;
  if (audit.status === 'unaudited') return <Text color="yellow">Not audited: {audit.reason}</Text>;
  if (audit.risks.length === 0) return <Text color="green">No risk found.</Text>;
  return (
    <>
      {audit.risks.map((r, i) => (
        <Text key={i} color={r.level === 'high' ? 'red' : r.level === 'medium' ? 'yellow' : undefined}>
          {'  '}
          {r.level} {r.code}: {r.detail}
        </Text>
      ))}
    </>
  );
}

function PreviewScreen({ plugin, data, error, audit, height }: { plugin: Plugin; data?: Preview; error?: string; audit: AuditResult | undefined; height: number }) {
  const components = data?.components ?? plugin.components;
  // The preview's components are fresher than the catalog's, so the risks are read from them when they came.
  const risks = data ? auditPlugin({ ...plugin, components: data.components }) : audit;
  const readme = (data?.readme ?? '').split(/\r?\n/).slice(0, Math.max(3, height - 10));
  return (
    <Box flexDirection="column">
      <Text bold>{plugin.id}</Text>
      {plugin.description && <Text>{plugin.description}</Text>}
      <Text dimColor>Agents: {plugin.agents.map((a) => AGENTS[a].label).join(', ') || 'none known'}</Text>
      <Text bold>Risks</Text>
      <RiskLines audit={risks} />
      <Text bold>Components</Text>
      {components ? componentLines(components).map((line, i) => <Text key={i}>{'  '}{line}</Text>) : <Text dimColor>  unknown</Text>}
      <Text bold>README</Text>
      {error ? <Text color="red">{error}</Text> : !data ? <Text dimColor>Loading…</Text> : data.readme ? readme.map((line, i) => <Text key={i}>{line}</Text>) : <Text dimColor>No README.</Text>}
      <Text dimColor>esc back</Text>
    </Box>
  );
}

function Review({ proposals, agents, scope, cursor, highRisk, applying }: { proposals?: Proposal[]; agents: ReadonlySet<AgentId>; scope: Scope; cursor: number; highRisk: (id: string) => boolean; applying: boolean }) {
  const retained = proposals?.filter((p) => p.plan).length ?? 0;
  return (
    <Box flexDirection="column">
      <Text bold>Review: nothing is done until you confirm</Text>
      <Text bold>Agents</Text>
      {AGENT_IDS.map((a, i) => (
        <Text key={a} inverse={i === cursor}>
          {'  '}[{agents.has(a) ? 'x' : ' '}] {AGENTS[a].label}
        </Text>
      ))}
      <Text inverse={cursor === AGENT_IDS.length}>Scope: {scope}</Text>
      <Text bold>Actions</Text>
      {!proposals ? (
        <Text dimColor>Planning…</Text>
      ) : (
        proposals.map((p, i) => {
          const risks = (p.plan?.audit ?? auditPlugin(p.plugin)).risks;
          return (
            <Box key={i} flexDirection="column">
              <Text color={p.plan ? undefined : 'red'}>
                {'  '}
                {p.plan ? '+' : '✗'} {p.plugin.id} → {AGENTS[p.agent].label} ({p.scope}): {p.plan ? describe(p.plan) : p.error}
              </Text>
              {highRisk(p.plugin.id) && <Text color="red">{'    '}HIGH RISK, ticked explicitly: {risks.filter((r) => r.level === 'high').map((r) => r.detail).join('; ')}</Text>}
              {risks.some((r) => r.level === 'medium') && <Text color="yellow">{'    '}{risks.filter((r) => r.level === 'medium').map((r) => r.detail).join('; ')}</Text>}
            </Box>
          );
        })
      )}
      <Text dimColor>
        {applying ? 'Applying…' : `↑↓ move · space tick agent · s scope · enter confirm ${retained} action(s) · esc back without doing anything`}
      </Text>
    </Box>
  );
}

function Done({ results }: { results: Proposal[] }) {
  return (
    <Box flexDirection="column">
      <Text bold>Result</Text>
      {results.map((p, i) => (
        <Text key={i} color={p.error ? 'red' : 'green'}>
          {'  '}
          {p.error ? `✗ ${p.plugin.id} → ${AGENTS[p.agent].label}: ${p.error}` : `✓ ${p.plugin.id} → ${AGENTS[p.agent].label} (${p.scope})`}
        </Text>
      ))}
      <Text dimColor>Press any key to leave.</Text>
    </Box>
  );
}
