import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedCeremony } from '../shared/types';
import { ATAS } from './env';

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function file(): string {
  return join(ATAS, `estado-${today()}.json`);
}

export function loadState(): SavedCeremony | null {
  if (!existsSync(file())) return null;
  try {
    const state = JSON.parse(readFileSync(file(), 'utf8')) as SavedCeremony;
    return state.version === 1 && state.date === today() ? state : null;
  } catch {
    return null;
  }
}

export function saveState(state: SavedCeremony): void {
  mkdirSync(ATAS, { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, date: today() }));
  renameSync(tmp, file());
}
