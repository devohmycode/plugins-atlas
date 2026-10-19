import { expect, it } from 'vitest';
import { componentLines, PreviewError, readPreview } from '../src/preview.js';

const marketplace = { name: 'm', source: { kind: 'github', repo: 'acme/m' } } as const;

it('reads the README and the components from the declared repository', async () => {
  const routes: Record<string, unknown> = {
    'https://api.github.com/repos/acme/m/git/trees/HEAD?recursive=1': { tree: [{ path: 'p/README.md', type: 'blob' }, { path: 'p/commands/go.md', type: 'blob' }] },
    'https://raw.githubusercontent.com/acme/m/HEAD/p/README.md': '# P',
  };
  const fetchImpl: typeof fetch = async (url) => {
    const body = routes[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const preview = await readPreview({ id: 'p@m', marketplace, source: { kind: 'path', path: 'p' } }, { fetch: fetchImpl, env: {} });
  expect(preview).toMatchObject({ id: 'p@m', readme: '# P', components: { commands: ['commands/go.md'] } });
});

it('says readably why a plugin cannot be previewed', async () => {
  await expect(readPreview({ id: 'p@m', marketplace })).rejects.toThrow(PreviewError);
  await expect(readPreview({ id: 'p@m', marketplace, source: { kind: 'git', url: 'https://gitlab.com/a/b.git' } })).rejects.toThrow('not on GitHub');
});

it('lists hooks with their event and MCP servers with their command', () => {
  expect(
    componentLines({
      skills: ['skills/a'],
      commands: [],
      agents: [],
      hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: 'check.sh' }],
      mcpServers: [{ name: 'db', command: 'npx', args: ['-y', 'db@1'] }, { name: 'r', url: 'https://x.dev/mcp' }],
    }),
  ).toEqual(['skill    skills/a', 'hook     PreToolUse (Bash): check.sh', 'mcp      db: npx -y db@1', 'mcp      r: https://x.dev/mcp']);
});
