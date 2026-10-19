import type { AgentId } from '../types.js';
import { claudeCode } from './claude-code.js';
import { claudeDesktop } from './claude-desktop.js';
import { codex } from './codex.js';
import type { Adapter } from './common.js';
import { copilot } from './copilot.js';
import { cursor } from './cursor.js';
import { droid } from './droid.js';

export type { Adapter, AgentContext, InstalledEntry } from './common.js';

/** Codex CLI and Codex desktop share one adapter: they read the same files. */
export const ADAPTERS: Record<AgentId, Adapter> = {
  'claude-code': claudeCode,
  'claude-desktop': claudeDesktop,
  'copilot-cli': copilot,
  droid,
  'codex-cli': codex,
  'codex-desktop': codex,
  cursor,
};
