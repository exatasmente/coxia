import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { AppEvent } from '../shared/types';
import { t } from '../shared/i18n';
import { FLUSH_EVENT, type BuildInfo, type UpdateInfo } from '../shared/update';
import { DATA_ROOT, HOME } from './env';
import type { Module } from './module';
import { PACKAGED } from './paths';
import {
  announcement,
  ownedDescendants,
  parseStat,
  parseUpdatedMarker,
  readBuild,
  type Proc,
  runInfo,
  stateDir,
  updateEnv,
  updateLogName,
  updatedMarkerName,
} from './update-core';
import { parseSourceRecord, releaseMarker, sourceRecordPath, type SourceRecord } from './updates-core';

const exec = promisify(execFile);

declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const BUILD: BuildInfo = readBuild(
  app.getVersion(),
  typeof __BUILD_COMMIT__ === 'undefined' ? undefined : __BUILD_COMMIT__,
  typeof __BUILD_DATE__ === 'undefined' ? undefined : __BUILD_DATE__,
);

const STATE = stateDir(process.env, HOME);
const LOG = join(STATE, updateLogName);
const MARKER = join(STATE, updatedMarkerName);
// The running instance reports itself here; scripts/update.sh reads it to say what is installed now.
const RUN_FILE = join(DATA_ROOT, 'run.json');

export const updateLogPath = (): string => LOG;

// scripts/install-local.sh records which source tree the installed AppImage came from; CERIMONIAS_SOURCE_DIR overrides it (tests, unusual layouts).
export function sourceRecord(): SourceRecord | null {
  const fromEnv = process.env.CERIMONIAS_SOURCE_DIR;
  if (fromEnv) return { source: fromEnv, appImage: null };
  try {
    return parseSourceRecord(readFileSync(sourceRecordPath(STATE), 'utf8'));
  } catch {
    return null;
  }
}

export function sourceDir(): string | null {
  return sourceRecord()?.source ?? null;
}

function readMarker(): { commit: string | null; version: string | null } | null {
  try {
    return parseUpdatedMarker(readFileSync(MARKER, 'utf8'));
  } catch {
    return null;
  }
}

let windowVisible: () => boolean = () => true;

export function trackWindow(visible: () => boolean): void {
  windowVisible = visible;
}

function info(): UpdateInfo {
  return { build: BUILD, packaged: PACKAGED, announce: windowVisible() ? announcement(readMarker(), BUILD) : null };
}

// A published-release update leaves its marker when it is downloaded: the install may happen at a later quit, and the first start
// that runs the new version announces it.
export function writeReleaseMarker(version: string): void {
  try {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(MARKER, releaseMarker(version, new Date().toISOString()));
  } catch (e) {
    console.error('[update] marker', e);
  }
}

async function run(): Promise<{ logPath: string }> {
  if (!PACKAGED) throw new Error(t('updates.error.dev'));
  const dir = sourceDir();
  if (!dir) throw new Error(t('updates.error.noSource'));
  const script = join(dir, 'scripts/update.sh');
  if (!existsSync(script)) throw new Error(t('updates.error.noScript', { path: script }));
  mkdirSync(STATE, { recursive: true });
  const env = updateEnv(process.env);
  // The refusals (uncommitted changes in src/, another update running) come back here, where the screen can show them.
  try {
    await exec('bash', [script, '--check'], { cwd: dir, env, timeout: 15_000 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message);
  }
  // `setsid -f` hands the script to init: a child of this process would hold the app open at quit, and the script is
  // the one asking it to quit.
  spawn('setsid', ['-f', 'bash', script], { cwd: dir, stdio: 'ignore', env }).unref();
  return { logPath: LOG };
}

// Only the running instance's pid file is ours to remove.
function clearRunInfo(): void {
  try {
    if ((JSON.parse(readFileSync(RUN_FILE, 'utf8')) as { pid?: number }).pid === process.pid) rmSync(RUN_FILE, { force: true });
  } catch {}
}

export function announceRunning(): void {
  if (!PACKAGED) return;
  try {
    writeFileSync(RUN_FILE, JSON.stringify(runInfo(process.pid, BUILD, new Date().toISOString()), null, 1));
  } catch (e) {
    console.error('[update] run.json', e);
  }
}

export function forgetRunning(): void {
  clearRunInfo();
}

function listProcs(): Proc[] {
  const procs: Proc[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = parseStat(readFileSync(`/proc/${name}/stat`, 'utf8'));
      if (stat) procs.push({ ...stat, cmd: readFileSync(`/proc/${name}/cmdline`, 'utf8').replace(/\0/g, ' ') });
    } catch {}
  }
  return procs;
}

// Stops what the app started and is still running (see ownedDescendants), so the AppImage can unmount once the app exits.
export function terminateChildren(): number {
  if (process.platform !== 'linux') return 0;
  let stopped = 0;
  for (const pid of ownedDescendants(listProcs(), process.pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      stopped++;
    } catch {}
  }
  return stopped;
}

const waiting = new Set<() => void>();

// Asks the window to save what it holds and waits for its answer (or the timeout, when it is not there to answer).
export function flushRenderer(send: (ev: AppEvent) => void, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    waiting.add(done);
    send({ type: 'module', name: FLUSH_EVENT, payload: null });
  });
}

export const update: Module = (ctx) => {
  ctx.handle('update:info', () => info());
  ctx.handle('update:run', () => run());
  ctx.handle('update:seen', () => rmSync(MARKER, { force: true }));
  ctx.handle('update:flushed', () => {
    for (const done of [...waiting]) done();
  });
};
