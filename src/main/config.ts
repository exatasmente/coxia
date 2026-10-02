import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Settings, withDefaults } from '../shared/settings';
import { ATAS } from './env';

const FILE = join(ATAS, 'config.json');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODEL = /^[\w.-]+\/[\w.:-]+$/;

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = withDefaults(existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null);
  } catch {
    cached = withDefaults(null);
  }
  return cached;
}

function validate(s: Settings): Settings {
  for (const model of Object.values(s.models)) {
    if (!MODEL.test(model)) throw new Error(`modelo inválido: ${model}`);
  }
  for (const t of [s.schedule.preDaily, s.schedule.from, s.schedule.to, s.schedule.retroTime]) {
    if (!TIME.test(t)) throw new Error(`horário inválido: ${t}`);
  }
  if (!(s.schedule.statusEveryMin >= 5 && s.schedule.statusEveryMin <= 240)) throw new Error('intervalo deve ficar entre 5 e 240 minutos');
  if (!(s.voice.silenceMs >= 500 && s.voice.silenceMs <= 5000)) throw new Error('silêncio deve ficar entre 500 e 5000 ms');
  return s;
}

export function saveSettings(next: Settings): Settings {
  const s = validate(withDefaults(next));
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
  cached = s;
  return s;
}

