import { expect, it } from 'vitest';
import { complete, completionScript, FILES } from '../src/completion.js';

const ctx = {
  commands: [
    { name: 'install', options: ['-a', '--agent', '-g', '--global'] },
    { name: 'list', options: ['-q', '--search', '-t', '--theme'] },
    { name: 'show', options: ['--json'] },
    { name: 'import', options: [] },
    { name: 'completion', options: [] },
  ],
  globalOptions: ['--offline', '--help'],
  themes: () => ['files', 'git'],
  agents: ["cursor", "codex-cli"],
  ids: (prefix: string) => ['demo@acme', 'docs@acme'].filter((id) => id.startsWith(prefix)),
};

it('completes commands, options, clients, themes, and ids without a network call', () => {
  expect(complete([''], ctx)).toContain('install');
  expect(complete(['list', '--s'], ctx)).toContain('--search');
  expect(complete(['install', '-a', 'cu'], ctx)).toEqual(['cursor']);
  expect(complete(['list', '-t', 'fi'], ctx)).toEqual(['files']);
  expect(complete(['show', 'demo'], ctx)).toEqual(['demo@acme']);
  expect(complete(['import', ''], ctx)).toEqual([FILES]);
  expect(complete(['completion', 'b'], ctx)).toEqual(['bash']);
});

it('writes a script for each shell and refuses an unknown one', () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
    const script = completionScript(shell);
    expect(script).toContain('plugins-atlas');
    expect(script).toContain('__complete');
  }
  expect(completionScript('cmd')).toBeUndefined();
});
