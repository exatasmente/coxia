import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applySettings, settingsFromConfig } from '../shared/config/settingsView';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '../shared/retention';
import { type Settings, type WebSettings, withDefaults } from '../shared/settings';
import { DATA_ROOT } from './env';
import { WEB_FILE } from './workspaces-core';
import { getConfig, onConfigChange, saveConfig } from './workspaceConfig';
import { t } from '../shared/i18n';

// Settings is the flat view of the workspace config (shared/config/settingsView.ts); browser access lives in the data root, shared by every workspace.
const WEB = join(DATA_ROOT, WEB_FILE);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODEL = /^\S{1,200}$/;

let cached: Settings | null = null;
onConfigChange(() => {
  cached = null;
});

function readJson(file: string): Record<string, unknown> | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readWeb(): WebSettings {
  return withDefaults({ web: readJson(WEB) ?? undefined } as Partial<Settings>).web;
}

export function getSettings(): Settings {
  cached ??= settingsFromConfig(getConfig(), readWeb());
  return cached;
}

function validate(s: Settings): Settings {
  for (const model of Object.values(s.models)) {
    if (!MODEL.test(model)) throw new Error(t('main.config.invalidModel', { model }));
  }
  for (const time of [s.schedule.preDaily, s.schedule.from, s.schedule.to, s.schedule.retroTime]) {
    if (!TIME.test(time)) throw new Error(t('main.config.invalidTime', { time }));
  }
  if (!(s.schedule.statusEveryMin >= 5 && s.schedule.statusEveryMin <= 240)) throw new Error(t('main.config.intervalRange'));
  if (!(s.voice.silenceMs >= 500 && s.voice.silenceMs <= 5000)) throw new Error(t('main.config.silenceRange'));
  if (s.voice.engine !== 'edge' && s.voice.engine !== 'kokoro') throw new Error(t('main.config.voiceEngine'));
  if (typeof s.voice.bargeIn !== 'boolean') throw new Error(t('main.config.bargeIn'));
  if (!Number.isInteger(s.retention.days) || s.retention.days < RETENTION_MIN_DAYS || s.retention.days > RETENTION_MAX_DAYS) {
    throw new Error(t('main.config.retentionRange', { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS }));
  }
  return s;
}

export function validateWeb(w: WebSettings): WebSettings {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(w.host) && w.host !== 'localhost') throw new Error(t('main.config.web.host'));
  if (!Number.isInteger(w.port) || w.port < 1024 || w.port > 65535) throw new Error(t('main.config.web.port'));
  if (!/^\/([\w.-]+\/)*$/.test(w.basePath) || /\.\./.test(w.basePath)) throw new Error(t('main.config.web.basePath'));
  let url: URL;
  try {
    url = new URL(w.publicUrl);
  } catch {
    throw new Error(t('main.config.web.publicUrl'));
  }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error(t('main.config.web.https'));
  const cidr = /^((\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/.exec(w.trustedProxy);
  if (!cidr || cidr[1].split('.').some((o) => Number(o) > 255) || Number(cidr[3]) > 32) throw new Error(t('main.config.web.proxy'));
  return { ...w, enabled: w.enabled === true, allowExternalEffects: w.allowExternalEffects === true };
}

function writeAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${file}.tmp`, file);
}

// The web access fields never come from a regular save (the screen holds a stale copy; a browser client must not touch them).
export function saveSettings(next: Settings): Settings {
  const checked = validate(withDefaults({ ...next, web: getSettings().web }));
  saveConfig(applySettings(getConfig(), checked));
  return getSettings();
}

export function saveWebSettings(web: WebSettings): Settings {
  writeAtomic(WEB, validateWeb(web));
  cached = null;
  return getSettings();
}
