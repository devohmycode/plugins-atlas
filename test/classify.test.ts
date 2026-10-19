import { expect, it } from 'vitest';
import { classify } from '../src/classify.js';
import { THEME_IDS, THEMES } from '../src/taxonomy.js';

// Plugins of the official Claude Code marketplace, with the theme a reader would expect.
const known = [
  { name: 'code-review', description: 'Automated code review for pull requests', expected: 'code-quality' },
  { name: 'commit-commands', description: 'Commands for git commit workflows', expected: 'git' },
  { name: 'security-guidance', description: 'Warns about security issues when editing files', expected: 'security' },
  { name: 'frontend-design', description: 'Create distinctive frontend interfaces', expected: 'frontend' },
  { name: 'plugin-dev', description: 'Toolkit for developing plugins, hooks and skills', expected: 'agents' },
];

it('classifies known plugins into the expected primary theme', () => {
  for (const plugin of known) {
    const themes = classify(plugin);
    expect(themes[0], plugin.name).toBe(plugin.expected);
    expect(themes.length).toBeLessThanOrEqual(2);
    expect(themes.every((id) => (THEME_IDS as readonly string[]).includes(id))).toBe(true);
  }
});

it('lets the declared category win over the words', () => {
  expect(classify({ name: 'git-helper', description: 'git commits', category: 'security' })[0]).toBe('security');
  expect(classify({ name: 'x', category: 'Development' })).toEqual(['code-quality']);
});

it('falls back to the words when the category names no theme', () => {
  expect(classify({ name: 'pytest-runner', category: 'misc' })).toEqual(['testing']);
});

it('uses keywords when the name and description do not match', () => {
  expect(classify({ name: 'scratch', description: 'Nothing recognisable', keywords: ['docker'] })).toEqual(['devops']);
});

it('returns other when nothing matches', () => {
  expect(classify({ name: 'xyzzy', description: 'No matching words' })).toEqual(['other']);
});

it('labels every theme id', () => {
  expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
});
