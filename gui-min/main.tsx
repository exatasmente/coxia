import { createRoot } from 'react-dom/client';
import { RunsScreen } from '../src/renderer/src/screens/cycle/RunsScreen';
import { initLanguage } from '../src/renderer/src/i18n';
import { initTheme } from '../src/renderer/src/theme';

initTheme();
initLanguage();
document.documentElement.lang = 'en';
document.documentElement.dataset.theme = 'light';

declare global {
  interface Window { __nav: { name: string; id?: string }[] }
}
window.__nav = [];

createRoot(document.getElementById('root')!).render(
  <RunsScreen go={(s) => { window.__nav.push({ name: s.name, id: (s as { id?: string }).id }); }} />,
);
