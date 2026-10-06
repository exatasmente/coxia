// An `@agent` in a channel or a general conversation: the named agent answers in the same thread, read only; an `@name` that is no agent of the team is said to be
// unknown; at most three agents per message.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { MAX_MENTIONS, parseMentions, unknownMentions, type ForumMessage } from '../src/shared/forum';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { personPost } from '../src/main/forum';
import { answerMentions } from '../src/main/mentions/answer';
import { callsOf } from '../src/main/mentions/module';
import type { MentionPlace } from '../src/main/mentions/place';
import { PartialAnswer, fakeEngine } from './helpers/runner';

let dir: string;
let forum: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-mentions-'));
  forum = createForumStore(dir);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const config = () => {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = c.agents.team.map((a) => ({ ...a, permission: 'read' as const }));
  c.projects.repos = [];
  return c;
};

const place: MentionPlace = { thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' };

const personMessage = (thread: string, text: string, mentions: string[]): ForumMessage => {
  forum.ensureThread({ id: thread, kind: thread === 'squads' ? 'channel' : 'general', title: thread });
  const [m] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text, mentions });
  return m;
};

const answered = (thread: string): ForumMessage[] => (forum.read(thread, 0, 2000)?.messages ?? []).filter((m) => m.author.type === 'agent');

describe('the names a message calls', () => {
  it('are the first three of a person post, and none of an agent post', () => {
    const person = personMessage('squads', '@turn @reply @deep @teams', ['turn', 'reply', 'deep', 'teams']);
    expect(callsOf(person)).toEqual(['turn', 'reply', 'deep']);
    const agent = forum.append('squads', { kind: 'post', author: { type: 'agent', id: 'turn' }, text: '@reply help', mentions: ['reply'] })[0];
    expect(callsOf(agent)).toEqual([]);
  });

  it('are none of a message with no mention', () => {
    expect(callsOf(personMessage('squads', 'hello', []))).toEqual([]);
  });
});

describe('unknown names', () => {
  it('are the ones no agent of the team has, once, and never an address or a path', () => {
    expect(unknownMentions('@ana@example.com @missing and @missing again', ['ana'])).toEqual(['missing']);
    expect(unknownMentions('see src/@thing and @real', ['real'])).toEqual([]);
    expect(unknownMentions('@Real', ['real'])).toEqual([]);
  });

  it('are said to be unknown under the person post', () => {
    forum.ensureThread({ id: 'general', kind: 'general', title: 'General' });
    personPost(forum, ['real'], 'general', '@real look at @ghost');
    const line = (forum.read('general', 0, 100)?.messages ?? []).find((m) => m.kind === 'system');
    expect(line?.code).toBe('main.forum.mentions.unknown');
    expect(line?.params).toEqual({ names: '@ghost' });
  });
});

describe('the answer in another thread', () => {
  it('posts what the named agent said, read only, and never an issue', async () => {
    const engine = fakeEngine();
    engine.script('turn', () => ({ text: 'Here is what I read.' }));
    const message = personMessage('squads', '@turn check this', ['turn']);
    await answerMentions(place, message, { forum, config, engine, env: () => ({ fallbackCwd: dir }) });
    const posts = answered('squads');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ text: 'Here is what I read.', public: false, mentions: [] });
    expect(posts[0].author).toEqual({ type: 'agent', id: 'turn' });
    expect(engine.calls[0].confine).toBeUndefined();
    // a channel has no worktree to be confined to: the caller gives no read root, and the mention keeps the policy of the ceremonies
    expect(engine.calls[0].readRoot).toBeUndefined();
    expect(engine.calls[0].prompt).toContain('@turn check this');
  });

  it('gives the call the read-turn limit of the runner settings, and the wrap-up when the model runs out', async () => {
    const engine = fakeEngine();
    engine.script('turn', () => ({ text: 'Fine.' }));
    const c = config();
    c.runner.turns.read = 7;
    await answerMentions(place, personMessage('squads', '@turn hi', ['turn']), { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }) });
    expect(engine.calls[0].maxTurns).toBe(7);
    expect(engine.calls[0].wrapUp).toBe(true);
  });

  it('posts the wrap-up answer like any other and says in the thread that it may be incomplete', async () => {
    const engine = fakeEngine();
    engine.script('turn', () => new PartialAnswer({ text: 'What I read so far.' }));
    await answerMentions(place, personMessage('squads', '@turn hi', ['turn']), { forum, config, engine, env: () => ({ fallbackCwd: dir }) });
    const lines = forum.read('squads', 0, 200)?.messages ?? [];
    expect(answered('squads')).toHaveLength(1);
    expect(answered('squads')[0].text).toBe('What I read so far.');
    expect(lines.find((m) => m.code === 'runner.partial')).toMatchObject({ kind: 'system', params: { agent: 'turn' } });
    expect(lines.some((m) => m.code === 'runner.mentionFailed')).toBe(false);
  });

  it('says the failure with its reason when the wrap-up fails too, and posts no answer', async () => {
    const engine = fakeEngine();
    engine.script('turn', () => {
      throw new Error('stopped at the step limit; the attempt at a partial answer also failed (the model is down)');
    });
    await answerMentions(place, personMessage('squads', '@turn hi', ['turn']), { forum, config, engine, env: () => ({ fallbackCwd: dir }) });
    const lines = forum.read('squads', 0, 200)?.messages ?? [];
    expect(lines.find((m) => m.code === 'runner.mentionFailed')?.params.reason).toContain('the model is down');
    expect(answered('squads')).toEqual([]);
    expect(lines.some((m) => m.code === 'runner.partial')).toBe(false);
  });

  it('answers nobody when the mention names no agent of the team', async () => {
    const engine = fakeEngine();
    const message = personMessage('squads', '@ghost hi', []);
    const out = await answerMentions(place, message, { forum, config, engine, env: () => ({ fallbackCwd: dir }) });
    expect(out).toEqual([]);
    expect(engine.calls).toHaveLength(0);
  });

  it('says a failed answer and goes on to the next name', async () => {
    const engine = fakeEngine();
    engine.script('reply', () => ({ text: 'The second one.' }));
    const message = personMessage('squads', '@turn @reply', ['turn', 'reply']);
    await answerMentions(place, message, { forum, config, engine, env: () => ({ fallbackCwd: dir }) });
    const lines = forum.read('squads', 0, 200)?.messages ?? [];
    expect(lines.some((m) => m.code === 'runner.mentionFailed' && m.params.agent === 'turn')).toBe(true);
    expect(answered('squads').some((m) => m.text === 'The second one.')).toBe(true);
  });

  it('takes a fragment of the parser as the whole rule: exactly the mentions a person wrote', () => {
    expect(parseMentions('@turn and @reply', ['turn', 'reply'])).toEqual(['turn', 'reply']);
    expect(MAX_MENTIONS).toBe(3);
  });
});
