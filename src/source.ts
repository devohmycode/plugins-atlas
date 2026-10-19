import type { Origin, RawPlugin } from './types.js';

/** One catalog upstream. `origin` is the name stored on each raw plugin. */
export interface Source {
  readonly origin: Origin;
  fetch(): Promise<RawPlugin[]>;
}

/** The upstream answered in a shape this code does not know. */
export class ContractError extends Error {
  readonly name = 'ContractError';
  constructor(origin: Origin, detail: string) {
    super(`${origin}: the remote contract changed (${detail})`);
  }
}
