const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const formatNumber = (n: number): string => n.toLocaleString('en-US');

/** Interface texts: those of mcp-atlas, with servers as plugins and clients as agents. */
export const m = {
  tagline: 'Every public agent plugin, by theme — pick, install, uninstall.',

  steps: { select: 'Select', scope: 'Scope', agents: 'Agents', confirm: 'Confirm' },

  keyNames: { enter: '↵', space: '␣', esc: 'esc' },

  keys: {
    move: 'move',
    toggle: 'toggle',
    search: 'search',
    expandAll: 'expand',
    sort: 'sort',
    official: 'official',
    continue: 'next',
    choose: 'choose',
    back: 'back',
    quit: 'quit',
    typeToFilter: 'filter',
    apply: 'apply',
    done: 'done',
    clear: 'clear',
    update: 'update',
    updateAll: 'update all',
    preview: 'preview',
    keep: 'keep',
  },

  scope: {
    title: 'Where should the new plugins be installed?',
    project: 'Project',
    projectHint: (cwd: string) => `this directory — ${cwd}`,
    global: 'Global',
    globalHint: 'your user profile — every project',
  },

  agents: {
    title: 'Which agents get the new plugins?',
    all: 'Every agent',
    detected: 'detected',
    selected: (n: number) => `${n} selected`,
  },

  loading: (scope: string) => `Looking for plugins already installed (${scope})…`,
  detectFailed: (msg: string) => `Could not read the installed plugins: ${msg}`,

  tree: {
    plugins: (n: string) => `${n} plugins`,
    selected: (n: number) => `${n} selected`,
    scope: (where: string) => `scope: ${where}`,
    searchLabel: 'search',
    searchPlaceholder: 'type to filter, enter to keep, esc to clear',
    noDescription: 'No description.',
    noMatch: 'No plugin matches this search.',
    groupHint: 'Press space to toggle the whole group.',
    official: 'official',
    officialOnly: 'official only',
    sortedBy: (order: string) => `sorted by ${order}`,
    sort: { official: 'official first', name: 'name' } as Record<string, string>,
    position: (at: string, of: string) => `${at}/${of}`,
    installedIn: (where: string) => `installed (${where})`,
    toRemove: 'to remove',
    toUpdate: 'to update',
    updateAvailable: 'update available',
    updates: (n: number) => `${n} ${s(n, 'update', 'updates')}`,
    where: { project: 'project', user: 'global' },
    agentsOf: (labels: string) => `agents: ${labels}`,
    unknownComponents: 'components unknown: read and audited at install',
    previewLoading: 'Reading the README…',
    previewFailed: (msg: string) => `Could not read the plugin: ${msg}`,
    noReadme: 'No README.',
    risksFound: (n: number) => `${n} warning ${s(n, 'sign', 'signs')}`,
    noRisk: 'No warning sign in the components.',
    riskLevels: { high: 'high', medium: 'medium', info: 'info' },
  },

  confirm: {
    title: 'Review before writing',
    install: (n: number) => `Install ${n} ${s(n, 'plugin', 'plugins')}`,
    remove: (n: number) => `Uninstall ${n} ${s(n, 'plugin', 'plugins')}`,
    update: (n: number) => `Update ${n} ${s(n, 'plugin', 'plugins')}`,
    scope: 'scope',
    agents: 'agents',
    auditOff: 'Audit off: high risks are not left out.',
    auditFailed: (n: number) => `${n} ${s(n, 'plugin fails', 'plugins fail')} the audit and ${s(n, 'is', 'are')} left out`,
    auditPassed: (n: number) => `${n} ${s(n, 'plugin passes', 'plugins pass')} the audit`,
    auditKept: 'kept anyway',
    auditLeftOut: 'left out',
    auditHint: 'Space keeps a plugin despite the risk.',
    auditUnread: 'components unknown: read and audited at install',
    noAgent: 'no chosen agent reads its manifests',
  },

  run: {
    summaryInstalled: (done: number, of: number) => `${done}/${of} installed`,
    summaryRemoved: (done: number, of: number) => `${done}/${of} uninstalled`,
    summaryUpdated: (done: number, of: number) => `${done}/${of} updated`,
    noChange: 'Nothing changed.',
  },
};
