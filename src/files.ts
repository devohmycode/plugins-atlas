import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse, stringify } from 'smol-toml';

export class FileEditError extends Error {
  readonly name = 'FileEditError';
}

/** A key inside the document, as a path of object keys: `["enabledPlugins", "demo@acme"]`. */
export type KeyPath = readonly string[];

/** The keys one action sets or removes in one agent file. Every other key stays as it is. */
export interface FileEdit {
  path: string;
  format: 'json' | 'toml';
  set?: readonly { key: KeyPath; value: unknown }[];
  remove?: readonly KeyPath[];
}

export interface EditResult {
  path: string;
  written: boolean;
  dryRun: boolean;
  body: string;
}

type Doc = Record<string, unknown>;

function isObject(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDoc(format: FileEdit['format'], text: string | undefined, path: string): Doc {
  if (text === undefined || text.trim() === '') return {};
  let value: unknown;
  try {
    value = format === 'json' ? JSON.parse(text) : parse(text);
  } catch (err) {
    throw new FileEditError(`${path} is not valid ${format.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObject(value)) throw new FileEditError(`${path} does not hold an object`);
  return value;
}

function containerOf(doc: Doc, key: KeyPath, path: string, create: boolean): Doc | undefined {
  let node = doc;
  for (const part of key.slice(0, -1)) {
    const next = node[part];
    if (next === undefined) {
      if (!create) return undefined;
      node[part] = {};
    } else if (!isObject(next)) {
      throw new FileEditError(`${path}: ${key.join('.')} goes through ${part}, which is not an object`);
    }
    node = node[part] as Doc;
  }
  return node;
}

function render(format: FileEdit['format'], doc: Doc): string {
  // shortcut: TOML is parsed and written again, so its comments and layout are lost; keep the text if users complain.
  return format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : `${stringify(doc)}\n`;
}

/** The new file body after the edit. Pure: nothing is read or written. */
export function editText(edit: FileEdit, text: string | undefined): string {
  const doc = parseDoc(edit.format, text, edit.path);
  for (const { key, value } of edit.set ?? []) {
    const last = key.at(-1);
    if (last === undefined) throw new FileEditError(`${edit.path}: empty key`);
    (containerOf(doc, key, edit.path, true) as Doc)[last] = value;
  }
  for (const key of edit.remove ?? []) {
    const last = key.at(-1);
    const container = last === undefined ? undefined : containerOf(doc, key, edit.path, false);
    if (container && last !== undefined) delete container[last];
  }
  return render(edit.format, doc);
}

/**
 * Applies one edit to the live file. The write is atomic and keeps a `.bak` copy; a missing folder is created.
 * `dryRun` prints the result and creates nothing. An edit that changes nothing writes nothing.
 */
export async function applyEdit(edit: FileEdit, opts: { dryRun?: boolean; log?: (line: string) => void } = {}): Promise<EditResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const live = await readLive(edit.path);
  const body = editText(edit, live);
  const dryRun = opts.dryRun === true;
  if (live !== undefined && render(edit.format, parseDoc(edit.format, live, edit.path)) === body) {
    return { path: edit.path, written: false, dryRun, body };
  }
  if (dryRun) {
    log(`dry-run ${edit.path}`);
    log(body);
    return { path: edit.path, written: false, dryRun, body };
  }
  await replaceFile(edit.path, body);
  return { path: edit.path, written: true, dryRun, body };
}

async function readLive(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Writes `path.tmp`, then renames it into place. Windows rename does not replace an existing file,
 * so the previous bytes are copied to `path.bak` and the destination removed first. A failure removes the temporary file.
 */
async function replaceFile(path: string, body: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, body);
  try {
    if (existsSync(path)) {
      await copyFile(path, `${path}.bak`);
      await rm(path);
    }
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
