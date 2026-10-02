import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '../shared/retention';
import { type Settings, type WebSettings, withDefaults } from '../shared/settings';
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
  if (s.voice.engine !== 'edge' && s.voice.engine !== 'kokoro') throw new Error('motor de voz inválido');
  if (!Number.isInteger(s.retention.days) || s.retention.days < RETENTION_MIN_DAYS || s.retention.days > RETENTION_MAX_DAYS) {
    throw new Error(`retenção: o prazo deve ficar entre ${RETENTION_MIN_DAYS} e ${RETENTION_MAX_DAYS} dias`);
  }
  return s;
}

export function validateWeb(w: WebSettings): WebSettings {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(w.host) && w.host !== 'localhost') throw new Error('acesso pelo navegador: o endereço deve ser um IPv4');
  if (!Number.isInteger(w.port) || w.port < 1024 || w.port > 65535) throw new Error('acesso pelo navegador: a porta deve ficar entre 1024 e 65535');
  if (!/^\/([\w.-]+\/)*$/.test(w.basePath) || /\.\./.test(w.basePath)) throw new Error('acesso pelo navegador: o caminho deve começar e terminar com /');
  let url: URL;
  try {
    url = new URL(w.publicUrl);
  } catch {
    throw new Error('acesso pelo navegador: URL pública inválida');
  }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error('acesso pelo navegador: a URL pública deve ser https');
  return { ...w, enabled: w.enabled === true, allowExternalEffects: w.allowExternalEffects === true };
}

function persist(s: Settings): Settings {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 2));
  renameSync(`${FILE}.tmp`, FILE);
  cached = s;
  return s;
}

// The web access fields never come from a regular save (the screen holds a stale copy; a browser client must not touch them).
export function saveSettings(next: Settings): Settings {
  return persist(validate(withDefaults({ ...next, web: getSettings().web })));
}

export function saveWebSettings(web: WebSettings): Settings {
  return persist({ ...getSettings(), web: validateWeb(web) });
}

