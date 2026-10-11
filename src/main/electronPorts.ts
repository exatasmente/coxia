import { app, safeStorage } from 'electron';
import type { CryptoPort } from './secrets-core';
import { setPathsPort } from './paths';
import { setCryptoPort } from './secrets';

// The only file that reaches the desktop runtime for what the rest of the code needs from it: the OS keychain behind stored secrets and
// the folders of the app. Everything else takes those from the ports, so this boundary stays in one place and one import.

// Electron's safeStorage encrypts with the OS keychain (libsecret / kwallet on Linux, Keychain on macOS, DPAPI on Windows).
// On Linux without a keyring it silently falls back to a hard-coded key ("basic_text"): that is not protection, so it counts as unavailable.
export const keychain: CryptoPort = {
  available: () => {
    try {
      if (!safeStorage?.isEncryptionAvailable()) return false;
      const backend = safeStorage.getSelectedStorageBackend?.();
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data),
  backend: () => {
    try {
      return safeStorage.getSelectedStorageBackend?.() ?? null;
    } catch {
      return null;
    }
  },
};

/** Fills both ports with what the desktop uses today: the OS keychain and the runtime's folders, each read at the time of use. */
export function installElectronPorts(): void {
  setCryptoPort(keychain);
  setPathsPort({
    isPackaged: () => app?.isPackaged ?? false,
    resources: () => process.resourcesPath,
    userData: () => app.getPath('userData'),
  });
}