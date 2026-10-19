/** Where a plugin record came from: the sources of T10 to T13. */
export const ORIGINS = ['official', 'claude-plugins.dev', 'github', 'codex', 'cursor'] as const;
export type Origin = (typeof ORIGINS)[number];

export const SCOPES = ['project', 'user'] as const;
export type Scope = (typeof SCOPES)[number];

export const AGENT_IDS = [
  'claude-code',
  'claude-desktop',
  'copilot-cli',
  'droid',
  'codex-cli',
  'codex-desktop',
  'cursor',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Where a marketplace is fetched from. Its id is `github:owner/repo`, else the git URL. */
export type MarketplaceSource =
  | { kind: 'github'; repo: string; ref?: string }
  | { kind: 'git'; url: string; ref?: string };

/** Where a plugin's files live, as its marketplace entry declares it. */
export type PluginSource =
  /** A folder inside the marketplace's own repository. */
  | { kind: 'path'; path: string }
  /** `path` is a folder inside that repository (`git-subdir`), else its root. */
  | { kind: 'github'; repo: string; ref?: string; sha?: string; path?: string }
  | { kind: 'git'; url: string; ref?: string; sha?: string; path?: string };

export interface Marketplace {
  /** The name agents register the marketplace under. */
  name: string;
  source: MarketplaceSource;
  owner?: string;
  /** The marketplace file read, relative to the repository root. Absent when a directory reported it. */
  file?: string;
}

export interface Hook {
  /** The event that fires it, such as `PreToolUse`. */
  event: string;
  matcher?: string;
  command: string;
}

export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** What a plugin bundles. Names are relative to the plugin root. */
export interface Components {
  skills: string[];
  commands: string[];
  agents: string[];
  hooks: Hook[];
  mcpServers: McpServer[];
}

export interface Author {
  name: string;
  email?: string;
  url?: string;
}

export interface Repository {
  url: string;
}

/** One source's view of a plugin, before merging. */
export interface RawPlugin {
  origin: Origin;
  name: string;
  marketplace: Marketplace;
  /** Absent when a directory names the plugin without saying where its files are. */
  source?: PluginSource;
  description?: string;
  version?: string;
  author?: Author;
  repository?: Repository;
  category?: string;
  keywords?: string[];
}

/** A merged catalog entry. */
export interface Plugin {
  /** `plugin@marketplace`. */
  id: string;
  name: string;
  marketplace: Marketplace;
  /** Absent until a marketplace file says where the files are: "composants inconnus". */
  source?: PluginSource;
  description?: string;
  version?: string;
  author?: Author;
  repository?: Repository;
  category?: string;
  keywords: string[];
  /** Absent when the plugin's files could not be read: "composants inconnus". */
  components?: Components;
  /** Agents that can read one of its manifests. */
  agents: AgentId[];
  origins: Origin[];
  /** Theme ids. Empty until classification. */
  themes: string[];
  official: boolean;
}

export interface Theme {
  id: string;
  label: string;
  description?: string;
}

/** Outcome of one source during a build. A failure is named in `error` and skipped. */
export interface SourceReport {
  status: 'ok' | 'error';
  count: number;
  error?: string;
}

export interface CatalogStats {
  /** Raw records kept from each requested origin. A skipped source counts as 0. */
  raw: Partial<Record<Origin, number>>;
  sources: Partial<Record<Origin, SourceReport>>;
  merged: number;
  official: number;
  byTheme: Record<string, number>;
  byAgent: Partial<Record<AgentId, number>>;
  /** Plugin repositories: read, failed, and left unread (no GitHub source, or past the read limit). */
  repos: { read: number; failed: number; unread: number };
  /** The first failed repository reads, each named. */
  repoErrors: { id: string; error: string }[];
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  themes: Theme[];
  plugins: Plugin[];
  stats: CatalogStats;
}
