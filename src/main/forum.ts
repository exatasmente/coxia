import { join } from 'node:path';
import { FORUM_EVENT, GENERAL_THREAD, MAX_TEXT, type ForumEventPayload, type ForumMessage, type ThreadRead, type ThreadSummary, parseMentions, unknownMentions } from '../shared/forum';
import { t } from '../shared/i18n';
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

let store: ForumStore | null = null;

// A person's post can be the answer to a run's question: the runner (which this module knows nothing about) asks to see each post first and
// takes the ones that answer, recording them as answers in the thread. The post is checked before it is shown to anyone.
type PostInterceptor = (thread: string, text: string) => ForumMessage | null;
let interceptor: PostInterceptor | null = null;

export function interceptPosts(fn: PostInterceptor | null): void {
  interceptor = fn;
}

export function forumStore(): ForumStore {
  store ??= createForumStore(join(ATAS, 'forum'), { redact: (text) => redact(text) });
  return store;
}

/** A person's post in a thread: `@agent` mentions are resolved against the team, and the message is internal (never mirrored by itself). A `@name` that is no agent of the team is said to be unknown. */
export function personPost(forum: ForumStore, agentIds: readonly string[], thread: unknown, text: unknown) {
  if (typeof thread !== 'string') throw new ForumError('bad-thread', { id: '' });
  if (typeof text !== 'string') throw new ForumError('empty');
  if (text.length > MAX_TEXT) throw new ForumError('too-long', { max: MAX_TEXT });
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: text.trim(), mentions: parseMentions(text, agentIds) });
  const unknown = unknownMentions(text, agentIds);
  if (unknown.length) forum.append(thread, { kind: 'system', author: { type: 'app' }, code: 'main.forum.mentions.unknown', params: { names: unknown.map((n) => `@${n}`).join(', ') } });
  return message;
}

function ensureGeneral(forum: ForumStore): void {
  forum.ensureThread({ id: GENERAL_THREAD, kind: 'general', title: t('main.forum.generalTitle') });
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
    const answered = interceptor && typeof thread === 'string' && typeof text === 'string' && text.trim() && text.length <= MAX_TEXT ? interceptor(thread, text) : null;
    return answered ?? personPost(forum, getConfig().agents.team.map((a) => a.id), thread, text);
  });
  ctx.handle('forum:create', (title: unknown): ThreadSummary => {
    if (typeof title !== 'string') throw new ForumError('bad-title');
    return forum.createGeneral(title);
  });
};
