import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StopDoor } from '../../shared/personaStop';

// The latch of the stop (#248): whether the persona may act, kept in a small file in the workspace's folder and not in the configuration, so the settings tool cannot reach it,
// an older app opens the workspace as before and the schema does not move. Read once, when the module first needs it; after that the memory is the truth, so deleting the file
// while the app runs does not resume the persona. A file that is there and cannot be read counts as stopped: a stop that fails open is no stop.

export const LATCH_FILE = 'persona-latch.json';
const LATCH_VERSION = 1;

export interface LatchState {
  stopped: boolean;
  since: string | null;
  door: StopDoor | null;
}

const RUNNING: LatchState = { stopped: false, since: null, door: null };
const UNREADABLE: LatchState = { stopped: true, since: null, door: null };

/** The state in a file: none (absent) means the persona may act; anything the app cannot read with certainty means it may not. */
export function readLatch(file: string): LatchState {
  if (!existsSync(file)) return RUNNING;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return UNREADABLE;
    const o = raw as Record<string, unknown>;
    if (o.v !== LATCH_VERSION || typeof o.stopped !== 'boolean') return UNREADABLE;
    return { stopped: o.stopped, since: typeof o.since === 'string' ? o.since : null, door: typeof o.door === 'string' ? o.door : null };
  } catch {
    return UNREADABLE;
  }
}

/** Temporary file and rename, so a crash never leaves half a latch (which would read as stopped, but should not have to). */
function writeLatch(file: string, state: LatchState): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: LATCH_VERSION, ...state })}\n`);
  renameSync(temp, file);
}

export interface Latch {
  state(): LatchState;
  stopped(): boolean;
  /** Sets the latch in memory first and then on disk; a failing disk keeps the memory (a stop is never lost to a full disk) and says so. */
  set(stopped: boolean, door: StopDoor, now?: Date): LatchState;
}

export function createLatch(file: string): Latch {
  let current = readLatch(file);
  return {
    state: () => current,
    stopped: () => current.stopped,
    set(stopped, door, now = new Date()) {
      current = stopped ? { stopped: true, since: now.toISOString(), door } : { stopped: false, since: null, door };
      try {
        writeLatch(file, current);
      } catch (e) {
        console.error('[persona] could not write the latch', e instanceof Error ? e.message : e);
      }
      return current;
    },
  };
}
