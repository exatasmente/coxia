import { createElement, Fragment, type ReactNode, useSyncExternalStore } from 'react';
import type { Language } from '../../shared/config/types';
import { getLanguage, i18nSnapshot, intlLocale, normalizeLanguage, type Params, setLanguage, setTerms, setVoiceEnabled, subscribeLanguage, t, tv, voiceEnabled } from '../../shared/i18n';
import type { Terms } from '../../shared/i18n/terms';
import { api } from './api';

const KEY = 'cerimonias.language';
const VOICE_KEY = 'cerimonias.voice';
const TERMS_KEY = 'cerimonias.terms';

export { intlLocale, t, tv };

export function applyLanguage(language: Language): void {
  setLanguage(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // storage may be unavailable; the workspace config stays the source of truth
  }
}

/** Voice on or off: the wording ("call" or "conversa"/"chat") and every voice control follow it. */
export function applyVoiceMode(enabled: boolean): void {
  setVoiceEnabled(enabled);
  try {
    localStorage.setItem(VOICE_KEY, enabled ? '1' : '0');
  } catch {
    // storage may be unavailable; the workspace config stays the source of truth
  }
}

/** The workspace's terms (host name, change-request noun, ceremony name...): the texts of the screens are filled from them. */
export function applyTerms(terms: Terms): void {
  setTerms(terms);
  try {
    localStorage.setItem(TERMS_KEY, JSON.stringify({ language: getLanguage(), terms }));
  } catch {
    // storage may be unavailable; the cycle view confirms the terms on every load
  }
}

// The last language, voice mode and terms come from localStorage so the first paint is already right; the workspace config confirms them.
export function initLanguage(): void {
  try {
    const last = localStorage.getItem(KEY);
    if (last) applyLanguage(normalizeLanguage(last));
    const voice = localStorage.getItem(VOICE_KEY);
    if (voice) setVoiceEnabled(voice === '1');
    const cached = JSON.parse(localStorage.getItem(TERMS_KEY) ?? 'null') as { language?: string; terms?: Terms } | null;
    if (cached?.terms && cached.language === getLanguage()) setTerms(cached.terms);
  } catch {
    // keep the default
  }
  void api.getSettings().then(
    (s) => {
      applyLanguage(s.language);
      applyVoiceMode(s.voice.enabled);
    },
    () => undefined,
  );
}

/** Splits translated text on its `{name}` placeholders and puts the matching React node in each: a sentence with a <code> or a <button> inside. */
export function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/\{(\w+)\}/);
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 === 0 ? part : part in nodes ? createElement(Fragment, { key: i }, nodes[part]) : `{${part}}`)));
}

/** `t` for a sentence that holds elements: `tNodes('area.hint', { key: <kbd>F1</kbd> })` with "Press {key} to open". Plain params go in the third argument. */
export function tNodes(key: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode {
  return withNodes(t(key, params), nodes);
}

/** The voice-aware `tNodes`. */
export function tvNodes(key: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode {
  return withNodes(tv(key, params), nodes);
}

/** The translator, re-rendering the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLanguage, i18nSnapshot);
  return t;
}

/** The voice-aware translator, re-rendering the component when the language or the voice mode changes. */
export function useTv(): typeof tv {
  useSyncExternalStore(subscribeLanguage, i18nSnapshot);
  return tv;
}

/** Whether voice is on, re-rendering the component when it changes. */
export function useVoiceEnabled(): boolean {
  useSyncExternalStore(subscribeLanguage, i18nSnapshot);
  return voiceEnabled();
}
