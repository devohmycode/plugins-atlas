import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UserConfig {
  /** `false` turns the audit off for every run. On by default. */
  audit?: boolean;
}

export function configPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
  return join(base, 'plugins-atlas', 'config.json');
}

/** The saved config, or `{}` when there is none or it does not parse. */
export function readConfig(path = configPath()): UserConfig {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { audit?: unknown };
    return typeof value.audit === 'boolean' ? { audit: value.audit } : {};
  } catch {
    return {};
  }
}
