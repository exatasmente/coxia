import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentDef, EngineId } from '../../shared/config/types';

// The engine session each conversation of the persona continues (#279), kept in a small file in the workspace's folder beside the latch and not in the configuration: an older
// app ignores it, the schema does not move, and a conversation goes on in the same session after a restart. Whatever cannot be read is no session at all, so the next answer
// opens a new one, as before; nothing here ever fails an answer. The file holds session ids only, which never go to a log or a thread.

export const SESSIONS_FILE = 'persona-sessions.json';
const SESSIONS_VERSION = 1;

/** The session a conversation continues: the engine and provider that hold it, and the last message (`seq`) it already knows. */
export interface SessionEntry {
  session: string;
  engine: EngineId;
  provider: string;
  upTo: number;
}

const entryOf = (raw: unknown): SessionEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.session !== 'string' || !o.session || (o.engine !== 'claude-sdk' && o.engine !== 'open') || typeof o.provider !== 'string' || typeof o.upTo !== 'number' || !Number.isInteger(o.upTo)) return null;
  return { session: o.session, engine: o.engine, provider: o.provider, upTo: o.upTo };
};

/** The sessions in a file, by conversation: none when it is absent, unreadable or of another version; an entry that does not read is left out alone. */
export function readSessions(file: string): Map<string, SessionEntry> {
  const out = new Map<string, SessionEntry>();
  if (!existsSync(file)) return out;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return out;
    const o = raw as Record<string, unknown>;
    if (o.v !== SESSIONS_VERSION || !o.threads || typeof o.threads !== 'object') return out;
    for (const [thread, value] of Object.entries(o.threads as Record<string, unknown>)) {
      const entry = entryOf(value);
      if (entry) out.set(thread, entry);
    }
  } catch {
    // An unreadable file keeps no session: the next answer opens a new one.
  }
  return out;
}

/** Temporary file and rename, so a crash never leaves half a file. */
function writeSessions(file: string, all: Map<string, SessionEntry>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: SESSIONS_VERSION, threads: Object.fromEntries(all) })}\n`);
  renameSync(temp, file);
}

export interface SessionKeep {
  get(thread: string): SessionEntry | null;
  /** Keeps the session in memory and then on disk; a failing disk keeps the memory and says so in the app's log, never in the thread. */
  set(thread: string, entry: SessionEntry): void;
  clear(thread: string): void;
}

/** What an answer of the persona needs to continue its conversation's session: where it is kept, and the engine and provider the persona would start on now. */
export interface PersonaSessions {
  keep: SessionKeep;
  target: (agent: AgentDef) => { engine: EngineId; provider: string };
}

/** The sessions of one file, read the first time anything asks. */
export function createSessionKeep(file: string): SessionKeep {
  let all: Map<string, SessionEntry> | null = null;
  const loaded = (): Map<string, SessionEntry> => (all ??= readSessions(file));
  const save = (): void => {
    try {
      writeSessions(file, loaded());
    } catch (e) {
      console.error('[persona] could not write the sessions', e instanceof Error ? e.message : e);
    }
  };
  return {
    get: (thread) => loaded().get(thread) ?? null,
    set(thread, entry) {
      loaded().set(thread, { ...entry });
      save();
    },
    clear(thread) {
      if (loaded().delete(thread)) save();
    },
  };
}
