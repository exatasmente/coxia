import type { Language } from '../config/types';
import en from './en.json';
import ptBR from './pt-BR.json';
import mainEn from './main.en.json';
import mainPtBR from './main.pt-BR.json';
import wizardEn from './wizard.en.json';
import wizardPtBR from './wizard.pt-BR.json';

// A tiny translator, shared by the renderer and the main process: no dependency, flat dotted keys, {name} placeholders.
//   t('settings.title')                      -> "Configurações" / "Settings"
//   t('history.count', { count: 3 })         -> uses "history.count_one" / "history.count_other" when they exist (count === 1 picks _one)
// A key missing in the active language falls back to pt-BR (the source language); a key missing everywhere returns the key itself,
// so a gap is visible on screen and in `npm run i18n:lint`, never a crash.

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/** Suffix of the variant a key has while voice is off: `call.enter` is the voice wording, `call.enter.novoice` the text one. */
export const NOVOICE_SUFFIX = '.novoice';

export const FALLBACK_LANGUAGE: Language = 'pt-BR';

// The setup wizard's strings live in their own files (wizard.*.json) so the catalogs other work adds to do not collide with them; the
// strings of the main process and the shared modules (errors, notifications, tray, health, files written for people, agent prompts added
// after the cycle templates) live in main.*.json.
export const CATALOGS: Record<Language, Catalog> = { 'pt-BR': { ...ptBR, ...wizardPtBR, ...mainPtBR }, en: { ...en, ...wizardEn, ...mainEn } };

export function normalizeLanguage(value: unknown): Language {
  if (value === 'pt-BR' || value === 'en') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v.startsWith('pt')) return 'pt-BR';
    if (v.startsWith('en')) return 'en';
  }
  return FALLBACK_LANGUAGE;
}

function format(template: string, params?: Params): string {
  return params ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : template;
}

/** Voice-aware translator: with voice off it prefers `<key>.novoice` and falls back to the plain key (most strings are the same either way). */
export function createVoiceTranslator(language: Language, voice: boolean, catalogs: Record<Language, Catalog> = CATALOGS): Translate {
  const base = createTranslator(language, catalogs);
  if (voice) return base;
  const hasVariant = (key: string) => `${key}${NOVOICE_SUFFIX}` in (catalogs[language] ?? {}) || `${key}${NOVOICE_SUFFIX}` in (catalogs[FALLBACK_LANGUAGE] ?? {});
  return (key, params) => base(hasVariant(key) ? `${key}${NOVOICE_SUFFIX}` : key, params);
}

export function createTranslator(language: Language, catalogs: Record<Language, Catalog> = CATALOGS): Translate {
  const active = catalogs[language] ?? {};
  const base = catalogs[FALLBACK_LANGUAGE] ?? {};
  return (key, params) => {
    const plural = params && typeof params.count === 'number' ? `${key}_${params.count === 1 ? 'one' : 'other'}` : null;
    const template = (plural && (active[plural] ?? base[plural])) ?? active[key] ?? base[key];
    return template === undefined ? key : format(template, params);
  };
}

// The language (and whether voice is on) the running process uses. The renderer sets them from the workspace config at start and when
// they change; the main process sets them from the config it loaded. Voice starts on: the wording the app always had.
let current: Language = FALLBACK_LANGUAGE;
let voice = true;
let translate: Translate = createTranslator(current);
let voiceTranslate: Translate = createVoiceTranslator(current, voice);
const listeners = new Set<() => void>();

function rebuild(): void {
  translate = createTranslator(current);
  voiceTranslate = createVoiceTranslator(current, voice);
  for (const fn of listeners) fn();
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  rebuild();
}

export function getLanguage(): Language {
  return current;
}

/** Voice on or off: `tv` follows it. */
export function setVoiceEnabled(on: boolean): void {
  if (on === voice) return;
  voice = on;
  rebuild();
}

export function voiceEnabled(): boolean {
  return voice;
}

export const t: Translate = (key, params) => translate(key, params);

/** Translate a string that says "call" while voice is on and "conversa"/"chat" while it is off (key + `.novoice`). */
export const tv: Translate = (key, params) => voiceTranslate(key, params);

/** For useSyncExternalStore: re-render when the language or the voice mode changes. */
export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot for useSyncExternalStore: changes whenever the language or the voice mode does. */
export function i18nSnapshot(): string {
  return `${current}|${voice ? 'voice' : 'novoice'}`;
}
