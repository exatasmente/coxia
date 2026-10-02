// What the update machinery exchanges between the main process and the window: settings, the status the screens render, and the
// pure state machine of a published-release update. No Electron and no Node here: the renderer and the tests import it as is.
import type { BuildInfo } from './update';

export const UPDATE_CHANNELS = ['stable', 'beta'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

// auto: decided from how the app was installed; release / source: the person forced one.
export const UPDATE_MODE_SETTINGS = ['auto', 'release', 'source'] as const;
export type UpdateModeSetting = (typeof UPDATE_MODE_SETTINGS)[number];

// release: published AppImage / installer, updated by electron-updater. source: built from a source tree by scripts/update.sh.
// package: installed from a .deb (the package manager updates it). dev: not packaged. none: nothing can update this install.
export type UpdateMode = 'release' | 'source' | 'package' | 'dev' | 'none';

export const INTERVAL_MIN_HOURS = 1;
export const INTERVAL_MAX_HOURS = 168;

export interface UpdateSettings {
  /** Check on start and every `intervalHours`. Off: only "Check now". */
  auto: boolean;
  channel: UpdateChannel;
  intervalHours: number;
  mode: UpdateModeSetting;
  /** Source mode: run `git fetch` in the source tree before comparing (off by default: the check stays read-only). */
  fetchSource: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { auto: true, channel: 'stable', intervalHours: 6, mode: 'auto', fetchSource: false };

export interface ModeInfo {
  mode: UpdateMode;
  /** Why this mode, as a catalog key suffix: `updates.reason.<reason>`. */
  reason: string;
  /** The app can replace itself (release mode on a platform and package type that support it). */
  selfUpdate: boolean;
  /** Windows and macOS updates only work for signed builds (documented in docs/updates.md); no signing is set up yet. */
  requiresSigning: boolean;
}

export type ReleasePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export interface ReleaseProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export type CheckResult = 'up-to-date' | 'available' | 'error';

export interface ReleaseState {
  phase: ReleasePhase;
  /** The version found (available, downloading, downloaded, installing). */
  version: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  /** Plain text, already stripped of markup and capped. */
  notes: string | null;
  progress: ReleaseProgress | null;
  /** The last error, kept while a downloaded update waits (it does not discard it). */
  error: string | null;
  lastCheckAt: number | null;
  lastResult: CheckResult | null;
}

export const initialReleaseState = (): ReleaseState => ({
  phase: 'idle',
  version: null,
  releaseName: null,
  releaseDate: null,
  notes: null,
  progress: null,
  error: null,
  lastCheckAt: null,
  lastResult: null,
});

export interface FoundRelease {
  version: string;
  releaseName: string | null;
  releaseDate: string | null;
  notes: string | null;
}

export type ReleaseEvent =
  | { type: 'check-start' }
  | { type: 'available'; release: FoundRelease; at: number }
  | { type: 'not-available'; at: number }
  | { type: 'progress'; progress: ReleaseProgress }
  | { type: 'downloaded'; release: FoundRelease }
  | { type: 'error'; message: string; at: number }
  | { type: 'install-start' }
  | { type: 'install-failed'; message: string };

const PENDING: readonly ReleasePhase[] = ['downloading', 'downloaded', 'installing'];

// A pending update (being downloaded, downloaded, installing) is never thrown away by a later check: only a newer version replaces it,
// and nothing replaces one that is installing.
export function reduceRelease(state: ReleaseState, event: ReleaseEvent): ReleaseState {
  const pending = PENDING.includes(state.phase);
  switch (event.type) {
    case 'check-start':
      return pending ? state : { ...state, phase: 'checking', error: null };
    case 'available': {
      const base = { ...state, lastCheckAt: event.at, lastResult: 'available' as const };
      if (state.phase === 'installing' || (pending && state.version === event.release.version)) return base;
      return { ...base, phase: 'available', error: null, progress: null, ...event.release };
    }
    case 'not-available':
      return { ...state, phase: pending ? state.phase : 'idle', lastCheckAt: event.at, lastResult: 'up-to-date', error: pending ? state.error : null };
    case 'progress':
      return state.phase === 'available' || state.phase === 'downloading' ? { ...state, phase: 'downloading', progress: event.progress } : state;
    case 'downloaded':
      return state.phase === 'installing' ? state : { ...state, phase: 'downloaded', progress: null, error: null, ...event.release };
    case 'error': {
      // A failed install, or a failed later check, leaves the downloaded update where it was; a failed download is an error.
      const phase = state.phase === 'installing' || state.phase === 'downloaded' ? 'downloaded' : 'error';
      return { ...state, phase, error: event.message, lastCheckAt: event.at, lastResult: 'error' };
    }
    case 'install-start':
      return state.phase === 'downloaded' ? { ...state, phase: 'installing', error: null } : state;
    case 'install-failed':
      return state.phase === 'installing' ? { ...state, phase: 'downloaded', error: event.message } : state;
  }
}

export type InstallDecision = 'install' | 'busy' | 'not-ready';

// Never restart for an update while a ceremony, a call or an agent job is running, unless the person confirmed it ("force").
export function installDecision(state: ReleaseState, busy: boolean, force: boolean): InstallDecision {
  if (state.phase !== 'downloaded') return 'not-ready';
  return busy && !force ? 'busy' : 'install';
}

export interface SourceCommit {
  commit: string;
  date: string;
  subject: string;
}

export type SourceError = 'no-dir' | 'not-a-repo' | 'no-main' | 'commit-unknown' | 'git-failed';

export interface SourceState {
  dir: string | null;
  /** The commit the installed build was made from (the `+dirty` mark stripped). */
  installed: string | null;
  /** Tip of the source tree's main. */
  head: string | null;
  /** Commits on main the installed build lacks; null when it could not be counted. */
  ahead: number | null;
  /** Newest first, capped (see MAX_SOURCE_COMMITS). */
  commits: SourceCommit[];
  /** Commits on origin/main the local main lacks (only known when the remote ref exists): informative, `git pull` is the person's call. */
  remoteAhead: number | null;
  fetched: boolean;
  fetchError: string | null;
  error: SourceError | null;
  errorDetail: string | null;
  checkedAt: number | null;
}

export const MAX_SOURCE_COMMITS = 50;

export const initialSourceState = (dir: string | null = null): SourceState => ({
  dir,
  installed: null,
  head: null,
  ahead: null,
  commits: [],
  remoteAhead: null,
  fetched: false,
  fetchError: null,
  error: null,
  errorDetail: null,
  checkedAt: null,
});

export interface UpdatesStatus {
  build: BuildInfo;
  platform: string;
  packaged: boolean;
  mode: ModeInfo;
  settings: UpdateSettings;
  release: ReleaseState;
  source: SourceState;
  /** A ceremony, a call or an agent job is running: no restart for an update without the person confirming. */
  busy: boolean;
  /** Something to apply or fetch: the "Atualização disponível" badge. */
  badge: boolean;
  /** The installed version is a pre-release and the channel is stable: an explicit downgrade check is offered. */
  canDowngrade: boolean;
  logPath: string;
}

// The window re-reads the status (update:status) when it gets this; the payload carries nothing (it also reaches paired browsers).
export const UPDATES_EVENT = 'update:changed';

export function hasUpdateBadge(mode: UpdateMode, release: ReleaseState, source: SourceState): boolean {
  if (mode === 'release') return release.phase === 'available' || release.phase === 'downloading' || release.phase === 'downloaded' || release.phase === 'installing';
  if (mode === 'source') return (source.ahead ?? 0) > 0;
  return false;
}

export function isPrerelease(version: string): boolean {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z]/.test(version);
}
