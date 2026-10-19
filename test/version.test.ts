import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createProgram } from '../src/cli.js';
import { USER_AGENT } from '../src/http.js';
import { VERSION } from '../src/version.js';

it('reports the package version everywhere', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  expect(VERSION).toBe(pkg.version);
  expect(createProgram().version()).toBe(VERSION);
  expect(USER_AGENT).toBe(`plugins-atlas/${VERSION}`);
});
