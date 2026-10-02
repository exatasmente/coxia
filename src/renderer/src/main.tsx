import './webApi';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { unlockAudio } from './audio';
import { isWeb } from './platform';
import { initTheme } from './theme';
import { WebGate } from './WebGate';

initTheme();

// Mobile browsers keep the AudioContext suspended until a gesture.
if (isWeb()) {
  // not once: iOS suspends the context again when the app goes to the background
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// No context menu anywhere in the app.
window.addEventListener('contextmenu', (e) => e.preventDefault());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <WebGate>
      <App />
    </WebGate>
  </StrictMode>,
);
