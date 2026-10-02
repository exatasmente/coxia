import { type Theme, THEMES } from '../../shared/settings';
import { api } from './api';

const KEY = 'cerimonias.theme';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage may be unavailable; the setting file stays the source of truth
  }
}

// The last theme comes from localStorage so the first paint is already right; the settings file confirms it.
export function initTheme(): void {
  try {
    const last = localStorage.getItem(KEY) as Theme | null;
    if (last && THEMES.includes(last)) document.documentElement.dataset.theme = last;
  } catch {
    // keep the CSS default (follows the system)
  }
  void api.getSettings().then((s) => applyTheme(s.appearance.theme), () => undefined);
}
