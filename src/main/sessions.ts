import { ATAS } from './env';
import { recordEntry, entryOf } from './sessions-core';

const noted = new Set<string>();

/**
 * Called by agents.run for every message that carries a session id; each id is written once per process. A call that continues an earlier session
 * (`resume`) does not record the id again: it would classify the session by the prompt of the round that continued it, and the id is already listed.
 */
export function noteSession(id: string | undefined, role: string, prompt: string, resumed = false): void {
  if (!id || resumed || noted.has(id)) return;
  noted.add(id);
  try {
    recordEntry(ATAS, entryOf(id, role, prompt));
  } catch (e) {
    console.error('[sessions] could not record the session', e instanceof Error ? e.message : String(e));
  }
}
