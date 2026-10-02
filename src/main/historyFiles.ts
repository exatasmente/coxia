import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedCeremony } from '../shared/types';
import { ATAS } from './env';

// One file per ceremony under historico/. Shared by the history, the minutes versions and the same-day context, which all read it.
export const HISTORY = join(ATAS, 'historico');
export const CEREMONY_ID = /^\d{4}-\d{2}-\d{2}T\d{6}$/;

export function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

export function readCeremony(id: string): SavedCeremony | null {
  if (!CEREMONY_ID.test(id)) return null;
  try {
    const state = JSON.parse(readFileSync(join(HISTORY, `${id}.json`), 'utf8')) as SavedCeremony;
    return state.version === 1 ? state : null;
  } catch {
    return null;
  }
}

/** Ceremony ids, newest first. */
export function ceremonyIds(): string[] {
  if (!existsSync(HISTORY)) return [];
  return readdirSync(HISTORY)
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => CEREMONY_ID.test(id))
    .sort()
    .reverse();
}

export const dateOfId = (id: string): string => id.slice(0, 10);

/** A call that started and has not ended: the minutes of it are still being made. Only today's can be live; an older one was abandoned. */
export function isLive(state: SavedCeremony | null): boolean {
  return !!state && state.startedAt !== null && !state.callEnded && dateOfId(state.id) === today();
}
