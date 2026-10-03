import { join } from 'node:path';
import { FORUM_EVENT, GENERAL_THREAD, MAX_TEXT, type ForumEventPayload, type ThreadRead, type ThreadSummary, parseMentions } from '../shared/forum';
import { t } from '../shared/i18n';
import { ATAS } from './env';
import { redact } from './errorlog-core';
import { ForumError, type ForumStore, createForumStore } from './forum-core';
import type { Module } from './module';
import { getConfig } from './workspaceConfig';

// The forum of the running workspace: <workspace>/forum/<thread>.jsonl. The channels below are local reads and writes of the workspace's own
// folder, so a paired browser may use them (webPolicy.ts leaves them open, test/forum-policy.test.ts pins it): the phone is where a person answers.
// A post only ever says something; an agent a mention calls on answers read-only, whatever its own permission (the runner, phase 2).

let store: ForumStore | null = null;

export function forumStore(): ForumStore {
  store ??= createForumStore(join(ATAS, 'forum'), { redact: (text) => redact(text) });
  return store;
}

/** A person's post in a thread: `@agent` mentions are resolved against the team, and the message is internal (never mirrored by itself). */
export function personPost(forum: ForumStore, agentIds: readonly string[], thread: unknown, text: unknown) {
  if (typeof thread !== 'string') throw new ForumError('bad-thread', { id: '' });
  if (typeof text !== 'string') throw new ForumError('empty');
  if (text.length > MAX_TEXT) throw new ForumError('too-long', { max: MAX_TEXT });
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: text.trim(), mentions: parseMentions(text, agentIds) });
  return message;
}

function ensureGeneral(forum: ForumStore): void {
  forum.ensureThread({ id: GENERAL_THREAD, kind: 'general', title: t('main.forum.generalTitle') });
}

export const forumModule: Module = (ctx) => {
  const forum = forumStore();
  forum.subscribe((message) => ctx.emit({ type: 'module', name: FORUM_EVENT, payload: { thread: message.thread, message } satisfies ForumEventPayload }));
  ctx.handle('forum:list', (): ThreadSummary[] => {
    ensureGeneral(forum);
    return forum.list();
  });
  ctx.handle('forum:read', (thread: unknown, afterSeq?: unknown, limit?: unknown): ThreadRead | null => {
    if (typeof thread !== 'string') return null;
    return forum.read(thread, typeof afterSeq === 'number' ? afterSeq : 0, typeof limit === 'number' ? limit : undefined);
  });
  ctx.handle('forum:post', (thread: unknown, text: unknown) => personPost(forum, getConfig().agents.team.map((a) => a.id), thread, text));
  ctx.handle('forum:create', (title: unknown): ThreadSummary => {
    if (typeof title !== 'string') throw new ForumError('bad-title');
    return forum.createGeneral(title);
  });
};
