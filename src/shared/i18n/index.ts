import type { Language } from '../config/types';
import en from './en.json';
import minutesEn from './minutes.en.json';
import minutesPtBR from './minutes.pt-BR.json';
import ptBR from './pt-BR.json';
import { defaultTerms, type Terms } from './terms';
import mainEn from './main.en.json';
import mainPtBR from './main.pt-BR.json';
import wizardEn from './wizard.en.json';
import { UI_EN, UI_PT_BR } from './ui';
import wizardPtBR from './wizard.pt-BR.json';

// A tiny translator, shared by the renderer and the main process: no dependency, flat dotted keys, {name} placeholders.
//   t('settings.title')                      -> "Configurações" / "Settings"
//   t('history.count', { count: 3 })         -> uses "history.count_one" / "history.count_other" when they exist (count === 1 picks _one)
// A key missing in the active language falls back to pt-BR (the source language); a key missing everywhere returns the key itself,
// so a gap is visible on screen and in `npm run i18n:lint`, never a crash.
// A placeholder the call does not pass is looked up in the workspace's terms (host name, change-request noun, ceremony name...): see ./terms.
// A key may also have a variant for the host (`key.on-github`), which wins over the plain key while the workspace uses that host.

export type Catalog = Record<string, string>;
export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/** Suffix of the variant a key has while voice is off: `call.enter` is the voice wording, `call.enter.novoice` the text one. */
export const NOVOICE_SUFFIX = '.novoice';

export const FALLBACK_LANGUAGE: Language = 'pt-BR';

// The setup wizard's and the minutes versions' strings live in their own files (wizard.*.json, minutes.*.json) so the catalogs other work
// adds to do not collide with them; the strings of the main process and the shared modules (errors, notifications, tray, health, files
// written for people, agent prompts added after the cycle templates) live in main.*.json, and the renderer's screens in the ui-*.json
// files gathered by ./ui.
export const CATALOGS: Record<Language, Catalog> = {
  'pt-BR': { ...ptBR, ...wizardPtBR, ...minutesPtBR, ...mainPtBR, ...UI_PT_BR },
  en: { ...en, ...wizardEn, ...minutesEn, ...mainEn, ...UI_EN },
};

export function normalizeLanguage(value: unknown): Language {
  if (value === 'pt-BR' || value === 'en') return value;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v.startsWith('pt')) return 'pt-BR';
    if (v.startsWith('en')) return 'en';
  }
  return FALLBACK_LANGUAGE;
}

// The workspace's terms, set next to the language by whoever loads the configuration. Until then: no integration, the app's own words.
let terms: Terms = defaultTerms('pt-BR');
let termsSet = false;
let termsVersion = 0;

/** Fills `{name}` placeholders: the call's params first, then the workspace's terms. An unknown placeholder stays, so a typo is visible. */
export function fillTemplate(template: string, params?: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : name in terms.words ? terms.words[name] : whole));
}

/** The suffix of a key's variant for a host kind: `vcs.card.ciFailed.on-github`. A dotted kind alone would collide with keys like `wizard.vcs.scopes.gitlab`. */
export const kindSuffix = (kind: string): string => `.on-${kind}`;

/** The host kind whose key variants are in force (null: none). */
export function termsKind(): string | null {
  return terms.kind;
}

/**
 * The catalog keys a text may be stored under, most specific first: with voice off the ".novoice" ones, and for each the host's variant
 * (".on-github") before the plain key.
 */
export function keyCandidates(key: string, voice: boolean, kind: string | null = termsKind()): string[] {
  const withKind = (k: string) => (kind ? [`${k}${kindSuffix(kind)}`, k] : [k]);
  return [...(voice ? [] : withKind(`${key}${NOVOICE_SUFFIX}`)), ...withKind(key)];
}

/** Voice-aware translator: with voice off it prefers `<key>.novoice` and falls back to the plain key (most strings are the same either way). */
export function createVoiceTranslator(language: Language, voice: boolean, catalogs: Record<Language, Catalog> = CATALOGS): Translate {
  const base = createTranslator(language, catalogs);
  if (voice) return base;
  const hasVariant = (key: string) => `${key}${NOVOICE_SUFFIX}` in (catalogs[language] ?? {}) || `${key}${NOVOICE_SUFFIX}` in (catalogs[FALLBACK_LANGUAGE] ?? {});
  return (key, params) => base(hasVariant(key) ? `${key}${NOVOICE_SUFFIX}` : key, params);
}

export function createTranslator(language: Language, catalogs: Record<Language, Catalog> = CATALOGS, kind: () => string | null = termsKind): Translate {
  const active = catalogs[language] ?? {};
  const base = catalogs[FALLBACK_LANGUAGE] ?? {};
  const find = (key: string, params?: Params): string | undefined => {
    const plural = params && typeof params.count === 'number' ? `${key}_${params.count === 1 ? 'one' : 'other'}` : null;
    return (plural && (active[plural] ?? base[plural])) ?? active[key] ?? base[key];
  };
  return (key, params) => {
    const k = kind();
    const template = (k ? find(`${key}${kindSuffix(k)}`, params) : undefined) ?? find(key, params);
    return template === undefined ? key : fillTemplate(template, params);
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
  // Terms nobody has set yet are the defaults of the language; set ones are the owner's to rebuild.
  if (!termsSet) terms = defaultTerms(language);
  rebuild();
}

/** The workspace's terms (host, change request, ceremony name...): call it after setLanguage whenever the configuration loads or changes. */
export function setTerms(next: Terms): void {
  if (termsSet && JSON.stringify(next) === JSON.stringify(terms)) return;
  terms = next;
  termsSet = true;
  termsVersion += 1;
  rebuild();
}

/** Back to the defaults of the language, as before any workspace set its terms. */
export function resetTerms(): void {
  termsSet = false;
  terms = defaultTerms(current);
  termsVersion += 1;
  rebuild();
}

export function getTerms(): Terms {
  return terms;
}

export function getLanguage(): Language {
  return current;
}

/** The BCP 47 tag Intl and toLocale*String use for the language in force: dates, times and numbers follow the workspace language. */
export function intlLocale(): string {
  return current === 'en' ? 'en-US' : 'pt-BR';
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

/**
 * A record whose values are translated each time they are read: for the tables of labels that used to be constants
 * (`LABEL[kind]` keeps working, in the language the process runs in at that moment).
 */
export function lazyLabels<K extends string>(keys: readonly K[], prefix: string): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) Object.defineProperty(out, key, { enumerable: true, get: () => t(`${prefix}.${key}`) });
  return out;
}

/** For useSyncExternalStore: re-render when the language, the voice mode or the workspace's terms change. */
export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot for useSyncExternalStore: changes whenever the language, the voice mode or the terms do. */
export function i18nSnapshot(): string {
  return `${current}|${voice ? 'voice' : 'novoice'}|${termsVersion}`;
}
