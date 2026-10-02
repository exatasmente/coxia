import type { Language } from '../config/types';
import en from './en.json';
import ptBR from './pt-BR.json';

// A tiny translator, shared by the renderer and the main process: no dependency, flat dotted keys, {name} placeholders.
//   t('settings.title')                      -> "Configurações" / "Settings"
//   t('history.count', { count: 3 })         -> uses "history.count_one" / "history.count_other" when they exist (count === 1 picks _one)
// A key missing in the active language falls back to pt-BR (the source language); a key missing everywhere returns the key itself,
// so a gap is visible on screen and in `npm run i18n:lint`, never a crash.

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

export const FALLBACK_LANGUAGE: Language = 'pt-BR';

export const CATALOGS: Record<Language, Catalog> = { 'pt-BR': ptBR, en };

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

export function createTranslator(language: Language, catalogs: Record<Language, Catalog> = CATALOGS): Translate {
  const active = catalogs[language] ?? {};
  const base = catalogs[FALLBACK_LANGUAGE] ?? {};
  return (key, params) => {
    const plural = params && typeof params.count === 'number' ? `${key}_${params.count === 1 ? 'one' : 'other'}` : null;
    const template = (plural && (active[plural] ?? base[plural])) ?? active[key] ?? base[key];
    return template === undefined ? key : format(template, params);
  };
}

// The language the running process uses. The renderer sets it from the workspace config at start and when the setting changes;
// the main process sets it from the config it loaded.
let current: Language = FALLBACK_LANGUAGE;
let translate: Translate = createTranslator(current);
const listeners = new Set<() => void>();

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  translate = createTranslator(language);
  for (const fn of listeners) fn();
}

export function getLanguage(): Language {
  return current;
}

export const t: Translate = (key, params) => translate(key, params);

/** For useSyncExternalStore: re-render when the language changes. */
export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
