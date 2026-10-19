import { expect, it } from 'vitest';
import { componentFiles, ManifestError, readComponents } from '../src/components.js';

const files = [
  '.claude-plugin/plugin.json',
  'skills/pdf/SKILL.md',
  'skills/pdf/scripts/run.py',
  'skills/notes.md',
  'commands/review.md',
  'agents/reviewer.md',
  'hooks/hooks.json',
  '.mcp.json',
  'extra/cmds/deploy.md',
  'extra/hooks.json',
  'README.md',
];

const hooksJson = {
  description: 'format on save',
  hooks: {
    PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/fmt.sh' }, { type: 'prompt', prompt: 'x' }] }],
  },
};
const mcpJson = { mcpServers: { db: { command: 'npx', args: ['-y', 'db-mcp@1.2.0'], env: { DB_TOKEN: 'x' } } } };

it('reads the default folders', () => {
  const json = { 'hooks/hooks.json': hooksJson, '.mcp.json': mcpJson };
  expect(readComponents({ files, json })).toEqual({
    skills: ['skills/pdf'],
    commands: ['commands/review.md'],
    agents: ['agents/reviewer.md'],
    hooks: [{ event: 'PostToolUse', matcher: 'Write|Edit', command: '${CLAUDE_PLUGIN_ROOT}/fmt.sh' }],
    mcpServers: [{ name: 'db', command: 'npx', args: ['-y', 'db-mcp@1.2.0'], env: { DB_TOKEN: 'x' } }],
  });
});

it('adds the paths the manifest declares, and its inline hooks and servers', () => {
  const manifest = {
    name: 'demo',
    commands: ['./extra/cmds/', './commands/review.md'],
    hooks: './extra/hooks.json',
    mcpServers: { remote: { type: 'http', url: 'https://mcp.example.com' } },
  };
  expect(componentFiles(manifest, files)).toEqual(['hooks/hooks.json', '.mcp.json', 'extra/hooks.json']);
  const json = {
    'hooks/hooks.json': hooksJson,
    '.mcp.json': mcpJson,
    'extra/hooks.json': { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
  };
  const components = readComponents({ manifest, files, json });
  expect(components.commands).toEqual(['commands/review.md', 'extra/cmds/deploy.md']);
  expect(components.hooks.map((h) => h.event)).toEqual(['PostToolUse', 'SessionStart']);
  expect(components.mcpServers.map((s) => s.name)).toEqual(['db', 'remote']);
  expect(components.mcpServers[1]).toEqual({ name: 'remote', url: 'https://mcp.example.com' });
});

it('rejects a path that leaves the plugin', () => {
  for (const path of ['../x', './a/../../x', '/etc/passwd', 'C:\\x', '..\\x']) {
    expect(() => readComponents({ manifest: { commands: path }, files, json: {} }), path).toThrow(ManifestError);
  }
});

it('names the field of a malformed manifest or file', () => {
  expect(() => readComponents({ manifest: { skills: 3 }, files: [], json: {} })).toThrow('skills');
  expect(() => readComponents({ manifest: [], files: [], json: {} })).toThrow(ManifestError);
  expect(() => readComponents({ files, json: { 'hooks/hooks.json': { hooks: { Stop: 'x' } }, '.mcp.json': {} } })).toThrow(
    'hooks/hooks.json.Stop',
  );
  expect(() => readComponents({ files, json: {} })).toThrow('was not read');
});

it('reads a plugin without manifest or components', () => {
  expect(readComponents({ files: ['README.md'], json: {} })).toEqual({ skills: [], commands: [], agents: [], hooks: [], mcpServers: [] });
});
