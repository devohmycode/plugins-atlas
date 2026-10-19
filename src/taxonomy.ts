import type { Theme } from './types.js';

/** Closed list. Classification may only emit these ids. */
export const THEME_IDS = [
  'code-quality',
  'testing',
  'git',
  'devops',
  'security',
  'databases',
  'frontend',
  'documentation',
  'data',
  'productivity',
  'agents',
  'other',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEMES: readonly Theme[] = [
  { id: 'code-quality', label: 'Code quality and review' },
  { id: 'testing', label: 'Testing' },
  { id: 'git', label: 'Git and pull requests' },
  { id: 'devops', label: 'DevOps and cloud' },
  { id: 'security', label: 'Security' },
  { id: 'databases', label: 'Databases' },
  { id: 'frontend', label: 'Frontend and design' },
  { id: 'documentation', label: 'Documentation and writing' },
  { id: 'data', label: 'Data and AI' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'agents', label: 'Agents and workflows' },
  { id: 'other', label: 'Other' },
];
