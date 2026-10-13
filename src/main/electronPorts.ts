import { BrowserWindow, app, dialog, nativeImage, safeStorage } from 'electron';
import type { CryptoPort } from './secrets-core';
import { type HostPort, type PickRequest, setHostPort } from './host';
import { type PathsPort, setPathsPort } from './paths';
import type { NativeImageLike } from './screen/frame';
import { realEncoderEnv } from './screen/encoderWindow';
import { setCryptoPort } from './secrets';

// Where the desktop runtime meets what the rest of the code needs from it: the OS keychain behind stored secrets, the folders of the app,
// and what only the owner of the process does (version, exit, relaunch, file dialogs, the screen encoder). Everything else takes those
// from the ports, so this boundary stays in one place; index.ts and the encoder window are the only other files that import the runtime.

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

const parentWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** The native dialog for one pick, over the focused window when there is one. */
export async function pickWithDialog(request: PickRequest): Promise<string | null> {
  const win = parentWindow();
  const { title, defaultPath, filters } = request;
  if (request.mode === 'save') {
    const options = { title, ...(defaultPath ? { defaultPath } : {}), ...(filters ? { filters } : {}) };
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return picked.canceled || !picked.filePath ? null : picked.filePath;
  }
  const properties: ('openFile' | 'openDirectory' | 'createDirectory' | 'showHiddenFiles')[] =
    request.mode === 'open-dir' ? ['openDirectory', 'createDirectory'] : ['openFile', ...(request.showHidden ? (['showHiddenFiles'] as const) : [])];
  const options = { title, properties, ...(defaultPath ? { defaultPath } : {}), ...(filters ? { filters } : {}) };
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return picked.canceled ? null : (picked.filePaths[0] ?? null);
}

/** What the desktop gives the core: the OS keychain, the runtime's folders and the process it owns, each read at the time of use. */
export function electronPorts(): { secrets: CryptoPort; paths: PathsPort; host: HostPort } {
  return {
    secrets: keychain,
    paths: {
      isPackaged: () => app?.isPackaged ?? false,
      resources: () => process.resourcesPath,
      userData: () => app.getPath('userData'),
      appPath: () => app.getAppPath(),
    },
    host: {
      version: () => app.getVersion(),
      exit: (code) => app.exit(code),
      // A quit lets the windows and the before-quit hooks run; the exit is the fallback for one that hangs.
      restart: () => {
        app.relaunch();
        app.quit();
        setTimeout(() => app.exit(0), 5000).unref();
      },
      pick: pickWithDialog,
      screen: { nativeImage: nativeImage as unknown as NativeImageLike, encoderEnv: realEncoderEnv },
    },
  };
}

/** Fills the ports with what the desktop gives, for a caller that does not go through the core (a test of the ports). */
export function installElectronPorts(): void {
  const { secrets, paths, host } = electronPorts();
  setCryptoPort(secrets);
  setPathsPort(paths);
  setHostPort(host);
}
