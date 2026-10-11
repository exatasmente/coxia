// Updates: a published build (AppImage, installer) updates itself with electron-updater; a build made from a source tree only learns that
// the tree's main has moved on, and the button runs scripts/update.sh (update.ts). Which one applies is decided by updates-core.detectMode.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { AppUpdater, ProgressInfo, UpdateInfo as FoundInfo } from 'electron-updater';
import { app } from 'electron';
import { t } from '../shared/i18n';
import {
  UPDATES_EVENT,
  hasUpdateBadge,
  initialReleaseState,
  initialSourceState,
  installDecision,
  isPrerelease,
  reduceRelease,
  type FoundRelease,
  type ModeInfo,
  type ReleaseEvent,
  type ReleaseState,
  type SourceState,
  type UpdateSettings,
  type UpdatesStatus,
} from '../shared/updates';
import { DATA_ROOT } from './env';
import { logError } from './errorlog';
import type { Module, ModuleContext } from './module';
import { isPackaged } from './paths';
import { updateEnv } from './update-core';
import { BUILD, sourceDir, sourceRecord, terminateChildren, updateLogPath, writeReleaseMarker } from './update';
import {
  RELAUNCH_SCRIPT,
  SOURCE_POLL_MS,
  applyUpdaterConfig,
  detectMode,
  feedProblem,
  focusCheckDue,
  nextCheckDelay,
  normalizeSettings,
  parseAppUpdateYml,
  relaunchArgs,
  releaseNotesText,
  settingsProblem,
  updaterConfig,
  type FeedConfig,
} from './updates-core';
import { readSourceState } from './updates-source';

const SETTINGS_FILE = join(DATA_ROOT, 'updates.json');
const EMIT_DELAY_MS = 250;
const SOURCE_FIRST_CHECK_MS = 4_000;

const requireModule = createRequire(import.meta.url);

let ctx: ModuleContext | null = null;
let settings: UpdateSettings = loadSettings();
let release: ReleaseState = initialReleaseState();
let source: SourceState = initialSourceState(sourceDir());
let busy = false;
let updater: AppUpdater | null = null;
let installedPath: string | null = null;
let emitTimer: NodeJS.Timeout | null = null;
let releaseTimer: NodeJS.Timeout | null = null;
let sourceTimer: NodeJS.Timeout | null = null;
let sourceChecking: Promise<void> | null = null;

// index.ts owns the window: it saves what the window holds before the app quits for an update.
interface Hooks {
  flush(): Promise<void>;
}
let hooks: Hooks = { flush: () => Promise.resolve() };

export function setUpdateHooks(next: Hooks): void {
  hooks = next;
}

// ---- settings ---------------------------------------------------------------------------------------------------------------------------

function loadSettings(): UpdateSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return normalizeSettings(null);
  }
}

function writeSettings(next: UpdateSettings): void {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(`${SETTINGS_FILE}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${SETTINGS_FILE}.tmp`, SETTINGS_FILE);
}

// ---- mode -----------------------------------------------------------------------------------------------------------------------------------

function readFeed(): FeedConfig | null {
  if (!isPackaged()) return null;
  try {
    return parseAppUpdateYml(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8'));
  } catch {
    return null;
  }
}

export function currentMode(): ModeInfo {
  const record = sourceRecord();
  return detectMode({
    packaged: isPackaged(),
    platform: process.platform,
    appImage: process.env.APPIMAGE,
    feed: readFeed(),
    source: record,
    sourceUsable: !!record && existsSync(join(record.source, '.git')),
    override: settings.mode,
  });
}

function status(): UpdatesStatus {
  const mode = currentMode();
  return {
    build: BUILD,
    platform: process.platform,
    packaged: isPackaged(),
    mode,
    settings,
    release,
    source,
    busy,
    badge: hasUpdateBadge(mode.mode, release, source),
    canDowngrade: mode.mode === 'release' && settings.channel === 'stable' && isPrerelease(BUILD.version),
    logPath: updateLogPath(),
  };
}

// Progress arrives many times a second: the window is told at most every EMIT_DELAY_MS, and the payload carries nothing (it also reaches paired browsers).
function changed(): void {
  if (!ctx || emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    try {
      ctx?.emit({ type: 'module', name: UPDATES_EVENT, payload: null });
    } catch {}
  }, EMIT_DELAY_MS);
  emitTimer.unref();
}

function dispatch(event: ReleaseEvent): void {
  release = reduceRelease(release, event);
  changed();
}

// ---- published releases (electron-updater) -------------------------------------------------------------------------------------

function found(info: FoundInfo): FoundRelease {
  return { version: info.version, releaseName: info.releaseName ?? null, releaseDate: info.releaseDate ?? null, notes: releaseNotesText(info.releaseNotes) };
}

const logger = {
  info: (m: unknown) => console.log('[updater]', m),
  warn: (m: unknown) => console.warn('[updater]', m),
  error: (m: unknown) => console.error('[updater]', m),
};

function getUpdater(): AppUpdater {
  if (updater) return updater;
  // Loaded only when a published build can update itself: touching it creates the updater for the platform.
  const u = (requireModule('electron-updater') as typeof import('electron-updater')).autoUpdater;
  u.logger = logger;
  // The signature of an AppImage is its sha512 from latest*.yml, checked over the downloaded file (and over every block of a
  // differential download); a web installer would skip part of that, so it is refused.
  u.disableWebInstaller = true;
  u.disableDifferentialDownload = false;
  applyUpdaterConfig(u, updaterConfig(settings.channel));
  u.on('checking-for-update', () => dispatch({ type: 'check-start' }));
  u.on('update-available', (info) => dispatch({ type: 'available', release: found(info), at: Date.now() }));
  u.on('update-not-available', () => dispatch({ type: 'not-available', at: Date.now() }));
  u.on('download-progress', (p: ProgressInfo) =>
    dispatch({ type: 'progress', progress: { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond } }),
  );
  u.on('update-downloaded', (e) => {
    dispatch({ type: 'downloaded', release: found(e) });
    writeReleaseMarker(e.version);
  });
  u.on('appimage-filename-updated', (path) => {
    installedPath = path;
  });
  u.on('error', (err) => {
    const message = (err?.message ?? String(err)).split('\n')[0];
    logError('update:release', err);
    dispatch({ type: 'error', message, at: Date.now() });
  });
  updater = u;
  return u;
}

export async function checkRelease(allowDowngrade = false): Promise<void> {
  if (currentMode().mode !== 'release') return;
  const u = getUpdater();
  applyUpdaterConfig(u, updaterConfig(settings.channel, allowDowngrade));
  try {
    if ((await u.checkForUpdates()) === null) dispatch({ type: 'error', message: t('updates.error.inactive'), at: Date.now() });
  } catch (e) {
    // The error event has recorded it; this only covers a failure that came without one.
    if (release.phase === 'checking') dispatch({ type: 'error', message: (e as Error).message.split('\n')[0], at: Date.now() });
  } finally {
    // A downgrade is allowed for that one check, never as a standing setting.
    if (allowDowngrade) applyUpdaterConfig(u, updaterConfig(settings.channel));
  }
}

export interface InstallResult {
  ok: boolean;
  reason?: 'busy' | 'not-ready' | 'not-release' | 'failed';
}

function relaunchWhenGone(appImage: string): void {
  const env = updateEnv(process.env);
  // The detached helper outlives this process: it waits for it to exit, then starts the installed AppImage with the same arguments.
  spawn('setsid', ['-f', 'bash', '-c', RELAUNCH_SCRIPT, 'relaunch', String(process.pid), appImage, ...relaunchArgs(process.argv)], { stdio: 'ignore', env }).unref();
}

// "Reiniciar para atualizar": save the window, install the downloaded file in place of the AppImage, quit, and start the new one once this
// process is gone. Not while a ceremony, a call or a job is running, unless the person said to go ahead (force).
export async function installRelease(force: boolean): Promise<InstallResult> {
  if (currentMode().mode !== 'release' || !updater) return { ok: false, reason: 'not-release' };
  const decision = installDecision(release, busy, force);
  if (decision !== 'install') return { ok: false, reason: decision };
  dispatch({ type: 'install-start' });
  await hooks.flush();
  const u = updater;
  // Linux relaunches itself below: the installer would start the new AppImage while this one still holds the single-instance lock.
  u.quitAndInstall(true, process.platform !== 'linux');
  if (release.phase !== 'installing') return { ok: false, reason: 'failed' };
  const target = installedPath ?? process.env.APPIMAGE;
  if (process.platform === 'linux' && target) relaunchWhenGone(target);
  console.log(`[update] stopped ${terminateChildren()} child process(es)`);
  setTimeout(() => app.exit(0), 8000).unref();
  return { ok: true };
}

// A normal quit installs a downloaded update (electron-updater does it at exit), except while something is running: that quit is
// then just a quit, and the update waits for the next one.
export function beforeQuit(): void {
  if (updater) updater.autoInstallOnAppQuit = !busy;
}

// ---- source installs ------------------------------------------------------------------------------------------------------------------------

export async function checkSource(): Promise<void> {
  if (currentMode().mode !== 'source') return;
  sourceChecking ??= (async () => {
    try {
      source = await readSourceState(sourceDir(), BUILD.commit, { fetch: settings.fetchSource });
    } catch (e) {
      logError('update:source', e);
    } finally {
      sourceChecking = null;
      changed();
    }
  })();
  await sourceChecking;
}

// A window coming back to the front is a good moment to look again, as long as it does not turn into a check per click.
export function onWindowFocus(): void {
  if (!settings.auto || currentMode().mode !== 'source') return;
  if (focusCheckDue(source.checkedAt, Date.now())) void checkSource();
}

// ---- schedule -------------------------------------------------------------------------------------------------------------------------------

function schedule(): void {
  if (releaseTimer) clearTimeout(releaseTimer);
  if (sourceTimer) clearInterval(sourceTimer);
  releaseTimer = sourceTimer = null;
  const mode = currentMode().mode;
  if (!settings.auto) return;
  if (mode === 'release') {
    const arm = (): void => {
      releaseTimer = setTimeout(() => {
        void checkRelease().finally(arm);
      }, nextCheckDelay(release.lastCheckAt, Date.now(), settings.intervalHours));
      releaseTimer.unref();
    };
    arm();
  } else if (mode === 'source') {
    const first = setTimeout(() => void checkSource(), SOURCE_FIRST_CHECK_MS);
    first.unref();
    sourceTimer = setInterval(() => void checkSource(), SOURCE_POLL_MS);
    sourceTimer.unref();
  }
}

// ---- the module -----------------------------------------------------------------------------------------------------------------------------

const asBool = (v: unknown): boolean => v === true;

export const updates: Module = (context) => {
  ctx = context;
  context.handle('update:status', () => status());
  context.handle('update:check', async (opts?: { allowDowngrade?: boolean }) => {
    const mode = currentMode().mode;
    if (mode === 'release') await checkRelease(asBool(opts?.allowDowngrade));
    else if (mode === 'source') await checkSource();
    return status();
  });
  context.handle('update:settings-save', (next: unknown) => {
    const problem = settingsProblem(next);
    if (problem) throw new Error(t(problem));
    const before = settings;
    settings = normalizeSettings(next);
    writeSettings(settings);
    if (updater) applyUpdaterConfig(updater, updaterConfig(settings.channel));
    schedule();
    // A new channel, mode or fetch choice answers right away instead of at the next tick.
    if (settings.channel !== before.channel || settings.mode !== before.mode || settings.fetchSource !== before.fetchSource) {
      const mode = currentMode().mode;
      if (mode === 'release') void checkRelease();
      else if (mode === 'source') void checkSource();
    }
    changed();
    return status();
  });
  context.handle('update:install', (opts?: { force?: boolean }) => installRelease(asBool(opts?.force)));
  context.handle('update:busy', (value: unknown) => {
    busy = asBool(value);
  });
  schedule();
};
