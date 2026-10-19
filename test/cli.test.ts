import { expect, it } from 'vitest';
import { createProgram } from '../src/cli.js';

it('names itself in the help', () => {
  expect(createProgram().helpInformation()).toContain('plugins-atlas');
});
