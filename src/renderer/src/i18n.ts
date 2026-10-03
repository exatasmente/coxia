import { createElement, Fragment, type ReactNode, useSyncExternalStore } from 'react';
import type { Language } from '../../shared/config/types';
import { getLanguage, i18nSnapshot, intlLocale, normalizeLanguage, type Params, resetTerms, setLanguage, setTerms, setVoiceEnabled, subscribeLanguage, t, tv, voiceEnabled } from '../../shared/i18n';
import { createTermsLoader } from '../../shared/i18n/termsCache';
import type { Terms } from '../../shared/i18n/terms';
import type { WorkspacesView } from '../../shared/workspaces';
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

// The terms of the first moments: the cache of this workspace and language (storage may be unavailable), the workspace's own view, the defaults
// when the view cannot be loaded. See createTermsLoader.
const termsLoader = createTermsLoader({
  read: () => {
    try {
      return localStorage.getItem(TERMS_KEY);
    } catch {
      return null;
    }
  },
  write: (text) => {
    try {
      localStorage.setItem(TERMS_KEY, text);
    } catch {
      // storage may be unavailable; the cycle view confirms the terms on every load
    }
  },
  setTerms,
  resetTerms,
  getLanguage,
});

/** The workspace's terms (host name, change-request noun, ceremony name...) from its cycle view: the texts of the screens are filled from them. */
export function applyTerms(terms: Terms, workspaceId: string | null): void {
  termsLoader.fromView(terms, workspaceId);
}

/** The cycle view could not be loaded: until it is, the words are the defaults and not whatever a cache held. */
export function termsViewFailed(): void {
  termsLoader.viewFailed();
}

// The last language and voice mode come from localStorage so the first paint is already right; the workspace config confirms them. The terms
// follow once the running workspace is known.
export function initLanguage(): void {
  try {
    const last = localStorage.getItem(KEY);
    if (last) applyLanguage(normalizeLanguage(last));
    const voice = localStorage.getItem(VOICE_KEY);
    if (voice) setVoiceEnabled(voice === '1');
  } catch {
    // keep the default
  }
  // The cached terms belong to a workspace: they are used once the running one is known.
  void api.invoke<WorkspacesView>('workspace:list').then((v) => termsLoader.workspaceKnown(v.running), () => undefined);
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
