import { ATAS } from '../env';
import { logError } from '../errorlog';
import { createMemoryStore, type MemoryStore, type MemoryWrite } from './store';

// The one memory store of the running workspace, over its data folder, and the listeners told when it changes. The channels, the agents' tools and the screens share it, so a
// write by an agent reaches an open screen. Created on first use.

let store: MemoryStore | null = null;
const listeners = new Set<() => void>();
const writers = new Set<(write: MemoryWrite) => void>();

export function memoryStore(): MemoryStore {
  store ??= createMemoryStore(ATAS, {
    onError: (e) => logError('memory', e),
    onChange: () => {
      for (const fn of listeners) fn();
    },
    onWrite: (write) => {
      for (const fn of writers) fn(write);
    },
  });
  return store;
}

/** Calls `fn` after every change that took effect. Returns the way to stop. */
export function onMemoryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Calls `fn` after an agent created or replaced a note (the person's edits do not count). Returns the way to stop. */
export function onMemoryWrite(fn: (write: MemoryWrite) => void): () => void {
  writers.add(fn);
  return () => void writers.delete(fn);
}
