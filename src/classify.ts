import { THEME_IDS, type ThemeId } from './taxonomy.js';

const NAME_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const KEYWORD_WEIGHT = 2;
/** Description matches stop counting past this, so a long text cannot drown the name. */
const DESCRIPTION_CAP = 4;
/** A second theme is kept when it scores at least this much, and this share of the first. */
const SECONDARY_MIN = 3;
const SECONDARY_RATIO = 0.6;

const RULES: readonly { id: ThemeId; keywords: readonly string[] }[] = [
  { id: 'code-quality', keywords: ['review', 'reviewer', 'refactor', 'refactoring', 'lint', 'linting', 'format', 'formatter', 'quality', 'simplify', 'cleanup'] },
  { id: 'testing', keywords: ['test', 'tests', 'testing', 'tdd', 'qa', 'e2e', 'coverage', 'playwright', 'jest', 'pytest'] },
  { id: 'git', keywords: ['git', 'github', 'gitlab', 'commit', 'commits', 'pr', 'prs', 'branch', 'merge'] },
  { id: 'devops', keywords: ['devops', 'deploy', 'deployment', 'ci', 'cd', 'docker', 'kubernetes', 'k8s', 'terraform', 'aws', 'azure', 'gcp', 'cloud', 'infrastructure'] },
  { id: 'security', keywords: ['security', 'secure', 'vulnerability', 'vulnerabilities', 'audit', 'pentest', 'owasp', 'secrets'] },
  { id: 'databases', keywords: ['database', 'databases', 'sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'supabase', 'redis'] },
  { id: 'frontend', keywords: ['frontend', 'ui', 'ux', 'design', 'css', 'tailwind', 'react', 'vue', 'svelte', 'figma'] },
  { id: 'documentation', keywords: ['docs', 'documentation', 'readme', 'writing', 'changelog', 'markdown'] },
  { id: 'data', keywords: ['data', 'analytics', 'ml', 'machine', 'llm', 'ai', 'notebook', 'pandas'] },
  { id: 'productivity', keywords: ['productivity', 'notion', 'slack', 'jira', 'linear', 'calendar', 'email', 'todo', 'tasks'] },
  { id: 'agents', keywords: ['agent', 'agents', 'subagent', 'subagents', 'orchestration', 'workflow', 'workflows', 'hooks', 'plugin', 'plugins', 'skills'] },
];

/** Marketplace categories that name a theme without matching one of its keywords. */
const CATEGORY_ALIASES: Readonly<Record<string, ThemeId>> = {
  development: 'code-quality',
  'code-quality': 'code-quality',
  testing: 'testing',
  git: 'git',
  'version-control': 'git',
  devops: 'devops',
  deployment: 'devops',
  infrastructure: 'devops',
  security: 'security',
  database: 'databases',
  databases: 'databases',
  design: 'frontend',
  frontend: 'frontend',
  documentation: 'documentation',
  docs: 'documentation',
  data: 'data',
  'data-science': 'data',
  ai: 'data',
  productivity: 'productivity',
  automation: 'agents',
  agents: 'agents',
  workflow: 'agents',
};

const COMPILED = RULES.map((rule) => ({
  id: rule.id,
  re: new RegExp(`(?<![a-z0-9])(?:${rule.keywords.join('|')})(?![a-z0-9])`, 'gi'),
}));

const KEYWORD_TO_THEME = new Map<string, ThemeId>();
for (const rule of RULES) {
  KEYWORD_TO_THEME.set(rule.id, rule.id);
  for (const keyword of rule.keywords) KEYWORD_TO_THEME.set(keyword, rule.id);
}

const THEME_INDEX = new Map<ThemeId, number>(THEME_IDS.map((id, index) => [id, index]));

export interface Classifiable {
  name?: string;
  description?: string;
  /** The marketplace's category for the plugin. It wins when it names a theme. */
  category?: string;
  keywords?: readonly string[];
}

/** One or two theme ids, primary first. `other` when nothing matches. */
export function classify(input: Classifiable): ThemeId[] {
  const declared = input.category ? themeOfCategory(input.category) : undefined;
  const ranked = [...score(input).entries()].sort((a, b) => b[1] - a[1] || index(a[0]) - index(b[0]));
  if (declared) {
    const second = ranked.find(([id]) => id !== declared);
    return second && second[1] >= SECONDARY_MIN ? [declared, second[0]] : [declared];
  }
  const first = ranked[0];
  if (!first) return ['other'];
  const themes: ThemeId[] = [first[0]];
  const second = ranked[1];
  if (second && second[1] >= SECONDARY_MIN && second[1] >= first[1] * SECONDARY_RATIO) themes.push(second[0]);
  return themes;
}

function themeOfCategory(category: string): ThemeId | undefined {
  const key = category.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return CATEGORY_ALIASES[key] ?? KEYWORD_TO_THEME.get(key);
}

function score(input: Classifiable): Map<ThemeId, number> {
  const name = normalize(input.name ?? '');
  const description = normalize(input.description ?? '');
  const scores = new Map<ThemeId, number>();
  for (const { id, re } of COMPILED) {
    const value = count(re, name) * NAME_WEIGHT + Math.min(count(re, description), DESCRIPTION_CAP) * DESCRIPTION_WEIGHT;
    if (value > 0) scores.set(id, value);
  }
  for (const keyword of input.keywords ?? []) {
    const theme = KEYWORD_TO_THEME.get(keyword.toLowerCase());
    if (theme) scores.set(theme, (scores.get(theme) ?? 0) + KEYWORD_WEIGHT);
  }
  return scores;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_\-./]+/g, ' ');
}

function count(re: RegExp, text: string): number {
  if (!text) return 0;
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text)) n += 1;
  return n;
}

function index(id: ThemeId): number {
  return THEME_INDEX.get(id) ?? THEME_IDS.length;
}
