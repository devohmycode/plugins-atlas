// Writes demo/index.html: the local page with an extract of the catalog embedded, and no server behind it.
// Usage: tsx scripts/demo.ts [catalog.json.gz] [max plugins, default 200]
import { mkdir, writeFile } from 'node:fs/promises';
import { loadCatalog } from '../src/catalog.js';
import { searchPlugins } from '../src/search.js';
import { renderPage } from '../src/web/page.js';
import { agentList, fullPlugin } from '../src/web/server.js';

const [path, max = '200'] = process.argv.slice(2);
const catalog = await loadCatalog(path);
const plugins = searchPlugins(catalog.plugins).slice(0, Math.min(200, Number(max) || 200));
const state = { demo: true, audit: true, themes: catalog.themes, agents: agentList(), defaults: { agents: [], scope: 'project' }, total: plugins.length };
await mkdir('demo', { recursive: true });
await writeFile('demo/index.html', renderPage({ state, plugins: plugins.map(fullPlugin) }));
console.log(`demo/index.html: ${plugins.length} of ${catalog.plugins.length} plugins`);
