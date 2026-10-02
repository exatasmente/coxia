import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join, sep } from 'node:path';
import {
  retentionLabel,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  type RetentionGroup,
  type RetentionItem,
  type RetentionKind,
  type RetentionPreview,
  type RetentionResult,
} from '../shared/retention';
import { getSettings } from './config';
import { firstPromptOf } from './custo-core';
import { ATAS, DATA_ROOT, WORKSPACE_ID } from './env';
import { rc } from './workspaceConfig';
import type { Module } from './module';
import { sessionRefs } from './sessions-core';
import { readRegistry, workspaceDir } from './workspaces-core';
import {
  DAY,
  UUID,
  type RetentionFile,
  type RetentionRef,
  type Selection,
  appPromptKind,
  entrypointsOf,
  fileName,
  selectRetention,
} from './retention-core';
import { t } from '../shared/i18n';

const sessionsDir = (): string => rc().transcriptsDir;
const DATA_GROUPS: RetentionKind[] = ['historico', 'gates', 'qa', 'retros', 'atividade', 'feedback'];
const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const DATA_FILE = /^[\w.-]+\.json$/;
const HEAD_BYTES = 256 * 1024;
const LOG = join(ATAS, 'retencao.log');

function head(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirSize(p);
    else if (e.isFile()) total += statSync(p).size;
  }
  return total;
}

function sessionFiles(): RetentionFile[] {
  if (!existsSync(sessionsDir())) return [];
  const files: RetentionFile[] = [];
  for (const entry of readdirSync(sessionsDir(), { withFileTypes: true })) {
    if (!entry.isFile() || !SESSION_FILE.test(entry.name)) continue;
    const path = join(sessionsDir(), entry.name);
    const st = statSync(path);
    const sessionId = entry.name.replace(/\.jsonl$/, '');
    const firstPrompt = firstPromptOf(head(path).split('\n'));
    let size = st.size;
    // Only a transcript that starts like the app's is read whole, to see whether someone else continued it.
    const entrypoints = appPromptKind(firstPrompt) ? entrypointsOf(readFileSync(path, 'utf8')) : undefined;
    const companion = join(sessionsDir(), sessionId);
    if (existsSync(companion) && lstatSync(companion).isDirectory()) size += dirSize(companion);
    files.push({ kind: 'sessoes', path, size, mtimeMs: st.mtimeMs, sessionId, firstPrompt, entrypoints });
  }
  return files;
}

function dataFiles(refs: RetentionRef[], base = ATAS): RetentionFile[] {
  const files: RetentionFile[] = [];
  for (const kind of DATA_GROUPS) {
    const dir = join(base, kind);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !DATA_FILE.test(entry.name)) continue;
      const path = join(dir, entry.name);
      const st = statSync(path);
      let keep = false;
      let text = '';
      try {
        text = readFileSync(path, 'utf8');
        keep = (JSON.parse(text) as { keep?: unknown }).keep === true;
      } catch {}
      for (const id of new Set(text.match(UUID) ?? [])) refs.push({ sessionId: id, at: st.mtimeMs, keep, from: `${kind}/${entry.name}` });
      files.push({ kind, path, size: st.size, mtimeMs: st.mtimeMs, keep });
    }
  }
  return files;
}

// acoes.json is one living file, so each action counts with its own last activity, not the file's.
// null means the store exists but cannot be read: nothing is known about the sessions it references.
function actionRefs(base = ATAS): RetentionRef[] | null {
  const file = join(base, 'acoes.json');
  if (!existsSync(file)) return [];
  try {
    const store = JSON.parse(readFileSync(file, 'utf8')) as {
      actions?: { id?: string; sessionId?: string | null; createdAt?: string; finishedAt?: string | null; msgs?: { at?: string }[] }[];
    };
    return (store.actions ?? []).flatMap((a) => {
      if (!a.sessionId) return [];
      const times = [a.createdAt, a.finishedAt, ...(a.msgs ?? []).map((m) => m.at)].map((t) => (t ? Date.parse(t) : 0));
      return [{ sessionId: a.sessionId, at: Math.max(0, ...times.filter(Number.isFinite)), keep: false, from: t('main.retention.fromAction', { id: a.id ?? '' }).trim() }];
    });
  } catch {
    return null;
  }
}

// Transcripts are shared by every workspace: one that another workspace still uses is not unreferenced here.
function otherWorkspaceRefs(): RetentionRef[] {
  const refs: RetentionRef[] = [];
  const reg = readRegistry(DATA_ROOT);
  for (const w of reg?.list ?? []) {
    if (w.id === WORKSPACE_ID) continue;
    const base = workspaceDir(DATA_ROOT, w.id);
    refs.push(...(actionRefs(base) ?? []));
    dataFiles(refs, base);
  }
  if (reg) refs.push(...sessionRefs(DATA_ROOT, reg, WORKSPACE_ID));
  return refs;
}

export function scan(days: number, now = Date.now()): Selection {
  const actions = actionRefs();
  const refs = [...(actions ?? []), ...otherWorkspaceRefs()];
  const files = [...dataFiles(refs), ...sessionFiles()];
  const selection = selectRetention(files, refs, { now, days });
  if (actions === null) {
    const sessions = selection.remove.filter((v) => v.file.kind === 'sessoes');
    selection.keep.push(...sessions.map((v) => ({ ...v, remove: false, reason: t('main.retention.actionsUnreadable') })));
    selection.remove = selection.remove.filter((v) => v.file.kind !== 'sessoes');
  }
  return selection;
}

function checkDays(days: number): number {
  if (!Number.isInteger(days) || days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS) {
    throw new Error(t('main.retention.daysRange', { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS }));
  }
  return days;
}

function fingerprint(sel: Selection): string {
  const h = createHash('sha1');
  for (const v of [...sel.remove].sort((a, b) => a.file.path.localeCompare(b.file.path))) h.update(`${v.file.path}:${v.file.mtimeMs}:${v.file.size}\n`);
  return h.digest('hex');
}

export function previewRetention(days: number, now = Date.now()): RetentionPreview {
  checkDays(days);
  const selection = scan(days, now);
  const groups = new Map<RetentionKind, RetentionGroup>();
  const items: RetentionItem[] = [];
  for (const v of selection.remove) {
    const g = groups.get(v.file.kind) ?? { kind: v.file.kind, label: retentionLabel(v.file.kind), count: 0, bytes: 0 };
    g.count += 1;
    g.bytes += v.file.size;
    groups.set(v.file.kind, g);
    items.push({ kind: v.file.kind, name: fileName(v.file.path), size: v.file.size, mtime: new Date(v.file.mtimeMs).toISOString(), reason: v.reason });
  }
  items.sort((a, b) => a.mtime.localeCompare(b.mtime));
  return {
    days,
    cutoff: new Date(now - days * DAY).toISOString(),
    groups: [...groups.values()],
    items,
    count: items.length,
    bytes: items.reduce((n, i) => n + i.size, 0),
    fingerprint: fingerprint(selection),
    untouchedSessions: selection.keep.filter((v) => v.file.kind === 'sessoes' && !appPromptKind(v.file.firstPrompt)).length,
  };
}

function inside(path: string, root: string): boolean {
  try {
    return realpathSync(path).startsWith(realpathSync(root) + sep);
  } catch {
    return false;
  }
}

function removeOne(file: RetentionFile): void {
  const st = lstatSync(file.path);
  if (!st.isFile()) throw new Error(t('main.retention.notRegular'));
  if (st.mtimeMs !== file.mtimeMs) throw new Error(t('main.retention.changed'));
  const root = file.kind === 'sessoes' ? sessionsDir() : join(ATAS, file.kind);
  if (!inside(file.path, root)) throw new Error(t('main.retention.outside'));
  unlinkSync(file.path);
  if (file.kind === 'sessoes' && file.sessionId) {
    const companion = join(sessionsDir(), file.sessionId);
    if (existsSync(companion) && lstatSync(companion).isDirectory() && inside(companion, sessionsDir())) rmSync(companion, { recursive: true, force: true });
  }
}

export function applyRetention(days: number, expected: string | null, now = Date.now()): RetentionResult {
  checkDays(days);
  const selection = scan(days, now);
  if (expected !== null && fingerprint(selection) !== expected) throw new Error(t('main.retention.listChanged'));
  const result: RetentionResult = { deleted: 0, bytes: 0, failed: [] };
  for (const v of selection.remove) {
    try {
      removeOne(v.file);
      result.deleted += 1;
      result.bytes += v.file.size;
    } catch (e) {
      result.failed.push({ name: fileName(v.file.path), error: e instanceof Error ? e.message : String(e) });
    }
  }
  mkdirSync(ATAS, { recursive: true });
  appendFileSync(LOG, `${new Date(now).toISOString()} deleted=${result.deleted} bytes=${result.bytes} failed=${result.failed.length} days=${days}d${expected === null ? ' (daily)' : ''}\n`);
  return result;
}

export const retention: Module = (ctx) => {
  ctx.handle('retention:preview', (days: number) => previewRetention(days));
  ctx.handle('retention:apply', (days: number, fingerprint: string) => applyRetention(days, fingerprint));
  ctx.job({
    name: 'retention',
    everyMin: 24 * 60,
    workHoursOnly: false,
    run: async () => {
      const r = getSettings().retention;
      if (r.enabled) applyRetention(r.days, null);
    },
  });
};
