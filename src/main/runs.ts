import { join } from 'node:path';
import { ATAS } from './env';
import { type RunStore, createRunStore } from './runs-core';

// The runs of the running workspace: <workspace>/runs/<id>.json. Phase 2's runner and the screens go through this.
let store: RunStore | null = null;

export function runStore(): RunStore {
  store ??= createRunStore(join(ATAS, 'runs'));
  return store;
}
