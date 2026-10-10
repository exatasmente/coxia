import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename, dirname, sep } from 'node:path';
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
import { createAttachmentStore } from './attachments';
import { dropEvidence, evidencePath } from './evidence/store';
import { forumStore } from './forum';
import { moveRun } from './runs-forum';
import { runStore } from './runs';
import { markRecordingRemoved } from '../shared/runs';
import type { Run } from '../shared/runs';
import { purgeTrash } from './minutesStore';
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

// Every attachment id a live forum message still references, by conversation: what the sweep must never delete. Read from the append-only thread
// files, so a message that was deleted takes its files out of the keep set (and the folder of that message was emptied when it was deleted).
export function referencedAttachments(base = ATAS): Set<string> {
  const keep = new Set<string>();
  const dir = join(base, 'forum');
  if (!existsSync(dir)) return keep;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const thread = name.slice(0, -6);
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line.includes('"attachments"')) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const list = (raw as { attachments?: { id?: unknown }[] }).attachments;
      if (!Array.isArray(list)) continue;
      for (const a of list) if (typeof a?.id === 'string') keep.add(`${thread}/${a.id}`);
    }
  }
  return keep;
}

/** The workspace's attachment store, over ATAS: the sweep removes a file it selected through the store, which refuses a name that is not one of ours. */
const attachmentFilesStore = createAttachmentStore();

/** The attachment files: one folder per conversation under <workspace>/anexos, one file per attachment. A file a live message references is kept; the
 * rest is selected by age like the other data. A file that is already gone when the sweep reaches it is nothing to do, not a failure. */
export function attachmentFiles(base = ATAS): RetentionFile[] {
  const dir = join(base, 'anexos');
  if (!existsSync(dir)) return [];
  const keep = referencedAttachments(base);
  const files: RetentionFile[] = [];
  for (const conversation of readdirSync(dir, { withFileTypes: true })) {
    if (!conversation.isDirectory()) continue;
    const folder = join(dir, conversation.name);
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      try {
        const st = statSync(path);
        if (!st.isFile()) continue;
        // The recordings of the agents' screens are listed with the other recordings (`conversationRecordingFiles`): a live message names them, which would keep them for ever.
        if (name.endsWith(RECORDING_EXT)) continue;
        const id = name.split('.')[0];
        files.push({ kind: 'anexos', path, size: st.size, mtimeMs: st.mtimeMs, keep: keep.has(`${conversation.name}/${id}`) });
      } catch {
        // the file went away between the listing and the stat (a message deleted, a person took the file out): nothing to select
      }
    }
  }
  return files;
}

/**
 * The screen recordings of the stages (#157): the app's own `webm` pieces of evidence, listed through the runs' records, never by walking the evidence folder, so
 * another piece of evidence can not be taken for one. A recording the sweep already removed (its record says so) or whose file is gone is not listed. Retention is
 * off by default and these follow the workspace's switch and days like the other groups.
 */
export function screenRecordingFiles(base = ATAS, runs: Run[] = runStore().list()): RetentionFile[] {
  const files: RetentionFile[] = [];
  for (const run of runs) {
    for (const record of Object.values(run.evidence ?? {})) {
      if (record.kind !== 'webm' || !record.recording || record.removed) continue;
      const path = evidencePath(base, run.id, record);
      if (!path) continue;
      try {
        const st = lstatSync(path);
        if (st.isFile()) files.push({ kind: 'screens', path, size: st.size, mtimeMs: st.mtimeMs, keep: false });
      } catch {
        // the file went away between the listing and the stat: nothing to select
      }
    }
  }
  return files;
}

/** The extension a conversation's recording has on disk (`attachmentExt('video')`). */
const RECORDING_EXT = '.webm';

/**
 * The recordings of the agents' screens kept in the conversations (#177): the app's own `video` attachments, listed by the folder of the conversation they are in and
 * never kept for being named by a live message, since the message is where the sweep says it removed them. They follow the workspace's switch and days with the stages'.
 */
export function conversationRecordingFiles(base = ATAS): RetentionFile[] {
  const dir = join(base, 'anexos');
  if (!existsSync(dir)) return [];
  const files: RetentionFile[] = [];
  for (const conversation of readdirSync(dir, { withFileTypes: true })) {
    if (!conversation.isDirectory()) continue;
    const folder = join(dir, conversation.name);
    for (const name of readdirSync(folder)) {
      if (!/^[a-f0-9]{8,32}\.webm$/.test(name)) continue;
      try {
        const st = lstatSync(join(folder, name));
        if (st.isFile()) files.push({ kind: 'screens', path: join(folder, name), size: st.size, mtimeMs: st.mtimeMs, keep: false });
      } catch {
        // the file went away between the listing and the stat: nothing to select
      }
    }
  }
  return files;
}

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
  const files = [...dataFiles(refs), ...attachmentFiles(), ...screenRecordingFiles(), ...conversationRecordingFiles(), ...sessionFiles()];
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

/**
 * Removes a screen recording: only the app's copy of the file, then the record is marked as removed by retention. Another piece of evidence, the run's other
 * records and any copy in a cycle folder or on a code host are not touched. The record decides what the file is, not the path the sweep listed: it must still be a
 * recording of that run that was not removed, and the file must be the one its id names.
 */
export function removeScreenRecording(file: RetentionFile): void {
  if (isConversationRecording(file.path)) return removeConversationRecording(file);
  const runId = basename(dirname(file.path));
  const id = basename(file.path).replace(/\.webm$/, '');
  const run = runStore().get(runId);
  const record = run?.evidence?.[id];
  // Gone since the preview (the person deleted it, or an earlier sweep marked it): nothing to do.
  if (!run || !record || record.kind !== 'webm' || !record.recording || record.removed) return;
  if (existsSync(file.path)) {
    const st = lstatSync(file.path);
    if (!st.isFile()) throw new Error(t('main.retention.notRegular'));
    if (st.mtimeMs !== file.mtimeMs) throw new Error(t('main.retention.changed'));
    if (!inside(file.path, join(ATAS, 'evidence')) || evidencePath(ATAS, runId, record) !== file.path) throw new Error(t('main.retention.outside'));
    dropEvidence(ATAS, runId, record);
    try {
      rmdirSync(dirname(file.path));
    } catch {
      // other pieces of the run are in the folder: it stays
    }
  }
  moveRun({ runs: runStore(), forum: forumStore() }, runId, (r) => markRecordingRemoved(r, id, new Date().toISOString()));
}

/** Whether the file is in a conversation's folder of attachments, not in a run's evidence. */
const isConversationRecording = (path: string): boolean => dirname(dirname(path)) === join(ATAS, 'anexos');

/**
 * Removes the recording of a conversation: the file, through the attachment store's own door, and then the message that names it says so (the ref is marked `removed`, the
 * post stays). A file that is gone since the preview, or was changed since, is not taken: the sweep removes what it listed.
 */
export function removeConversationRecording(file: RetentionFile): void {
  const thread = basename(dirname(file.path));
  const name = basename(file.path);
  if (!/^[a-f0-9]{8,32}\.webm$/.test(name)) throw new Error(t('main.retention.outside'));
  if (existsSync(file.path)) {
    const st = lstatSync(file.path);
    if (!st.isFile()) throw new Error(t('main.retention.notRegular'));
    if (st.mtimeMs !== file.mtimeMs) throw new Error(t('main.retention.changed'));
    if (!inside(file.path, join(ATAS, 'anexos'))) throw new Error(t('main.retention.outside'));
    attachmentFilesStore.dropFile(thread, name);
  }
  const id = name.slice(0, -RECORDING_EXT.length);
  const forum = forumStore();
  try {
    for (const m of forum.read(thread, 0, 2000)?.messages ?? []) if (m.attachments?.some((a) => a.id === id && a.kind === 'video' && !a.removed)) forum.markAttachmentRemoved(thread, m.seq, id);
  } catch (e) {
    console.error('[retention] could not mark a recording as removed', e instanceof Error ? e.message : e);
  }
  try {
    if (!readdirSync(dirname(file.path)).length) rmSync(dirname(file.path), { recursive: true, force: true });
  } catch {
    // the folder is harmless empty; the next sweep tries again
  }
}

function removeOne(file: RetentionFile): void {
  if (file.kind === 'screens') return removeScreenRecording(file);
  // An attachment is removed by its own door (the store resolves the name inside the conversation's folder): the sweep walks the folder and has no ref for
  // what it found. A file that went away before this point is nothing to do, not a failure.
  if (file.kind === 'anexos') {
    const conversation = basename(dirname(file.path));
    const name = basename(file.path);
    if (!existsSync(file.path)) return;
    attachmentFilesStore.dropFile(conversation, name);
    try {
      if (!readdirSync(dirname(file.path)).length) rmSync(dirname(file.path), { recursive: true, force: true });
    } catch {
      // a folder that cannot be removed yet is harmless; the next sweep finds it empty and tries again
    }
    return;
  }
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
      // The minutes trash has its own fixed term, whatever the retention setting says.
      const purged = purgeTrash();
      if (purged) appendFileSync(LOG, `${new Date().toISOString()} lixeira das atas: ${purged} apagada(s)\n`);
      const r = getSettings().retention;
      if (r.enabled) applyRetention(r.days, null);
    },
  });
};
