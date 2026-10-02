import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMinutes } from '../shared/minutes';
import type { HistoryEntry, SavedCeremony } from '../shared/types';
import { ATAS } from './env';

// One file per ceremony; the newest one of the day is the one the app resumes.
const HISTORY = join(ATAS, 'historico');
const ID = /^\d{4}-\d{2}-\d{2}T\d{6}$/;

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function read(id: string): SavedCeremony | null {
  if (!ID.test(id)) return null;
  try {
    const state = JSON.parse(readFileSync(join(HISTORY, `${id}.json`), 'utf8')) as SavedCeremony;
    return state.version === 1 ? state : null;
  } catch {
    return null;
  }
}

function ids(): string[] {
  if (!existsSync(HISTORY)) return [];
  return readdirSync(HISTORY)
    .map((f) => f.replace(/\.json$/, ''))
    .filter((id) => ID.test(id))
    .sort()
    .reverse();
}

export function loadState(): SavedCeremony | null {
  const latest = ids().find((id) => id.startsWith(today()));
  return latest ? read(latest) : null;
}

export function saveState(state: SavedCeremony): void {
  if (!ID.test(state.id)) throw new Error(`invalid ceremony id ${state.id}`);
  mkdirSync(HISTORY, { recursive: true });
  const file = join(HISTORY, `${state.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...state, date: state.id.slice(0, 10) }));
  renameSync(`${file}.tmp`, file);
}

export function listHistory(): HistoryEntry[] {
  return ids().flatMap((id) => {
    const s = read(id);
    if (!s) return [];
    const m = buildMinutes(s);
    return [
      {
        id,
        kind: s.kind,
        date: s.date,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activities: s.cards?.cards.length ?? 0,
        decisions: m.decisions.length,
        effects: m.effects.length,
        unanswered: m.unanswered.length,
        deepDives: Object.values(s.deep).filter((d) => d.msgs.length).length,
        ataSaved: !!s.saveResult,
      },
    ];
  });
}

export function getHistory(id: string): SavedCeremony | null {
  return read(id);
}
