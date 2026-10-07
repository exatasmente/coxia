import { join } from 'node:path';
import { ATTACHMENT_LIMITS, type AttachmentRef } from '../shared/attachments';
import { FORUM_EVENT, GENERAL_THREAD, MAX_TEXT, type ForumEventPayload, type ForumMessage, type ThreadRead, type ThreadSummary, parseMentions, unknownMentions } from '../shared/forum';
import { t } from '../shared/i18n';
import { attachmentStore } from './attachments';
import { ATAS } from './env';
import { redact } from './errorlog-core';
import { ForumError, type ForumStore, createForumStore } from './forum-core';
import { ensureSquadChannels } from './forum-channels';
import { runStore } from './runs';
import type { Module } from './module';
import { getConfig } from './workspaceConfig';

// The forum of the running workspace: <workspace>/forum/<thread>.jsonl. The channels below are local reads and writes of the workspace's own
// folder, so a paired browser may use them (webPolicy.ts leaves them open, test/forum-policy.test.ts pins it): the phone is where a person answers.
// A post only ever says something; an agent a mention calls on answers read-only, whatever its own permission (the runner, phase 2).
// The attachment channels read and write the workspace's own files too (the bytes live in <workspace>/anexos), so they sit behind the same policy.

let store: ForumStore | null = null;

// A person's post can be the answer to a run's question: the runner (which this module knows nothing about) takes the messages that answer and records
// them as answers in the thread. The post is checked before it is shown to anyone; a post that carries attachments is decided here as well (the type
// of the message is decided after the bytes were stored, in `forum:attachment-post`). The files travel with the answer: the runner records them on the
// message it writes, so the answer shows them and a live message keeps them from the retention sweep.
type PostInterceptor = (thread: string, text: string, attachments: AttachmentRef[]) => ForumMessage | null;
let interceptor: PostInterceptor | null = null;

export function interceptPosts(fn: PostInterceptor | null): void {
  interceptor = fn;
}

export function forumStore(): ForumStore {
  store ??= createForumStore(join(ATAS, 'forum'), { redact: (text) => redact(text) });
  return store;
}

/** The anchor of a conversation: what makes a message of another conversation unreachable. Internal; the file name is what a person sees. */
export function threadAnchor(thread: string): string {
  return thread.startsWith('run-') ? `run:${thread.slice(4)}` : `thread:${thread}`;
}

/** A person's post in a thread: `@agent` mentions are resolved against the team, and the message is internal (never mirrored by itself). A `@name` that is no agent of the team is said to be unknown. */
export function personPost(forum: ForumStore, agentIds: readonly string[], thread: unknown, text: unknown) {
  if (typeof thread !== 'string') throw new ForumError('bad-thread', { id: '' });
  if (typeof text !== 'string') throw new ForumError('empty');
  if (text.length > MAX_TEXT) throw new ForumError('too-long', { max: MAX_TEXT });
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: text.trim(), mentions: parseMentions(text, agentIds), anchor: threadAnchor(thread) });
  const unknown = unknownMentions(text, agentIds);
  if (unknown.length) forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'main.forum.mentions.unknown', params: { names: unknown.map((n) => `@${n}`).join(', ') } });
  return message;
}

/** A person's message that carries files: the bytes come first (one call each), then this writes the message and decides its type. */
export function attachmentPost(forum: ForumStore, agentIds: readonly string[], thread: string, text: string, refs: AttachmentRef[]): ForumMessage {
  const storeApi = attachmentStore();
  const limits = getConfig().attachments?.limits ?? ATTACHMENT_LIMITS;
  const body = text.trim();
  if (!body && !refs.length) throw new ForumError('empty');
  if (body.length > MAX_TEXT) throw new ForumError('too-long', { max: MAX_TEXT });
  const total = refs.reduce((n, r) => n + r.bytes, 0);
  if (total > limits.messageBytes) throw new Error(t('main.attachment.messageLimit', { max: Math.round(limits.messageBytes / 1024 / 1024) }));
  if (refs.length > limits.perMessage) throw new Error(t('main.attachment.tooMany', { max: limits.perMessage }));
  // Every ref must hold a file of this conversation, and be the size it says: a ref that points nowhere is refused, nothing is written.
  for (const r of refs) if (!storeApi.holds(thread, r.id, r.bytes)) throw new Error(t('main.attachment.gone'));
  const draft = { kind: 'post' as const, author: { type: 'person' as const }, text: body, mentions: parseMentions(body, agentIds), attachments: refs, anchor: threadAnchor(thread) };
  // A message that answers a run's open question is recorded by the runner: the handler hands it the refs and the runner writes the answer message with them, so
  // the answer carries the files (it shows them, and the retention sees a live message referencing them) and nothing is posted twice. When nothing answers, the
  // message is written here as it stands.
  const answered = interceptor ? interceptor(thread, body, refs) : null;
  if (answered) return answered;
  const [message] = forum.append(thread, draft);
  const unknown = unknownMentions(body, agentIds);
  if (unknown.length) forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'main.forum.mentions.unknown', params: { names: unknown.map((n) => `@${n}`).join(', ') } });
  return message;
}

function ensureGeneral(forum: ForumStore): void {
  forum.ensureThread({ id: GENERAL_THREAD, kind: 'general', title: t('main.forum.generalTitle') });
}

/** The refs a message names, checked against the message and its anchor: a message of another conversation never opens them. */
function refsOfMessage(forum: ForumStore, thread: string, seq: number): ForumMessage | null {
  const read = forum.read(thread, 0, 2000);
  const found = read?.messages.find((m) => m.seq === seq) ?? null;
  if (!found) return null;
  return found.anchor === threadAnchor(thread) ? found : null;
}

export const forumModule: Module = (ctx) => {
  const forum = forumStore();
  forum.subscribe((message) => ctx.emit({ type: 'module', name: FORUM_EVENT, payload: { thread: message.thread, message } satisfies ForumEventPayload }));
  // Every thread, newest activity first. With a squad id, only what is listed under that squad: its channel and its runs' threads. A run's thread belongs to
  // the squad its run is in, which the forum does not know: it is read from the run when the list is made.
  ctx.handle('forum:list', (squad?: unknown): ThreadSummary[] => {
    ensureGeneral(forum);
    const config = getConfig();
    ensureSquadChannels(forum, config.squads ?? [], config.language);
    const runs = runStore();
    const all = forum.list().map((s) => (s.kind === 'run' && s.runId ? { ...s, squad: runs.get(s.runId)?.squad ?? null } : s));
    return typeof squad === 'string' && squad ? all.filter((s) => s.squad === squad) : all;
  });
  ctx.handle('forum:read', (thread: unknown, afterSeq?: unknown, limit?: unknown): ThreadRead | null => {
    if (typeof thread !== 'string') return null;
    return forum.read(thread, typeof afterSeq === 'number' ? afterSeq : 0, typeof limit === 'number' ? limit : undefined);
  });
  ctx.handle('forum:post', (thread: unknown, text: unknown) => {
    const answered = interceptor && typeof thread === 'string' && typeof text === 'string' && text.trim() && text.length <= MAX_TEXT ? interceptor(thread, text, []) : null;
    return answered ?? personPost(forum, getConfig().agents.team.map((a) => a.id), thread, text);
  });
  ctx.handle('forum:create', (title: unknown): ThreadSummary => {
    if (typeof title !== 'string') throw new ForumError('bad-title');
    return forum.createGeneral(title);
  });
  // Deleting a message deletes its files from disk: the store records the removal and hands back what the message carried, and those files go with it. The refs
  // come from the stored message, never from the caller, so a seq of another conversation cannot name a file here.
  ctx.handle('forum:attachment-delete', (thread: unknown, seq: unknown): boolean => {
    if (typeof thread !== 'string' || !Number.isInteger(seq)) return false;
    const removed = forum.remove(thread, seq as number);
    if (!removed || removed.anchor !== threadAnchor(thread)) return false;
    attachmentStore().dropAll(thread, removed.attachments ?? []);
    return true;
  });

  // --- the attachment channels: the bytes travel base64 in one call each, so the 15 MB body cap is never approached.
  ctx.handle('forum:attachment-put', (thread: unknown, name: unknown, dataBase64: unknown): AttachmentRef => {
    if (typeof thread !== 'string') throw new ForumError('bad-thread', { id: '' });
    if (typeof dataBase64 !== 'string') throw new Error(t('main.attachment.gone'));
    const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
    const storeApi = attachmentStore();
    const limits = getConfig().attachments?.limits ?? ATTACHMENT_LIMITS;
    const used = storeApi.list(thread).reduce((n, r) => n + r.bytes, 0);
    return storeApi.put(thread, name, bytes, { messageBytes: used, count: storeApi.list(thread).length });
  });
  ctx.handle('forum:attachment-post', (thread: unknown, text: unknown, ids: unknown): ForumMessage => {
    if (typeof thread !== 'string') throw new ForumError('bad-thread', { id: '' });
    if (typeof text !== 'string') throw new ForumError('empty');
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    const storeApi = attachmentStore();
    const have = storeApi.list(thread);
    const refs = list.map((id) => have.find((r) => r.id === id)).filter((r): r is AttachmentRef => !!r);
    // An id the conversation no longer holds is a file the person took out: the message is not written with it silently missing.
    if (refs.length !== list.length) throw new Error(t('main.attachment.gone'));
    return attachmentPost(forum, getConfig().agents.team.map((a) => a.id), thread, text, refs);
  });
  ctx.handle('forum:attachment-drop', (thread: unknown, ids: unknown): void => {
    if (typeof thread !== 'string') return;
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    for (const id of list) attachmentStore().drop(thread, id);
  });
  ctx.handle('forum:attachment-get', (thread: unknown, message: unknown, id: unknown): { data: string; ref: AttachmentRef } | null => {
    if (typeof thread !== 'string' || typeof message !== 'number' || typeof id !== 'string') return null;
    const found = refsOfMessage(forum, thread, message);
    if (!found || !found.attachments.some((a) => a.id === id)) return null;
    const read = attachmentStore().get(thread, id);
    if (!read) return null;
    return { data: Buffer.from(read.bytes).toString('base64'), ref: read.ref };
  });
};
