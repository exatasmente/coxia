import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSchema, type JsonSchema } from '../shared/config/jsonSchema';
import { ATTACHMENT_KINDS, type AttachmentRef } from '../shared/attachments';
import {
  MAX_TEXT,
  MAX_TITLE,
  MESSAGE_KINDS,
  THREAD_ID,
  THREAD_KINDS,
  type ArtifactRef,
  type EvidenceRef,
  type ForumDraft,
  type ForumMessage,
  type PublishedRef,
  type ThreadHeader,
  type ThreadKind,
  type ThreadRead,
  type ThreadSummary,
} from '../shared/forum';
import { t } from '../shared/i18n';

// The forum store: one append-only JSONL file per thread in <workspace>/forum/<thread>.jsonl. Line 1 is the thread header, then messages, plus
// `published` annotation lines (a message cannot be edited in place, so mirroring it to the tracker is recorded as a later line that reading folds in).
// A line that does not parse is skipped, and a torn last line (a crash in the middle of a write) is closed before the next append.
// Electron-free: the folder, the clock and the redaction come in as arguments.

export const FORUM_ERROR_CODES = ['bad-thread', 'unknown-thread', 'empty', 'too-long', 'bad-title', 'bad-author'] as const;
export type ForumErrorCode = (typeof FORUM_ERROR_CODES)[number];

export class ForumError extends Error {
  constructor(
    readonly code: ForumErrorCode,
    params: Record<string, string | number> = {},
  ) {
    super(t(`main.forum.error.${code}`, params));
    this.name = 'ForumError';
  }
}

export interface ForumDeps {
  now?: () => Date;
  /** Applied to the text and the text parameters of what an agent or the app writes (never to the person's own words). */
  redact?: (text: string) => string;
}

export interface ForumStore {
  /** Creates the thread when it does not exist; returns the header it has. Idempotent. */
  ensureThread(input: { id: string; kind: ThreadKind; runId?: string | null; squad?: string | null; title: string }): ThreadHeader;
  /** A general thread with a title of the person's choosing; its id is made from the title and is never one that exists. */
  createGeneral(title: string): ThreadSummary;
  /** Appends messages in order to a thread that exists; returns them as stored. Listeners are told after the write. */
  append(thread: string, drafts: ForumDraft | ForumDraft[]): ForumMessage[];
  /** Records that a message was mirrored to the tracker. */
  markPublished(thread: string, seq: number, published: PublishedRef): ForumMessage;
  /**
   * Deletes one message of a thread and returns it, or null when there is no such message. The thread file is append-only, so the deletion is
   * recorded as its own line and reading folds it in: a torn write never loses a message, and the message comes back with the files it carried,
   * so the caller can delete them from disk.
   */
  remove(thread: string, seq: number): ForumMessage | null;
  list(): ThreadSummary[];
  /** Messages after `afterSeq` (at most `limit`), or null when the thread does not exist. */
  read(thread: string, afterSeq?: number, limit?: number): ThreadRead | null;
  summary(thread: string): ThreadSummary | null;
  subscribe(listener: (message: ForumMessage) => void): () => void;
}

const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const REF_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

// ---- what a line must look like ----------------------------------------------------------------------------------------------------------

const author: JsonSchema = {
  type: 'object',
  properties: { type: { type: 'string', enum: ['agent', 'person', 'app'] }, id: { type: 'string', maxLength: 48 } },
  required: ['type'],
  additionalProperties: false,
};
const publishedSchema: JsonSchema = {
  type: 'object',
  properties: { target: { type: 'string', enum: ['issue', 'mr'] }, noteId: { type: ['string', 'integer'] }, url: { type: ['string', 'null'], maxLength: 2000 } },
  required: ['target', 'noteId', 'url'],
  additionalProperties: false,
};
const HEADER: JsonSchema = {
  type: 'object',
  properties: {
    v: { type: 'integer', const: 1 },
    type: { type: 'string', const: 'thread' },
    id: { type: 'string', pattern: THREAD_ID.source },
    kind: { type: 'string', enum: [...THREAD_KINDS] },
    runId: { type: ['string', 'null'], maxLength: 64 },
    squad: { type: ['string', 'null'], maxLength: 48 },
    title: { type: 'string', maxLength: MAX_TITLE },
    createdAt: { type: 'string', maxLength: 40 },
  },
  required: ['v', 'type', 'id', 'kind', 'runId', 'title', 'createdAt'],
  additionalProperties: false,
};
const MESSAGE: JsonSchema = {
  type: 'object',
  properties: {
    v: { type: 'integer', const: 1 },
    type: { type: 'string', const: 'message' },
    seq: { type: 'integer', minimum: 1 },
    thread: { type: 'string', pattern: THREAD_ID.source },
    at: { type: 'string', maxLength: 40 },
    kind: { type: 'string', enum: [...MESSAGE_KINDS] },
    author,
    text: { type: 'string', maxLength: MAX_TEXT },
    code: { type: ['string', 'null'], maxLength: 100 },
    params: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
    mentions: { type: 'array', items: { type: 'string', maxLength: 48 } },
    refs: { type: 'array', items: { type: 'object', properties: { path: { type: 'string', maxLength: 200 }, label: { type: 'string', maxLength: 200 } }, required: ['path'], additionalProperties: false } },
    attachments: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string', maxLength: 32 }, name: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: ['image', 'text', 'pdf', 'json', 'csv'] }, bytes: { type: 'integer', minimum: 0 } }, required: ['id', 'name', 'kind', 'bytes'], additionalProperties: false },
    },
    anchor: { type: ['string', 'null'], maxLength: 80 },
    evidence: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', maxLength: 16 }, name: { type: 'string', maxLength: 200 }, media: { type: 'string', maxLength: 100 }, bytes: { type: 'integer', minimum: 0 } }, required: ['id', 'name', 'media', 'bytes'], additionalProperties: false }, maxItems: 10 },
    stage: { type: ['string', 'null'], maxLength: 48 },
    to: { type: ['string', 'null'], maxLength: 48 },
    replyTo: { type: ['integer', 'null'] },
    public: { type: 'boolean' },
    waitsForAnswer: { type: 'boolean' },
    published: { ...publishedSchema, type: ['object', 'null'] },
  },
  required: ['v', 'type', 'seq', 'thread', 'at', 'kind', 'author', 'text', 'code', 'params', 'mentions', 'refs', 'stage', 'to', 'replyTo', 'public', 'published'],
  additionalProperties: false,
};
const ANNOTATION: JsonSchema = {
  type: 'object',
  properties: { v: { type: 'integer', const: 1 }, type: { type: 'string', const: 'published' }, seq: { type: 'integer', minimum: 1 }, published: publishedSchema },
  required: ['v', 'type', 'seq', 'published'],
  additionalProperties: false,
};
const REMOVAL: JsonSchema = {
  type: 'object',
  properties: { v: { type: 'integer', const: 1 }, type: { type: 'string', const: 'removed' }, seq: { type: 'integer', minimum: 1 } },
  required: ['v', 'type', 'seq'],
  additionalProperties: false,
};

interface Parsed {
  header: ThreadHeader | null;
  messages: ForumMessage[];
  endsClean: boolean;
}

/** The thread file as it stands: header, messages in sequence order (already-removed ones left out) with their `published` link folded in, and whether the last line is closed. */
function parse(text: string): Parsed {
  let header: ThreadHeader | null = null;
  const messages = new Map<number, ForumMessage>();
  const published = new Map<number, PublishedRef>();
  const removed = new Set<number>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const kind = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : null;
    if (kind === 'thread' && !header && !validateSchema(raw, HEADER).length) header = raw as ThreadHeader;
    else if (kind === 'message' && !validateSchema(raw, MESSAGE).length) {
      const m = raw as ForumMessage;
      if (!messages.has(m.seq)) messages.set(m.seq, m);
    } else if (kind === 'published' && !validateSchema(raw, ANNOTATION).length) {
      const a = raw as { seq: number; published: PublishedRef };
      published.set(a.seq, a.published);
    } else if (kind === 'removed' && !validateSchema(raw, REMOVAL).length) {
      removed.add((raw as { seq: number }).seq);
    }
  }
  const sorted = [...messages.values()]
    .filter((m) => !removed.has(m.seq))
    .sort((a, b) => a.seq - b.seq)
    .map((m) => (published.has(m.seq) ? { ...m, published: published.get(m.seq) as PublishedRef } : m));
  // A message written before attachments existed carries none; the field the type promises is filled in here, not stored.
  for (const m of sorted) if (!Array.isArray(m.attachments)) m.attachments = [];
  return { header, messages: sorted, endsClean: text === '' || text.endsWith('\n') };
}

interface State {
  header: ThreadHeader;
  lastSeq: number;
  count: number;
  lastAt: string | null;
  lastKind: ForumMessage['kind'] | null;
  /** The sequence numbers of the questions and requests nobody has answered yet, oldest first. */
  open: number[];
  endsClean: boolean;
}

// An answer closes the question or request it says it answers (`replyTo`), or the latest one open when it says none: a thread with a single question at a
// time reads as it always did, and the squads channel, where requests are open side by side, closes each one by its own answer.
function settle(open: number[], m: Pick<ForumMessage, 'kind' | 'seq' | 'replyTo'>): number[] {
  if (m.kind === 'question' || m.kind === 'request') return [...open, m.seq];
  if (m.kind !== 'answer') return open;
  const target = m.replyTo !== null && open.includes(m.replyTo) ? m.replyTo : open[open.length - 1];
  return open.filter((n) => n !== target);
}

function stateOf(p: Parsed & { header: ThreadHeader }): State {
  let open: number[] = [];
  for (const m of p.messages) open = settle(open, m);
  const last = p.messages[p.messages.length - 1];
  // `lastSeq` is the highest sequence number ever used: it does not go back when a message is removed, and a number is never handed out twice.
  const lastSeq = p.messages.reduce((n, m) => Math.max(n, m.seq), 0);
  return { header: p.header, lastSeq, count: p.messages.length, lastAt: last?.at ?? null, lastKind: last?.kind ?? null, open, endsClean: p.endsClean };
}

const summaryOf = (s: State): ThreadSummary => ({
  id: s.header.id,
  kind: s.header.kind,
  runId: s.header.runId,
  ...(s.header.kind === 'channel' || s.header.kind === 'agent' ? { squad: s.header.squad ?? null } : {}),
  ...(s.header.kind === 'agent' ? { agent: s.header.squad ?? null } : {}),
  title: s.header.title,
  createdAt: s.header.createdAt,
  count: s.count,
  lastAt: s.lastAt,
  lastKind: s.lastKind,
  openQuestion: s.open.length > 0,
});

const slug = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'thread';

export function createForumStore(dir: string, deps: ForumDeps = {}): ForumStore {
  const now = deps.now ?? (() => new Date());
  const redact = deps.redact ?? ((s: string) => s);
  const listeners = new Set<(m: ForumMessage) => void>();
  const cache = new Map<string, State>();

  const path = (id: string): string => {
    // The id becomes a file name: only ours get through.
    if (!THREAD_ID.test(id)) throw new ForumError('bad-thread', { id: id.slice(0, 40) });
    return join(dir, `${id}.jsonl`);
  };

  const load = (id: string): State | null => {
    const hit = cache.get(id);
    if (hit) return hit;
    const file = path(id);
    if (!existsSync(file)) return null;
    const p = parse(readFileSync(file, 'utf8'));
    if (!p.header || p.header.id !== id) return null;
    const state = stateOf({ ...p, header: p.header });
    cache.set(id, state);
    return state;
  };

  const emit = (m: ForumMessage): void => {
    for (const fn of listeners) {
      try {
        fn(m);
      } catch (e) {
        console.error('[forum]', e instanceof Error ? e.message : e);
      }
    }
  };

  const cleanRefs = (refs: ArtifactRef[] | undefined): ArtifactRef[] =>
    (refs ?? []).filter((r) => typeof r?.path === 'string' && REF_PATH.test(r.path) && !r.path.split('/').some((seg) => seg === '..' || seg === '.')).map((r) => ({ path: r.path, ...(typeof r.label === 'string' && r.label ? { label: r.label.slice(0, 200) } : {}) }));

  // The attachments of a message are already clean when they arrive (main/attachments.ts made the id and read the kind from the content):
  // the store only drops what does not hold its own shape, so a hand-written line cannot smuggle a path into the message.
  const cleanAttachments = (list: AttachmentRef[] | undefined): AttachmentRef[] =>
    (list ?? [])
      .filter((a) => !!a && typeof a.id === 'string' && /^[a-f0-9]{8,32}$/.test(a.id) && ATTACHMENT_KINDS.includes(a.kind) && typeof a.name === 'string' && Number.isFinite(a.bytes) && a.bytes >= 0)
      .map((a) => ({ id: a.id, name: a.name.slice(0, 200), kind: a.kind, bytes: Math.floor(a.bytes) }))
      .slice(0, 50);

  /** The evidence a message carries, as stored: the id is an evidence id, and the name and the media type are short strings. */
  const cleanEvidence = (list: EvidenceRef[] | undefined): EvidenceRef[] =>
    (list ?? [])
      .filter((a) => typeof a?.id === 'string' && /^ev-\d{1,6}$/.test(a.id) && typeof a.name === 'string' && typeof a.media === 'string' && Number.isInteger(a.bytes) && a.bytes >= 0)
      .slice(0, 10)
      .map((a) => ({ id: a.id, name: a.name.slice(0, 200), media: a.media.slice(0, 100), bytes: a.bytes }));

  function build(state: State, d: ForumDraft, seq: number): ForumMessage {
    const a = d.author;
    if (!a || (a.type !== 'agent' && a.type !== 'person' && a.type !== 'app') || (a.type === 'agent' && !AGENT_ID.test(a.id))) throw new ForumError('bad-author');
    if (!(MESSAGE_KINDS as readonly string[]).includes(d.kind)) throw new ForumError('empty');
    const untrusted = a.type !== 'person';
    const guard = (s: string): string => (untrusted ? redact(s) : s);
    const text = guard(typeof d.text === 'string' ? d.text : '');
    if (!text.trim() && !d.code) throw new ForumError('empty');
    if (text.length > MAX_TEXT) throw new ForumError('too-long', { max: MAX_TEXT });
    const params = Object.fromEntries(Object.entries(d.params ?? {}).map(([k, v]) => [k, typeof v === 'string' ? guard(v).slice(0, 2000) : v]));
    return {
      v: 1,
      type: 'message',
      seq,
      thread: state.header.id,
      at: now().toISOString(),
      kind: d.kind,
      author: a.type === 'agent' ? { type: 'agent', id: a.id } : { type: a.type },
      text,
      code: d.code ?? null,
      params,
      mentions: [...new Set((d.mentions ?? []).filter((m) => typeof m === 'string' && AGENT_ID.test(m)))],
      refs: cleanRefs(d.refs),
      attachments: cleanAttachments(d.attachments),
      anchor: typeof d.anchor === 'string' && d.anchor ? d.anchor.slice(0, 80) : null,
      ...(d.evidence?.length ? { evidence: cleanEvidence(d.evidence) } : {}),
      stage: d.stage ?? null,
      to: d.to ?? null,
      // An answer says which question or request it answers: the one it names when that one is open, else the latest nobody has answered.
      replyTo: d.kind === 'answer' ? (d.replyTo !== undefined && d.replyTo !== null && state.open.includes(d.replyTo) ? d.replyTo : (state.open[state.open.length - 1] ?? null)) : null,
      public: d.public === true,
      // Only the person's own words are read for it (the guard does not touch them): a message that asks something and is not seen is told so in the thread.
      waitsForAnswer: a.type === 'person' && d.kind === 'post' && /\?\s*$/.test(text.trim()),
      published: d.published ?? null,
    };
  }

  const store: ForumStore = {
    ensureThread(input) {
      const have = load(input.id);
      if (have) return have.header;
      if (input.title.length > MAX_TITLE) throw new ForumError('bad-title');
      const header: ThreadHeader = { v: 1, type: 'thread', id: input.id, kind: input.kind, runId: input.runId ?? null, ...(input.kind === 'channel' || input.kind === 'agent' ? { squad: input.squad ?? null } : {}), title: input.title.trim(), createdAt: now().toISOString() };
      mkdirSync(dir, { recursive: true });
      // 'wx': a thread another call created in the meantime is not overwritten.
      writeFileSync(path(input.id), `${JSON.stringify(header)}\n`, { flag: 'wx' });
      cache.set(input.id, { header, lastSeq: 0, count: 0, lastAt: null, lastKind: null, open: [], endsClean: true });
      return header;
    },
    createGeneral(title) {
      const name = title.trim();
      if (!name || name.length > MAX_TITLE) throw new ForumError('bad-title');
      const base = `g-${slug(name)}`;
      let id = base;
      for (let n = 2; existsSync(path(id)); n++) id = `${base}-${n}`;
      store.ensureThread({ id, kind: 'general', title: name });
      return store.summary(id) as ThreadSummary;
    },
    append(thread, drafts) {
      const state = load(thread);
      if (!state) throw new ForumError('unknown-thread', { id: thread });
      const list = Array.isArray(drafts) ? drafts : [drafts];
      if (!list.length) return [];
      // Built against a working copy: a bad draft stops the call before anything is written.
      const work: State = { ...state };
      const built: ForumMessage[] = [];
      for (const d of list) {
        const m = build(work, d, work.lastSeq + 1);
        built.push(m);
        work.lastSeq = m.seq;
        work.count += 1;
        work.lastAt = m.at;
        work.lastKind = m.kind;
        work.open = settle(work.open, m);
      }
      appendFileSync(path(thread), `${state.endsClean ? '' : '\n'}${built.map((m) => JSON.stringify(m)).join('\n')}\n`);
      cache.set(thread, { ...work, endsClean: true });
      for (const m of built) emit(m);
      return built;
    },
    markPublished(thread, seq, published) {
      const state = load(thread);
      if (!state) throw new ForumError('unknown-thread', { id: thread });
      const checked = validateSchema(published, publishedSchema);
      if (checked.length || !Number.isInteger(seq) || seq < 1 || seq > state.lastSeq) throw new ForumError('empty');
      appendFileSync(path(thread), `${state.endsClean ? '' : '\n'}${JSON.stringify({ v: 1, type: 'published', seq, published })}\n`);
      cache.set(thread, { ...state, endsClean: true });
      const message = (store.read(thread, seq - 1, 1)?.messages[0]) as ForumMessage;
      return message;
    },
    remove(thread, seq) {
      const state = load(thread);
      if (!state) throw new ForumError('unknown-thread', { id: thread });
      if (!Number.isInteger(seq) || seq < 1 || seq > state.lastSeq) return null;
      // What is read back is what stood before the removal: a message already removed is gone, and the deletion is never recorded twice.
      const before = parse(readFileSync(path(thread), 'utf8'));
      const found = before.messages.find((m) => m.seq === seq) ?? null;
      if (!found) return null;
      appendFileSync(path(thread), `${state.endsClean ? '' : '\n'}${JSON.stringify({ v: 1, type: 'removed', seq })}\n`);
      cache.set(thread, stateOf({ ...before, header: before.header as ThreadHeader, endsClean: true }));
      return found;
    },
    list() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl') && THREAD_ID.test(f.slice(0, -6)))
        .flatMap((f) => {
          const s = load(f.slice(0, -6));
          return s ? [summaryOf(s)] : [];
        })
        .sort((a, b) => ((b.lastAt ?? b.createdAt) < (a.lastAt ?? a.createdAt) ? -1 : (b.lastAt ?? b.createdAt) > (a.lastAt ?? a.createdAt) ? 1 : a.id < b.id ? -1 : 1));
    },
    summary(thread) {
      const s = load(thread);
      return s ? summaryOf(s) : null;
    },
    read(thread, afterSeq = 0, limit = DEFAULT_LIMIT) {
      const s = load(thread);
      if (!s) return null;
      const p = parse(readFileSync(path(thread), 'utf8'));
      const after = Number.isInteger(afterSeq) && afterSeq > 0 ? afterSeq : 0;
      const max = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT;
      return { thread: summaryOf(s), messages: p.messages.filter((m) => m.seq > after).slice(0, max), last: s.lastSeq };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}
