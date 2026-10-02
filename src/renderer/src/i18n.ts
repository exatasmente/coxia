import { useSyncExternalStore } from 'react';
import type { Language } from '../../shared/config/types';
import { getLanguage, normalizeLanguage, setLanguage, subscribeLanguage, t } from '../../shared/i18n';
import { api } from './api';

const KEY = 'cerimonias.language';

export { t };

export function applyLanguage(language: Language): void {
  setLanguage(language);
  document.documentElement.lang = language;
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // storage may be unavailable; the workspace config stays the source of truth
  }
}

// The last language comes from localStorage so the first paint is already right; the workspace config confirms it.
export function initLanguage(): void {
  try {
    const last = localStorage.getItem(KEY);
    if (last) applyLanguage(normalizeLanguage(last));
  } catch {
    // keep the default
  }
  void api.getSettings().then((s) => applyLanguage(s.language), () => undefined);
}

/** The translator, re-rendering the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLanguage, getLanguage);
  return t;
}
