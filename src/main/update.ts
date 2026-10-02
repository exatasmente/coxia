import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { AppEvent } from '../shared/types';
import { FLUSH_EVENT, type BuildInfo, type UpdateInfo } from '../shared/update';
import { DATA_ROOT, HOME } from './env';
import type { Module } from './module';
import { PACKAGED } from './paths';
import {
  parseBehind,
  parseLatest,
  parseUpdatedMarker,
  readBuild,
  runInfo,
  stateDir,
  stripDirty,
  updateEnv,
  updateLogName,
  updatedMarkerName,
} from './update-core';

const exec = promisify(execFile);

declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const BUILD: BuildInfo = readBuild(
  app.getVersion(),
  typeof __BUILD_COMMIT__ === 'undefined' ? undefined : __BUILD_COMMIT__,
  typeof __BUILD_DATE__ === 'undefined' ? undefined : __BUILD_DATE__,
);

const SOURCE_DIR = process.env.CERIMONIAS_SOURCE_DIR || join(HOME, 'projects/cerimonias');
const STATE = stateDir(process.env, HOME);
const LOG = join(STATE, updateLogName);
const MARKER = join(STATE, updatedMarkerName);
// The running instance reports itself here; scripts/update.sh reads it to say what is installed now.
const RUN_FILE = join(DATA_ROOT, 'run.json');
const GIT_FORMAT = '--format=%h%x1f%cI%x1f%s';

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', SOURCE_DIR, ...args], { timeout: 8000, env: { ...process.env, LC_ALL: 'C' } });
  return stdout;
}

async function latest(): Promise<{ latest: UpdateInfo['latest']; error: string | null }> {
  try {
    const found = parseLatest(await git(['log', '-1', GIT_FORMAT, 'main']));
    if (!found) return { latest: null, error: 'não consegui ler o último commit da main' };
    let behind: number | null = null;
    if (/^[0-9a-f]{4,40}\b/.test(BUILD.commit)) {
      behind = await git(['rev-list', '--count', `${stripDirty(BUILD.commit)}..main`]).then(parseBehind, () => null);
    }
    return { latest: { ...found, behind }, error: null };
  } catch (e) {
    return { latest: null, error: `não consegui consultar ${SOURCE_DIR}: ${(e as Error).message.split('\n')[0]}` };
  }
}

function readMarker(): { commit: string | null } | null {
  try {
    return parseUpdatedMarker(readFileSync(MARKER, 'utf8'));
  } catch {
    return null;
  }
}

async function info(): Promise<UpdateInfo> {
  const found = await latest();
  return {
    build: BUILD,
    packaged: PACKAGED,
    sourceDir: SOURCE_DIR,
    latest: found.latest,
    latestError: found.error,
    logPath: LOG,
    announce: readMarker() ? BUILD.commit : null,
  };
}

async function run(): Promise<{ logPath: string }> {
  if (!PACKAGED) throw new Error('Só funciona no app instalado. Em desenvolvimento, rode scripts/update.sh num terminal.');
  const script = join(SOURCE_DIR, 'scripts/update.sh');
  if (!existsSync(script)) throw new Error(`não achei ${script}`);
  mkdirSync(STATE, { recursive: true });
  const env = updateEnv(process.env);
  // The refusals (uncommitted changes in src/, another update running) come back here, where the screen can show them.
  try {
    await exec('bash', [script, '--check'], { cwd: SOURCE_DIR, env, timeout: 15_000 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message);
  }
  // `setsid -f` hands the script to init: a child of this process would hold the app open at quit, and the script is
  // the one asking it to quit.
  spawn('setsid', ['-f', 'bash', script], { cwd: SOURCE_DIR, stdio: 'ignore', env }).unref();
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
