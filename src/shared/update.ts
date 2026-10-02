// What the "Atualizado para" toast and the quit-for-update flow exchange with the main process. The rest of the update
// machinery (settings, status, state machine) is in updates.ts.

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export interface UpdateInfo {
  build: BuildInfo;
  packaged: boolean;
  // What to announce once (the app was just updated: a commit after scripts/update.sh, a version after a published release), or null;
  // only while the window is visible.
  announce: string | null;
}

// The main process asks the window to save what it holds before the app quits for an update.
export const FLUSH_EVENT = 'update:flush';

// The window was shown (a start in the tray waits for it): the toast checks again.
export const SHOWN_EVENT = 'update:shown';

export function stripDirty(commit: string): string {
  return commit.replace(/\+dirty$/, '');
}
