import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERER_KINDS, type ErrorsSummary, type ErrorsView, type RendererReport } from '../shared/errorlog';
import { appendEntry, buildEntry, clearLog, createLimiter, groupEntries, logFile, readEntries } from './errorlog-core';
import { DATA_ROOT, WORKSPACE_ID } from './env';
import type { Module, ModuleContext } from './module';

export const ERRORS_EVENT = 'errors:changed';

const DIR = join(DATA_ROOT, 'logs');
const SEEN = join(DIR, 'seen.json');
const EMIT_DELAY_MS = 400;

let ctx: ModuleContext | null = null;
let emitTimer: NodeJS.Timeout | null = null;
// A loop of failures cannot fill the disk: the excess is dropped (the terminal still shows it).
const allowMain = createLimiter(120, 60_000);
const allowRenderer = createLimiter(20, 60_000);

function seenAt(): number {
  try {
    return existsSync(SEEN) ? Number((JSON.parse(readFileSync(SEEN, 'utf8')) as { at?: unknown }).at) || 0 : 0;
  } catch {
    return 0;
  }
}

function markSeen(at: number): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${SEEN}.tmp`, JSON.stringify({ at }));
  renameSync(`${SEEN}.tmp`, SEEN);
}

export function errorsView(): ErrorsView {
  const entries = readEntries(DIR);
  const { groups, unseen } = groupEntries(entries, seenAt());
  return { groups, total: entries.length, unseen, file: logFile(DIR) };
}

function summary(): ErrorsSummary {
  const { total, unseen } = errorsView();
  return { total, unseen };
}

function changed(): void {
  if (!ctx || emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    try {
      ctx?.emit({ type: 'module', name: ERRORS_EVENT, payload: summary() });
    } catch {}
  }, EMIT_DELAY_MS);
  emitTimer.unref();
}

/**
 * Appends one error to <DATA_ROOT>/logs/errors.jsonl. Never throws and never prints (callers keep their own console output).
 * `context` is filtered to a few short keys (channel, ids, status): do not pass arguments, they would be dropped anyway.
 */
export function logError(source: string, error: unknown, context?: Record<string, unknown>): void {
  try {
    if (!allowMain()) return;
    appendEntry(DIR, buildEntry(source, error, context, WORKSPACE_ID));
    changed();
  } catch {}
}

function fromRenderer(raw: unknown): RendererReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!RENDERER_KINDS.includes(r.kind as RendererReport['kind']) || typeof r.message !== 'string') return null;
  return {
    kind: r.kind as RendererReport['kind'],
    message: r.message.slice(0, 1000),
    stack: typeof r.stack === 'string' ? r.stack.slice(0, 6000) : undefined,
    platform: r.platform === 'web' ? 'web' : 'desktop',
  };
}

// The renderer (window or paired browser) reports here and nowhere else: the text only ever lands in the log.
function logRenderer(raw: unknown): void {
  const report = fromRenderer(raw);
  if (!report || !allowRenderer()) return;
  console.error(`[renderer ${report.platform}]`, report.message.slice(0, 300));
  logError(`renderer:${report.kind}`, { name: 'Error', message: report.message, stack: report.stack }, { platform: report.platform, kind: report.kind });
}

// Autostart has no terminal: Electron's default dialog for an uncaught error would block the tray app, so these are logged and printed instead.
export function installProcessHandlers(): void {
  process.on('uncaughtException', (e) => {
    if ((e as NodeJS.ErrnoException)?.code === 'EPIPE') return;
    console.error('[uncaughtException]', e);
    logError('main:uncaughtException', e);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    logError('main:unhandledRejection', reason);
  });
}

export const errorlog: Module = (c) => {
  ctx = c;
  c.handle('errors:get', () => errorsView());
  c.handle('errors:seen', () => {
    markSeen(Date.now());
    changed();
    return { ...summary(), unseen: 0 };
  });
  c.handle('errors:clear', () => {
    clearLog(DIR);
    markSeen(Date.now());
    changed();
    return errorsView();
  });
  c.handle('log:renderer', (report: unknown) => logRenderer(report));
};
