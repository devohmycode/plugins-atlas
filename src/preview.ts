import { readPluginRepo, type RepoOptions } from './repo.js';
import type { Components, Plugin } from './types.js';

export class PreviewError extends Error {
  readonly name = 'PreviewError';
}

export interface Preview {
  id: string;
  readme?: string;
  components: Components;
}

/** README and components of one plugin, read from its declared repository file by file. Nothing is cloned or run. */
export async function readPreview(plugin: Pick<Plugin, 'id' | 'source' | 'marketplace'>, opts: RepoOptions = {}): Promise<Preview> {
  if (!plugin.source) throw new PreviewError(`${plugin.id}: no marketplace file says where its files are`);
  const files = await readPluginRepo(plugin.source, plugin.marketplace.source, opts);
  if (!files) throw new PreviewError(`${plugin.id}: its files are not on GitHub, so they cannot be read without cloning`);
  return { id: plugin.id, ...(files.readme === undefined ? {} : { readme: files.readme }), components: files.components };
}

/** One line per component, hooks with their event and MCP servers with their command or URL. */
export function componentLines(components: Components): string[] {
  const lines: string[] = [];
  for (const skill of components.skills) lines.push(`skill    ${skill}`);
  for (const command of components.commands) lines.push(`command  ${command}`);
  for (const agent of components.agents) lines.push(`agent    ${agent}`);
  for (const hook of components.hooks) lines.push(`hook     ${hook.event}${hook.matcher ? ` (${hook.matcher})` : ''}: ${hook.command}`);
  for (const server of components.mcpServers) {
    const how = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ');
    lines.push(`mcp      ${server.name}: ${how}`);
  }
  return lines;
}
