/**
 * Plays a scripted session in the terminal wizard and writes each frame, with ANSI colors, to
 * `scripts/gif/out/frames.json`. Nothing is installed: the wizard stops at the review.
 * Run with `npm run gif:frames`, then `npm run gif` (scripts/gif/record.ts).
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { InstalledState } from '../../src/ui/App.js';
import type { InstalledEntry } from '../../src/ui/TreeSelect.js';

// Colors on, before Ink and chalk load: the frames are recorded through a pipe.
process.env.FORCE_COLOR = '3';
delete process.env.NO_COLOR;
const { render } = await import('ink');
const { loadCatalog } = await import('../../src/catalog.js');
const { App } = await import('../../src/ui/App.js');

export const COLUMNS = 112;
export const ROWS = 34;

class Stdout extends EventEmitter {
  readonly columns = COLUMNS;
  readonly rows = ROWS;
  readonly isTTY = true;
  last = '';
  write = (frame: string) => {
    this.last = frame;
    return true;
  };
}

class Stdin extends EventEmitter {
  readonly isTTY = true;
  private data: string | null = null;
  write = (data: string) => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
  read = () => {
    const data = this.data;
    this.data = null;
    return data;
  };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

const DOWN = '\u001B[B';
const ESC = '\u001B';
const ENTER = '\r';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The logo reads its color depth from the real stdout, which is a pipe here.
Object.defineProperty(process.stdout, 'isTTY', { value: true });

const catalog = await loadCatalog('data/catalog.json.gz');
const byId = new Map(catalog.plugins.map((p) => [p.id, p]));
const installed = new Map<string, InstalledEntry>(
  ['superpowers@claude-plugins-official', 'frontend-design@claude-plugins-official'].flatMap((id) => {
    const plugin = byId.get(id);
    return plugin ? [[id, { scopes: ['user'], agents: ['claude-code'], plugin }] as [string, InstalledEntry]] : [];
  }),
);
const state: InstalledState = { installed, updates: new Set(['frontend-design@claude-plugins-official']) };

const stdout = new Stdout();
const stdin = new Stdin();
const frames: { text: string; ms: number }[] = [];
const snap = (ms: number) => frames.push({ text: stdout.last, ms });

render(
  <App
    themes={catalog.themes}
    plugins={catalog.plugins}
    allPlugins={catalog.plugins}
    preset={{}}
    defaults={{ agents: ['claude-code'], scope: 'user' }}
    detectedAgents={['claude-code', 'copilot-cli', 'droid', 'codex-cli', 'cursor']}
    loadInstalled={async () => (await sleep(900), state)}
    loadPreview={async (plugin) => ({
      id: plugin.id,
      readme: `# ${plugin.name}\n\n${plugin.description ?? ''}`,
      components: plugin.components ?? { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] },
    })}
    onDone={() => {}}
  />,
  { stdout: stdout as never, stdin: stdin as never, stderr: new Stdout() as never, debug: true, exitOnCtrlC: false, patchConsole: false },
);

const keys = async (sequence: string[], each = 140, hold = 140) => {
  for (const key of sequence) {
    stdin.write(key);
    await sleep(60);
    snap(each);
  }
  if (hold > each) snap(hold);
};

await sleep(150);
snap(1600);
await sleep(1100);
snap(1800);
await keys([DOWN, DOWN, DOWN], 260, 600);
await keys(['/'], 260);
await keys([...'aws'], 180, 900);
await keys([ENTER], 200, 600);
// aws-amplify, then aws-serverless: both have MCP servers or hooks, so the review shows the audit.
await keys([DOWN, DOWN, DOWN], 220);
await keys([' '], 300, 600);
await keys([DOWN, DOWN, DOWN], 220);
await keys([' '], 300, 800);
await keys(['p'], 300, 3000);
await keys([ESC], 300, 600);
await keys([ENTER], 300, 1500);
await keys([DOWN], 300, 500);
await keys([ENTER], 300, 1200);
await keys([DOWN, DOWN, DOWN], 220);
await keys([' '], 300, 1200);
await keys([ENTER], 300, 4500);

mkdirSync('scripts/gif/out', { recursive: true });
writeFileSync('scripts/gif/out/frames.json', JSON.stringify({ columns: COLUMNS, rows: ROWS, frames }));
console.log(`${frames.length} frames`);
process.exit(0);
