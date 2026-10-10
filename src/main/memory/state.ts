import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_FILE, STATE_VERSION, type FolderState, type NoteState } from '../../shared/memory';

// The state file of an agent's folder: what the app decides about the notes beside it (who wrote each, whether the person took it over, whether it waits for review, the
// hash of the file as the app wrote it). Only the app writes it, atomically; nothing in a note can change what it says. One per agent and conversation, so two agents never
// share it. Synchronous on purpose: inside one process a read-compare-write cannot be interleaved, which is the serialisation a folder needs.

export type StateRead = { status: 'ok'; state: FolderState } | { status: 'newer'; v: number };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function entry(v: unknown): NoteState | null {
  if (!isObj(v)) return null;
  const { by, person, revision, reviewed, sha, at } = v;
  if (typeof by !== 'string' || typeof person !== 'boolean' || typeof reviewed !== 'boolean') return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
  if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha) || !isIso(at)) return null;
  return { by, person, revision, reviewed, sha, at };
}

/** A state file as a state. One that is not readable or not shaped like one is empty (every note beside it reads as foreign); one a newer app wrote is left alone. */
export function parseState(raw: string): StateRead {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { status: 'ok', state: { version: STATE_VERSION, notes: {} } };
  }
  if (isObj(json) && typeof json.version === 'number' && json.version > STATE_VERSION) return { status: 'newer', v: json.version };
  const notes: Record<string, NoteState> = {};
  if (isObj(json) && json.version === STATE_VERSION && isObj(json.notes)) {
    for (const [id, v] of Object.entries(json.notes)) {
      const e = entry(v);
      if (e) notes[id] = e;
    }
  }
  return { status: 'ok', state: { version: STATE_VERSION, notes } };
}

export interface StateFile {
  read(folder: string): StateRead;
  /** Writes the state, atomically. False when it could not be written (the file is as it was and no temporary file stays). */
  write(folder: string, state: FolderState): boolean;
}

/** The reader and writer of the state files; reads are cached by modification time and size, so a listing pays a `stat` per folder. */
export function createStateFile(move: (from: string, to: string) => void = renameSync): StateFile {
  const cache = new Map<string, { mtimeMs: number; size: number; read: StateRead }>();
  return {
    read(folder) {
      const path = join(folder, STATE_FILE);
      try {
        const st = statSync(path);
        const hit = cache.get(path);
        if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return structuredClone(hit.read);
        const read = parseState(readFileSync(path, 'utf8'));
        cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, read });
        // A copy: the caller edits what it reads, and a write that fails must not leave the edit in the cache.
        return structuredClone(read);
      } catch {
        cache.delete(path);
        return { status: 'ok', state: { version: STATE_VERSION, notes: {} } };
      }
    },
    write(folder, state) {
      const path = join(folder, STATE_FILE);
      const tmp = `${path}.tmp-${process.pid}`;
      try {
        if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
        writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
        move(tmp, path);
        cache.delete(path);
        return true;
      } catch {
        rmSync(tmp, { force: true });
        return false;
      }
    },
  };
}
