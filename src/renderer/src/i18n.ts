import { useSyncExternalStore } from 'react';
import type { Language } from '../../shared/config/types';
import { i18nSnapshot, normalizeLanguage, setLanguage, setVoiceEnabled, subscribeLanguage, t, tv, voiceEnabled } from '../../shared/i18n';
import { api } from './api';

const KEY = 'cerimonias.language';
const VOICE_KEY = 'cerimonias.voice';

export { t, tv };

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

// The last language and voice mode come from localStorage so the first paint is already right; the workspace config confirms them.
export function initLanguage(): void {
  try {
    const last = localStorage.getItem(KEY);
    if (last) applyLanguage(normalizeLanguage(last));
    const voice = localStorage.getItem(VOICE_KEY);
    if (voice) setVoiceEnabled(voice === '1');
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
