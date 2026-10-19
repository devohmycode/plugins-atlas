import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentHome } from '../agents.js';
import { pluginPath } from '../components.js';
import { requestHeaders } from '../http.js';
import { isName, parsePluginId } from '../id.js';
import { readPluginRepo } from '../repo.js';
import { AdapterError, type Adapter, type AgentContext, type InstalledEntry } from './common.js';

/** Written in each folder this tool creates, so it never removes a plugin it did not install. */
const MARKER = '.plugins-atlas.json';
const MAX_FILES = 2_000;
const MAX_BYTES = 50 * 1024 * 1024;

function localDir(ctx: AgentContext): string {
  const dir = agentHome('cursor', ctx.home, ctx.env);
  if (!dir) throw new AdapterError('Cursor has no config folder');
  return join(dir, 'plugins', 'local');
}

async function markerId(folder: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await readFile(join(folder, MARKER), 'utf8')) as { id?: unknown };
    return typeof value.id === 'string' ? value.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cursor: the only documented outside mechanism is a plugin folder in `~/.cursor/plugins/local/<name>/`,
 * read after a restart or Developer: Reload Window. Files are downloaded one by one from GitHub; nothing is run.
 */
export const cursor: Adapter = {
  async known() {
    // Local plugins need no marketplace.
    return new Map();
  },

  async install(_plan, plugin, ctx) {
    const log = ctx.log ?? ((line: string) => console.log(line));
    if (!isName(plugin.name)) throw new AdapterError(`Unusable plugin name ${plugin.name}`);
    const folder = join(localDir(ctx), plugin.name);
    const owner = existsSync(folder) ? await markerId(folder) : undefined;
    if (existsSync(folder) && owner !== plugin.id) throw new AdapterError(`${folder} exists and was not installed by plugins-atlas for ${plugin.id}`);
    if (!plugin.source) throw new AdapterError(`${plugin.id}: no marketplace file says where its files are`);
    const files = await readPluginRepo(plugin.source, plugin.marketplace.source, ctx.repo);
    if (!files) throw new AdapterError(`${plugin.id}: its files are not on GitHub`);
    if (files.files.length > MAX_FILES) throw new AdapterError(`${plugin.id} has ${files.files.length} files, over ${MAX_FILES}`);
    if (ctx.dryRun) {
      log(`dry-run ${folder}: ${files.files.length} files from ${files.location.repo}`);
      return;
    }
    const tmp = `${folder}.tmp-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    try {
      let total = 0;
      const { location } = files;
      const fetchImpl = ctx.repo?.fetch ?? fetch;
      for (const file of files.files) {
        const rel = pluginPath('file', file);
        const full = location.root === '' ? rel : `${location.root}/${rel}`;
        const url = `https://raw.githubusercontent.com/${location.repo}/${encodeURIComponent(location.revision)}/${full.split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetchImpl(url, { headers: requestHeaders(url, '*/*', ctx.repo?.env ?? ctx.env), signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new AdapterError(`HTTP ${res.status} for ${url}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        total += bytes.length;
        if (total > MAX_BYTES) throw new AdapterError(`${plugin.id} is over ${MAX_BYTES} bytes`);
        await mkdir(dirname(join(tmp, rel)), { recursive: true });
        await writeFile(join(tmp, rel), bytes);
      }
      await writeFile(join(tmp, MARKER), `${JSON.stringify({ id: plugin.id, repo: location.repo, revision: location.revision })}\n`);
      if (existsSync(folder)) await rm(folder, { recursive: true, force: true });
      await rename(tmp, folder);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw err;
    }
    log(`${plugin.id}: installed in ${folder}. Restart Cursor or run Developer: Reload Window.`);
  },

  async uninstall(id, _scope, ctx) {
    const folder = join(localDir(ctx), parsePluginId(id).plugin);
    if (!existsSync(folder)) return;
    if ((await markerId(folder)) !== id) throw new AdapterError(`${folder} was not installed by plugins-atlas for ${id}`);
    if (ctx.dryRun) {
      (ctx.log ?? console.log)(`dry-run remove ${folder}`);
      return;
    }
    await rm(folder, { recursive: true, force: true });
  },

  async installed(scope, ctx) {
    const root = localDir(ctx);
    if (!existsSync(root)) return [];
    const entries: InstalledEntry[] = [];
    for (const name of await readdir(root)) {
      const id = await markerId(join(root, name));
      if (id) entries.push({ id, scope, enabled: true });
    }
    return entries;
  },
};
