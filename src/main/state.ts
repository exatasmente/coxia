import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMinutes } from '../shared/minutes';
import type { HistoryEntry, SavedCeremony } from '../shared/types';
import { CEREMONY_ID, HISTORY, ceremonyIds, isLive, readCeremony, today } from './historyFiles';
import { registerCeremony, trashedCeremonyIds, versionOfCeremony } from './minutesStore';

// One file per ceremony; the newest one of the day is the one the app resumes.
export function loadState(): SavedCeremony | null {
  const latest = ceremonyIds().find((id) => id.startsWith(today()));
  return latest ? readCeremony(latest) : null;
}

export function saveState(state: SavedCeremony): void {
  // i18n-ignore: developer error
  if (!CEREMONY_ID.test(state.id)) throw new Error(`invalid ceremony id ${state.id}`);
  // Deleted from the history while a window still held it: the stale save does not bring it back (Restore does).
  if (trashedCeremonyIds().has(state.id)) return;
  mkdirSync(HISTORY, { recursive: true });
  const file = join(HISTORY, `${state.id}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...state, date: state.id.slice(0, 10) }));
  renameSync(`${file}.tmp`, file);
  registerCeremony(state);
}

export function listHistory(): HistoryEntry[] {
  return ceremonyIds().flatMap((id) => {
    const s = readCeremony(id);
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
        version: versionOfCeremony(id),
        live: isLive(s),
      },
    ];
  });
}

export function getHistory(id: string): SavedCeremony | null {
  return readCeremony(id);
}
