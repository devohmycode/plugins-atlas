import { Box, Text, useInput } from 'ink';
import { useMemo, useRef, useState } from 'react';
import { AGENTS } from '../agents.js';
import { auditPlugin, type AuditStatus } from '../audit.js';
import { openBrowser } from '../browser.js';
import { componentLines, type Preview } from '../preview.js';
import type { RiskLevel } from '../risk.js';
import { searchPlugins, SORT_ORDERS, type SortOrder } from '../search.js';
import type { AgentId, Plugin, Scope, Theme } from '../types.js';
import { ACCENT, BOX, Hints, Panel, useTerminalSize, type Hint } from './Layout.js';
import { formatNumber, m } from './messages.js';
import { isMouseInput, useListMouse } from './mouse.js';
import { TERMINAL_PALETTE as PALETTE } from './palette.js';
import { fit, padStart, width, wrapLines } from './width.js';

type Row = { kind: 'theme'; theme: Theme; plugins: Plugin[]; expanded: boolean } | { kind: 'plugin'; plugin: Plugin; themeId: string };

/** Where a plugin is installed, as the agents report it. */
export interface InstalledEntry {
  scopes: Scope[];
  agents: AgentId[];
  /** The catalog entry, to show it when the filters hide it. */
  plugin?: Plugin;
}

/** What the tree leaves behind when it submits, so that the next one opens where this one was. */
export interface TreeMemory {
  expanded?: Set<string>;
  /** Key of the focused row. */
  focus?: string;
}

/** Theme of the plugins found in the agents, shown first. */
export const INSTALLED_THEME: Theme = { id: 'installed', label: 'Already installed' };

function rowKey(r: Row): string {
  return r.kind === 'theme' ? `t:${r.theme.id}` : `s:${r.themeId}:${r.plugin.id}`;
}

export interface TreeSelectProps {
  themes: Theme[];
  plugins: Plugin[];
  initialSelected?: string[];
  /** Installed plugins: ticked at start, unticking one means uninstalling it (from every scope). */
  installed?: Map<string, InstalledEntry>;
  /** Scopes read for installed plugins, shown in the status line. */
  scopes?: Scope[];
  initialSort?: SortOrder;
  initialSearch?: string;
  initialOfficial?: boolean;
  /** Installed plugin ids with a newer catalog version, marked for update with `u`. */
  updates?: Set<string>;
  onSubmit: (ids: string[], update?: string[]) => void;
  onCancel: () => void;
  memory?: TreeMemory;
  /** README and components shown by `p`. */
  loadPreview?: (plugin: Plugin) => Promise<Preview>;
}

/** Lines used around the list: header, status, search, details panel, hints (may wrap). */
const CHROME_LINES = 17;
const WHEEL_STEP = 3;
/** Clicks up to this screen column on a theme row hit its checkbox (padding, pointer, arrow, box). */
const THEME_BOX_COLUMN = 7;
const OFFICIAL_MARK = '◆';
const RISK_MARK = '⚠';
const UNKNOWN_MARK = '∅';
const UPDATE_MARK = '↑';
const EMPTY_INSTALLED = new Map<string, InstalledEntry>();
const NO_UPDATES = new Set<string>();

/** Groups in theme order; a plugin shows under each of its themes, `other` when it has none. */
function groupByTheme(themes: Theme[], plugins: Plugin[]): { theme: Theme; plugins: Plugin[] }[] {
  const byTheme = new Map<string, Plugin[]>();
  for (const plugin of plugins) {
    for (const id of plugin.themes.length ? plugin.themes : ['other']) {
      const list = byTheme.get(id);
      if (list) list.push(plugin);
      else byTheme.set(id, [plugin]);
    }
  }
  return themes.filter((theme) => byTheme.has(theme.id)).map((theme) => ({ theme, plugins: byTheme.get(theme.id)! }));
}

/** Theme headers, each followed by its plugins when open (always open during a search). */
function buildRows(groups: { theme: Theme; plugins: Plugin[] }[], expanded: Set<string>, filter: string): Row[] {
  const out: Row[] = [];
  for (const g of groups) {
    const open = filter !== '' || expanded.has(g.theme.id);
    out.push({ kind: 'theme', theme: g.theme, plugins: g.plugins, expanded: open });
    if (open) for (const plugin of g.plugins) out.push({ kind: 'plugin', plugin, themeId: g.theme.id });
  }
  return out;
}

/** Audited only when a row is drawn, once per plugin: the catalog holds too many to audit up front. */
const auditCache = new WeakMap<Plugin, AuditStatus>();
function auditOf(plugin: Plugin): AuditStatus {
  let status = auditCache.get(plugin);
  if (status === undefined) auditCache.set(plugin, (status = auditPlugin(plugin).status));
  return status;
}

/** "project", "global" or "project + global". */
export function scopesLabel(scopes: Scope[]): string {
  return scopes.map((sc) => m.tree.where[sc]).join(' + ');
}

export const agentLabels = (agents: readonly AgentId[]) => agents.map((a) => AGENTS[a].label).join(', ');

/** The repository page, else the marketplace's on GitHub. */
function repositoryUrl(plugin: Plugin): string | undefined {
  const url = plugin.repository?.url ?? '';
  if (/^https?:\/\//.test(url)) return url;
  const source = plugin.marketplace.source;
  return source.kind === 'github' ? `https://github.com/${source.repo}` : undefined;
}

export function TreeSelect({
  themes,
  plugins,
  initialSelected = [],
  installed = EMPTY_INSTALLED,
  scopes,
  initialSort,
  initialSearch = '',
  initialOfficial = false,
  onSubmit,
  onCancel,
  memory,
  updates = NO_UPDATES,
  loadPreview,
}: TreeSelectProps) {
  const { columns, rows: termRows } = useTerminalSize();
  const [expanded, setExpandedState] = useState<Set<string>>(() => new Set(memory?.expanded));
  const [selected, setSelectedState] = useState<Set<string>>(new Set(initialSelected));
  const [toUpdate, setToUpdateState] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ plugin: Plugin; data?: Preview; error?: string; top: number } | null>(null);
  const previews = useRef(new Map<string, Preview>());
  const [cursor, setCursorState] = useState(0);
  const [filter, setFilterState] = useState(initialSearch);
  const [editingFilter, setEditingFilterState] = useState(false);
  const [sort, setSort] = useState<SortOrder>(initialSort ?? 'official');
  const [officialOnly, setOfficialOnly] = useState(initialOfficial);
  // Keys can arrive faster than renders (held arrows, pasted input): handlers read and write through a ref.
  const live = useRef({ expanded, selected, toUpdate, cursor, filter, editingFilter, sort, officialOnly });
  const setExpanded = (next: Set<string>) => {
    live.current.expanded = next;
    setExpandedState(next);
  };
  const setSelected = (next: Set<string>) => {
    live.current.selected = next;
    setSelectedState(next);
  };
  const setToUpdate = (next: Set<string>) => {
    live.current.toUpdate = next;
    setToUpdateState(next);
  };
  const setCursor = (next: number) => {
    live.current.cursor = next;
    setCursorState(next);
  };
  const setFilter = (next: string) => {
    live.current.filter = next;
    setFilterState(next);
  };
  const setEditingFilter = (next: boolean) => {
    live.current.editingFilter = next;
    setEditingFilterState(next);
  };

  // Render and input handlers share the view: a sort or filter key changes what the next key sees.
  const viewCache = useRef<{ key: string; groups: ReturnType<typeof groupByTheme>; visible: Plugin[] } | undefined>(undefined);
  const getView = (sort: SortOrder, officialOnly: boolean, filter: string) => {
    const key = `${sort}\u0000${officialOnly}\u0000${filter}`;
    if (viewCache.current?.key === key) return viewCache.current;
    const visible = searchPlugins(plugins, { query: filter, official: officialOnly, sort });
    const view = { key, visible, groups: groupByTheme(themes, visible) };
    viewCache.current = view;
    return view;
  };
  const { visible, groups } = getView(sort, officialOnly, filter);

  const rowCache = useRef<{ groups: ReturnType<typeof groupByTheme>; expanded: Set<string>; filter: string; rows: Row[] } | undefined>(undefined);
  const getRows = (open: Set<string>, groups: ReturnType<typeof groupByTheme>, filter: string) => {
    const cached = rowCache.current;
    if (cached?.groups === groups && cached.expanded === open && cached.filter === filter) return cached.rows;
    const rows = buildRows(groups, open, filter);
    rowCache.current = { groups, expanded: open, filter, rows };
    return rows;
  };
  const rows = getRows(expanded, groups, filter);
  // Back from a run: focus the row that was focused, wherever the list now puts it.
  const restored = useRef(false);
  if (!restored.current) {
    restored.current = true;
    const index = memory?.focus ? rows.findIndex((r) => rowKey(r) === memory.focus) : -1;
    if (index > 0) {
      live.current.cursor = index;
      setCursorState(index);
    }
  }

  const { toInstall, toRemove, checkedByTheme } = useMemo(() => {
    let toInstall = 0;
    let toRemove = 0;
    for (const id of selected) if (!installed.has(id)) toInstall++;
    for (const id of installed.keys()) if (!selected.has(id)) toRemove++;
    const checkedByTheme = new Map(groups.map((g) => [g.theme.id, g.plugins.reduce((n, p) => n + Number(selected.has(p.id)), 0)]));
    return { toInstall, toRemove, checkedByTheme };
  }, [selected, installed, groups]);

  const height = Math.max(5, termRows - CHROME_LINES);
  const current = Math.min(cursor, Math.max(0, rows.length - 1));
  const top = Math.max(0, Math.min(current - Math.floor(height / 2), rows.length - height));
  const row = rows[current];

  // Columns of plugin rows: cursor+indent+marks (8), name, id, status, risk.
  const riskW = 2;
  const statusW = Math.max(width(scopesLabel(['project', 'user'])), width(m.tree.toRemove), width(m.tree.updateAvailable)) + 3;
  const nameW = Math.max(18, Math.min(40, Math.floor(columns * 0.3)));
  const idW = Math.max(0, columns - 2 - 8 - nameW - 2 - statusW - 2 - riskW - 1);

  const liveRows = () => getRows(live.current.expanded, getView(live.current.sort, live.current.officialOnly, live.current.filter).groups, live.current.filter);
  const liveCurrent = (list: Row[]) => Math.min(live.current.cursor, Math.max(0, list.length - 1));
  const focusedRow = () => {
    const list = liveRows();
    return list[liveCurrent(list)];
  };
  const move = (delta: number) => {
    const list = liveRows();
    setCursor(Math.max(0, Math.min(list.length - 1, liveCurrent(list) + delta)));
  };
  const setOpen = (themeId: string, open: boolean) => {
    if (live.current.expanded.has(themeId) === open) return;
    const next = new Set(live.current.expanded);
    if (open) next.add(themeId);
    else next.delete(themeId);
    setExpanded(next);
  };
  /** Marks the outdated ones among `ids` for update, or unmarks them all when they all are. */
  const toggleUpdate = (ids: string[]) => {
    const outdated = ids.filter((id) => updates.has(id));
    if (!outdated.length) return;
    const next = new Set(live.current.toUpdate);
    const allOn = outdated.every((id) => next.has(id));
    for (const id of outdated) {
      if (allOn) next.delete(id);
      else next.add(id);
    }
    setToUpdate(next);
  };
  const toggle = (ids: string[]) => {
    if (!ids.length) return;
    const next = new Set(live.current.selected);
    const allOn = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allOn) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  };
  const idsOf = (list: Plugin[]) => list.map((p) => p.id);

  // An update only counts for a plugin that stays installed.
  const updating = (sel: Set<string>) => [...live.current.toUpdate].filter((id) => sel.has(id));
  const changes = (sel: Set<string>) =>
    [...sel].some((id) => !installed.has(id)) || [...installed.keys()].some((id) => !sel.has(id)) || updating(sel).length > 0;
  const toUpdateCount = [...toUpdate].filter((id) => selected.has(id)).length;
  const canSubmit = toInstall > 0 || toRemove > 0 || toUpdateCount > 0;
  const submit = () => {
    if (memory) {
      const focused = focusedRow();
      memory.expanded = live.current.expanded;
      memory.focus = focused && rowKey(focused);
    }
    const update = updating(live.current.selected);
    if (update.length) onSubmit([...live.current.selected], update);
    else onSubmit([...live.current.selected]);
  };
  const startSearch = () => setEditingFilter(true);
  const endSearch = () => setEditingFilter(false);
  const clearSearch = () => {
    setFilter('');
    setEditingFilter(false);
    setCursor(0);
  };
  const cycleSort = () => {
    const next = SORT_ORDERS[(SORT_ORDERS.indexOf(live.current.sort) + 1) % SORT_ORDERS.length]!;
    live.current.sort = next;
    setSort(next);
    setCursor(0);
  };
  const toggleOfficial = () => {
    const next = !live.current.officialOnly;
    live.current.officialOnly = next;
    setOfficialOnly(next);
    setCursor(0);
  };
  const toggleAll = () =>
    setExpanded(live.current.expanded.size ? new Set() : new Set(getView(live.current.sort, live.current.officialOnly, live.current.filter).groups.map((g) => g.theme.id)));
  const repoOf = (r: Row | undefined) => (r?.kind === 'plugin' ? repositoryUrl(r.plugin) : undefined);
  const openRepository = () => {
    const url = repoOf(focusedRow());
    if (url) openBrowser(url);
  };
  const openPreview = () => {
    const focused = focusedRow();
    if (focused?.kind !== 'plugin' || !loadPreview) return;
    const plugin = focused.plugin;
    const cached = previews.current.get(plugin.id);
    setPreview({ plugin, ...(cached ? { data: cached } : {}), top: 0 });
    if (cached) return;
    loadPreview(plugin).then(
      (data) => {
        previews.current.set(plugin.id, data);
        setPreview((p) => (p?.plugin === plugin ? { ...p, data } : p));
      },
      (err: unknown) => {
        const error = m.tree.previewFailed(err instanceof Error ? err.message : String(err));
        setPreview((p) => (p?.plugin === plugin ? { ...p, error } : p));
      },
    );
  };
  // The preview's components are fresher than the catalog's: its risks are read from them once they came.
  const audit = useMemo(
    () => (preview ? auditPlugin(preview.data ? { ...preview.plugin, components: preview.data.components } : preview.plugin) : undefined),
    [preview?.plugin, preview?.data],
  );
  const risks = audit?.risks ?? [];
  const riskLines = 1 + Math.min(3, risks.length);
  const previewHeight = Math.max(5, termRows - 9 - riskLines);
  const previewText = preview?.data ? [...componentLines(preview.data.components), '', preview.data.readme ?? m.tree.noReadme].join('\n') : undefined;
  const previewLines = previewText !== undefined ? wrapLines(previewText, Math.max(20, columns - 6)) : [];
  const scrollPreview = (delta: number) =>
    setPreview((p) => (p ? { ...p, top: Math.max(0, Math.min(p.top + delta, previewLines.length - previewHeight)) } : p));

  // Wheel moves the cursor; a click ticks a plugin, or opens a theme (ticks it on its checkbox).
  const { ref: listRef, hover } = useListMouse(Math.min(height, rows.length - top), (e) => {
    if (preview) {
      if (e.kind === 'wheelUp') scrollPreview(-WHEEL_STEP);
      else if (e.kind === 'wheelDown') scrollPreview(WHEEL_STEP);
      return;
    }
    if (e.kind === 'wheelUp') move(-WHEEL_STEP);
    else if (e.kind === 'wheelDown') move(WHEEL_STEP);
    if (e.kind !== 'click' || e.line < 0 || e.line >= height) return;
    const index = top + e.line;
    const r = rows[index];
    if (!r) return;
    setEditingFilter(false);
    setCursor(index);
    if (r.kind === 'plugin') toggle([r.plugin.id]);
    else if (e.x <= THEME_BOX_COLUMN) toggle(idsOf(r.plugins));
    else setOpen(r.theme.id, !r.expanded);
  });

  useInput((input, key) => {
    if (isMouseInput(input)) return;
    if (preview) {
      if (key.upArrow || input === 'k') scrollPreview(-1);
      else if (key.downArrow || input === 'j') scrollPreview(1);
      else if (key.pageUp) scrollPreview(-previewHeight);
      else if (key.pageDown || input === ' ') scrollPreview(previewHeight);
      else if (key.escape || key.return || input === 'p' || input === 'q') setPreview(null);
      return;
    }
    if (live.current.editingFilter) {
      if (key.return) endSearch();
      else if (key.escape) clearSearch();
      else if (key.backspace || key.delete) setFilter(live.current.filter.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFilter(live.current.filter + input);
      setCursor(0);
      return;
    }
    const row = focusedRow();
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.pageUp) move(-height);
    else if (key.pageDown) move(height);
    else if (key.rightArrow && row?.kind === 'theme') setOpen(row.theme.id, true);
    else if (key.leftArrow && row) {
      const themeId = row.kind === 'theme' ? row.theme.id : row.themeId;
      setOpen(themeId, false);
      setCursor(liveRows().findIndex((r) => r.kind === 'theme' && r.theme.id === themeId));
    } else if (input === ' ' && row) toggle(row.kind === 'plugin' ? [row.plugin.id] : idsOf(row.plugins));
    else if (input === '/') startSearch();
    else if (input === 's') cycleSort();
    else if (input === 'o') toggleOfficial();
    else if (input === 'a') toggleAll();
    else if (input === 'g') openRepository();
    else if (input === 'p') openPreview();
    else if (input === 'u' && row) toggleUpdate(row.kind === 'plugin' ? [row.plugin.id] : idsOf(row.plugins));
    else if (input === 'U') toggleUpdate([...updates]);
    else if (key.escape && live.current.filter) setFilter('');
    else if (key.return && changes(live.current.selected)) submit();
    else if (key.return && row?.kind === 'theme') setOpen(row.theme.id, !row.expanded);
    else if (input === 'q' || key.escape) onCancel();
  });

  const hints: Hint[] = editingFilter
    ? [
        [m.keyNames.enter, m.keys.done, endSearch],
        [m.keyNames.esc, m.keys.clear, clearSearch],
      ]
    : [
        [m.keyNames.space, m.keys.toggle],
        ['/', m.keys.search, startSearch],
        ...(filter ? [[m.keyNames.esc, m.keys.clear, clearSearch] as Hint] : []),
        ['a', m.keys.expandAll, toggleAll],
        ['s', m.keys.sort, cycleSort],
        ['o', m.keys.official, toggleOfficial],
        ...(row?.kind === 'plugin' && loadPreview ? [['p', m.keys.preview, openPreview] as Hint] : []),
        ...(repoOf(row) ? [['g', 'GitHub', openRepository] as Hint] : []),
        ...(updates.size ? [['u', m.keys.update] as Hint, ['U', m.keys.updateAll, () => toggleUpdate([...updates])] as Hint] : []),
        [m.keyNames.enter, m.keys.continue, canSubmit ? submit : undefined],
        ['q', m.keys.quit, onCancel],
      ];

  if (preview) {
    const p = preview.plugin;
    const shown = previewLines.slice(preview.top, preview.top + previewHeight);
    const levelColor: Record<RiskLevel, string> = { high: PALETTE.danger, medium: PALETTE.gold, info: PALETTE.muted };
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text bold>{p.name}</Text>
            <Text dimColor>{`  ${p.id}`}</Text>
          </Text>
          {previewLines.length > previewHeight && (
            <Text dimColor>{m.tree.position(formatNumber(preview.top + 1), formatNumber(previewLines.length))}</Text>
          )}
        </Box>
        <Box flexDirection="column">
          {audit?.status === 'unaudited' ? (
            <Text dimColor>{`${UNKNOWN_MARK} ${m.tree.unknownComponents}`}</Text>
          ) : risks.length ? (
            <Text color={levelColor[risks[0]!.level]} bold>{`⚠ ${m.tree.risksFound(risks.length)}`}</Text>
          ) : (
            <Text color={PALETTE.success}>{`✓ ${m.tree.noRisk}`}</Text>
          )}
          {risks.slice(0, 3).map((r) => (
            <Text key={r.code + r.detail} wrap="truncate-end" color={levelColor[r.level]}>
              {`  ${m.tree.riskLevels[r.level]} · ${r.detail}`}
            </Text>
          ))}
        </Box>
        <Panel>
          <Box ref={listRef} flexDirection="column" height={previewHeight}>
            {preview.error ? (
              <Text color={PALETTE.danger}>{preview.error}</Text>
            ) : previewText === undefined ? (
              <Text color={PALETTE.gold}>{m.tree.previewLoading}</Text>
            ) : (
              shown.map((line, i) => <Text key={preview.top + i}>{line || ' '}</Text>)
            )}
          </Box>
        </Panel>
        <Hints
          items={[
            ['↑↓', m.keys.move],
            [m.keyNames.esc, m.keys.back, () => setPreview(null)],
          ]}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text bold>{m.tree.plugins(formatNumber(visible.length))}</Text>
          <Text dimColor>{'   '}</Text>
          <Text color={PALETTE.success}>
            {BOX.on} {m.tree.selected(selected.size)}
          </Text>
          {(toInstall > 0 || toRemove > 0) && (
            <Text>
              {'   '}
              <Text color={PALETTE.success}>+{toInstall}</Text> <Text color={PALETTE.danger}>−{toRemove}</Text>
            </Text>
          )}
          {toUpdateCount > 0 && <Text color={PALETTE.gold}>{` ${UPDATE_MARK}${toUpdateCount}`}</Text>}
          {updates.size > 0 && <Text color={PALETTE.gold}>{`   ${UPDATE_MARK} ${m.tree.updates(updates.size)}`}</Text>}
          {scopes && <Text dimColor>{`   ${m.tree.scope(scopesLabel(scopes))}`}</Text>}
          <Text dimColor>{`   ${m.tree.sortedBy(m.tree.sort[sort]!)}`}</Text>
          {officialOnly && <Text color={PALETTE.lavender}>{`   ${OFFICIAL_MARK} ${m.tree.officialOnly}`}</Text>}
        </Text>
        <Text dimColor>{rows.length ? m.tree.position(formatNumber(current + 1), formatNumber(rows.length)) : ''}</Text>
      </Box>

      <Text>
        <Text color={editingFilter ? ACCENT : PALETTE.muted}>/ {m.tree.searchLabel}: </Text>
        {filter ? <Text color={PALETTE.gold}>{filter}</Text> : editingFilter ? <Text dimColor>{m.tree.searchPlaceholder}</Text> : null}
        {editingFilter && <Text color={ACCENT}>▌</Text>}
      </Text>

      <Box ref={listRef} flexDirection="column" height={height} marginTop={1}>
        {rows.slice(top, top + height).map((r, i) => {
          const focused = top + i === current;
          const hovered = i === hover && !focused;
          const pointer = <Text color={ACCENT}>{focused ? '❯ ' : hovered ? '› ' : '  '}</Text>;
          if (r.kind === 'theme') {
            const n = checkedByTheme.get(r.theme.id) ?? 0;
            const box = n === 0 ? BOX.off : n === r.plugins.length ? BOX.on : BOX.some;
            return (
              <Box key={rowKey(r)} justifyContent="space-between">
                <Text wrap="truncate-end">
                  {pointer}
                  <Text dimColor>{r.expanded ? '▾ ' : '▸ '}</Text>
                  <Text color={n ? PALETTE.success : undefined}>{box} </Text>
                  <Text bold underline={hovered} color={focused || hovered ? ACCENT : undefined}>
                    {r.theme.label}
                  </Text>
                </Text>
                <Text>
                  {n > 0 && <Text color={PALETTE.success}>{`${formatNumber(n)} ✓   `}</Text>}
                  <Text dimColor>{padStart(formatNumber(r.plugins.length), 7)}</Text>
                </Text>
              </Box>
            );
          }
          const p = r.plugin;
          const isOn = selected.has(p.id);
          const entry = installed.get(p.id);
          const outdated = isOn && updates.has(p.id);
          const status = !entry
            ? ''
            : !isOn
              ? `✗ ${m.tree.toRemove}`
              : outdated
                ? `${UPDATE_MARK} ${toUpdate.has(p.id) ? m.tree.toUpdate : m.tree.updateAvailable}`
                : `● ${scopesLabel(entry.scopes)}`;
          return (
            <Text key={rowKey(r)} wrap="truncate-end">
              {pointer}
              {'  '}
              <Text color={PALETTE.lavender}>{p.official ? OFFICIAL_MARK : ' '} </Text>
              <Text color={entry && !isOn ? PALETTE.danger : isOn ? PALETTE.success : PALETTE.muted}>{isOn ? BOX.on : BOX.off} </Text>
              <Text bold={focused} underline={hovered} color={focused || hovered ? ACCENT : undefined}>
                {fit(p.name, nameW)}
              </Text>
              <Text dimColor>{`  ${fit(p.id, idW)}`}</Text>
              <Text color={entry && !isOn ? PALETTE.danger : outdated ? PALETTE.gold : PALETTE.accent}>{`  ${fit(status, statusW)}`}</Text>
              {auditOf(p) === 'unaudited' ? (
                <Text dimColor>{padStart(UNKNOWN_MARK, riskW)}</Text>
              ) : (
                <Text color={PALETTE.danger}>{padStart(auditOf(p) === 'fail' ? RISK_MARK : '', riskW)}</Text>
              )}
            </Text>
          );
        })}
      </Box>

      <Panel>
        {row?.kind === 'plugin' ? (
          <>
            <Text wrap="truncate-end">
              <Text bold>{row.plugin.name}</Text>
              <Text dimColor>{`  ${row.plugin.id}`}</Text>
              {row.plugin.official && <Text color={PALETTE.lavender}>{`  ${OFFICIAL_MARK} ${m.tree.official}`}</Text>}
              {installed.has(row.plugin.id) && (
                <Text color={PALETTE.accent}>{`  ● ${m.tree.installedIn(scopesLabel(installed.get(row.plugin.id)!.scopes))}`}</Text>
              )}
              {installed.has(row.plugin.id) && <Text dimColor>{`  → ${agentLabels(installed.get(row.plugin.id)!.agents)}`}</Text>}
            </Text>
            <Box height={2} overflow="hidden">
              <Text wrap="wrap">{row.plugin.description ?? m.tree.noDescription}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {row.plugin.components ? m.tree.agentsOf(agentLabels(row.plugin.agents)) : `${UNKNOWN_MARK} ${m.tree.unknownComponents}`}
            </Text>
          </>
        ) : row ? (
          <>
            <Text>
              <Text bold>{row.theme.label}</Text>
              <Text dimColor>{`  ${m.tree.plugins(formatNumber(row.plugins.length))}`}</Text>
            </Text>
            <Box height={3}>
              <Text dimColor>{row.theme.description ?? m.tree.groupHint}</Text>
            </Box>
          </>
        ) : (
          <Box height={4}>
            <Text dimColor>{m.tree.noMatch}</Text>
          </Box>
        )}
      </Panel>

      <Hints items={hints} />
    </Box>
  );
}
