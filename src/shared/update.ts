// What Configurações → "Atualizar o app" and the "Atualizado para" toast exchange with the main process.

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export interface LatestCommit {
  commit: string;
  date: string;
  subject: string;
  // Commits on main that the installed build does not have; null when the installed commit is not in the tree.
  behind: number | null;
}

export interface UpdateInfo {
  build: BuildInfo;
  packaged: boolean;
  sourceDir: string;
  latest: LatestCommit | null;
  latestError: string | null;
  logPath: string;
  // Commit to announce once (the app was just updated by scripts/update.sh), or null; only while the window is visible.
  announce: string | null;
}

// The main process asks the window to save what it holds before the app quits for an update.
export const FLUSH_EVENT = 'update:flush';

// The window was shown (a start in the tray waits for it): the toast checks again.
export const SHOWN_EVENT = 'update:shown';

export function stripDirty(commit: string): string {
  return commit.replace(/\+dirty$/, '');
}

export type BuildState = 'current' | 'behind' | 'unknown';

export const updatedToast = (commit: string): string => `Atualizado para ${commit}`;

// `behind`: main has a commit the installed build lacks, or the build carries uncommitted changes.
export function buildState(installed: string, latest: LatestCommit | null): BuildState {
  if (!latest || !/^[0-9a-f]{4,40}\b/.test(installed)) return 'unknown';
  const hash = stripDirty(installed);
  const same = latest.commit.startsWith(hash) || hash.startsWith(latest.commit);
  return same && hash === installed ? 'current' : 'behind';
}
