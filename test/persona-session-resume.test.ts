// The persona's conversation keeps one Claude Code session (#279), through the real answerMentions over a fake engine: the next answer continues the session of the last one
// and is sent only what came after it, each conversation has its own, another provider or the open engine opens a new one, a stopped or failed answer keeps the session
// before it, and the message held by a Stop and let go by Resume follows the same rule. Session ids are the fake engine's own; nothing of a real session is read.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { AgentCall } from '../src/main/agents';
import { prompt as cp } from '../src/main/cyclePrompts';
import { type ForumStore, createForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { type MentionDeps, answerMentions } from '../src/main/mentions/answer';
import { placeOfThread } from '../src/main/mentions/place';
import { createCallStops } from '../src/main/mentions/stop';
import { createPersonaLive } from '../src/main/persona/live';
import type { ScreenFacts } from '../src/main/persona/openScreen';
import { type SessionKeep, createSessionKeep } from '../src/main/persona/sessionKeep';
import { fakeEngine } from './helpers/runner';

const FACTS: ScreenFacts = {
  ceremonies: () => ({ preDaily: true, unblock: true, gate: true, qaHandoff: false, retro: false, releaseConflicts: true }),
  ceremonyName: (id) => id,
  cards: async () => [],
  run: () => false,
  conflict: () => false,
  thread: () => true,
};

let root: string;
let forum: ForumStore;
let keep: SessionKeep;
let config: WorkspaceConfig;
let engine: ReturnType<typeof fakeEngine>;
let target: { engine: 'claude-sdk' | 'open'; provider: string };

const persona = (over: Partial<AgentDef> = {}): AgentDef => newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person', ...over });

beforeEach(() => {
  setLanguage('en');
  root = mkdtempSync(join(tmpdir(), 'persona-session-resume-'));
  forum = createForumStore(join(root, 'forum'));
  keep = createSessionKeep(join(root, 'persona-sessions.json'));
  const base = neutralConfig();
  config = { ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, persona(), newAgent({ id: 'other', name: 'Other', kind: 'persona', instructions: 'x', draft: true })] } };
  engine = fakeEngine();
  engine.script('me', () => 'ok');
  engine.script('other', () => 'ok');
  target = { engine: 'claude-sdk', provider: 'cli' };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const deps = (over: Partial<MentionDeps> = {}, sessions = true): MentionDeps => ({
  forum,
  config: () => config,
  engine,
  env: () => ({ fallbackCwd: root }),
  persona: { live: createPersonaLive({ emit: () => undefined, redact: (t) => t }), screens: FACTS, ...(sessions ? { sessions: { keep, target: () => target } } : {}) },
  ...over,
});

/** The person writes in a conversation and the agent of it answers. */
async function say(text: string, o: { agent?: string; thread?: string; sessions?: boolean; over?: Partial<MentionDeps> } = {}): Promise<ForumMessage> {
  const agent = o.agent ?? 'me';
  const thread = o.thread ?? agentThreadId(agent);
  ensureAgentThread(forum, { id: agent, name: agent }, 'en');
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text });
  const place = placeOfThread(forum.summary(thread), () => null, config);
  if (!place) throw new Error('no place');
  await answerMentions(place, message, deps({ calls: [agent], ...o.over }, o.sessions ?? true));
  return message;
}

const sessionOf = (call: AgentCall) => call.resume?.session;
const messages = (thread = agentThreadId('me')) => forum.read(thread, 0, 2000)?.messages ?? [];

describe('one session per conversation', () => {
  it('today, with no sessions kept, three messages open three sessions', async () => {
    await say('one', { sessions: false });
    await say('two', { sessions: false });
    await say('three', { sessions: false });
    expect(engine.calls.map(sessionOf)).toEqual([undefined, undefined, undefined]);
  });

  it('continues the session of the first answer for the second and the third, in conversation mode with a fallback', async () => {
    await say('one');
    await say('two');
    await say('three');
    expect(engine.calls.map(sessionOf)).toEqual([undefined, 'session-1', 'session-1']);
    expect(engine.calls[1].resume).toMatchObject({ engine: 'claude-sdk', mode: 'conversation' });
    expect(engine.calls[1].resume?.fallback?.prompt).toContain('one');
    // The kept session knows the conversation up to the last answer.
    const answers = messages().filter((m) => m.author.type === 'agent');
    expect(keep.get(agentThreadId('me'))).toEqual({ session: 'session-1', engine: 'claude-sdk', provider: 'cli', upTo: answers.at(-1)?.seq });
  });

  it('sends a continued session only what came after its last answer, and a new session the whole conversation', async () => {
    await say('first question about apples');
    forum.append(agentThreadId('me'), { kind: 'post', author: { type: 'person' }, text: 'a note about plums' });
    await say('second question about pears');
    const [first, second] = engine.calls;
    const since = cp('runner.section.threadSince', { text: '' }).split('\n')[0];
    expect(first.prompt).toContain('apples');
    // The continued call: what was said in between is there, the earlier question is not (the session has it), and the section says so.
    expect(second.prompt).toContain('pears');
    expect(second.prompt).toContain('plums');
    expect(second.prompt).not.toContain('apples');
    expect(second.prompt).toContain(since);
    // Its fallback is the whole conversation, as an answer always had it.
    expect(second.resume?.fallback?.prompt).toContain('apples');
    expect(second.resume?.fallback?.prompt).not.toContain(since);
  });

  it('keeps a session per conversation: two conversations never share one', async () => {
    await say('hello', { thread: agentThreadId('me') });
    keep.set('general-elsewhere', { session: 's-b', engine: 'claude-sdk', provider: 'cli', upTo: 1 });
    await say('again', { thread: agentThreadId('me') });
    expect(engine.calls.map(sessionOf)).toEqual([undefined, 'session-1']);
    expect(keep.get('general-elsewhere')?.session).toBe('s-b');
  });

  it('opens a new session when the provider changed, and keeps that one from then on', async () => {
    await say('one');
    target = { engine: 'claude-sdk', provider: 'keyed' };
    await say('two');
    await say('three');
    expect(engine.calls.map(sessionOf)).toEqual([undefined, undefined, 'session-2']);
    expect(keep.get(agentThreadId('me'))?.provider).toBe('keyed');
  });

  it('opens a new session when the conversation no longer has the message the session knows up to', async () => {
    keep.set(agentThreadId('me'), { session: 's-a', engine: 'claude-sdk', provider: 'cli', upTo: 999 });
    await say('one');
    expect(engine.calls.map(sessionOf)).toEqual([undefined]);
  });

  it('keeps the session before a failed answer', async () => {
    await say('one');
    engine.script('me', () => 'ok', () => {
      throw new Error('upstream exploded');
    }, () => 'ok');
    await say('two');
    expect(messages().some((m) => m.code === 'runner.mentionFailed')).toBe(true);
    await say('three');
    expect(engine.calls.map(sessionOf)).toEqual([undefined, 'session-1', 'session-1']);
    // The failed turn is in what the third answer is sent.
    expect(engine.calls[2].prompt).toContain('two');
  });

  it('leaves the open engine as it was: no session continued and none kept', async () => {
    target = { engine: 'open', provider: 'local' };
    await say('one');
    await say('two');
    expect(engine.calls.map(sessionOf)).toEqual([undefined, undefined]);
    expect(keep.get(agentThreadId('me'))).toBeNull();
  });

  it('never keeps a session for the persona\'s test copy', async () => {
    await say('one', { agent: 'other' });
    await say('two', { agent: 'other' });
    expect(engine.calls.map(sessionOf)).toEqual([undefined, undefined]);
    expect(keep.get(agentThreadId('other'))).toBeNull();
  });
});

describe('after a Stop', () => {
  it('a stopped answer keeps the session before it, and the next answer continues it with what was cut', async () => {
    const stops = createCallStops();
    await say('one');
    engine.script(
      'me',
      () => 'ok',
      async (call: AgentCall) => {
        call.text?.piece('Half of the plan');
        await new Promise((_, reject) => {
          call.abort?.signal.addEventListener('abort', () => reject(new Error('aborted')));
          stops.stop(agentThreadId('me'), 'me');
        });
        return 'never';
      },
      () => 'back',
    );
    await say('two', { over: { stops } });
    expect(messages().some((m) => m.text === 'Half of the plan')).toBe(true);
    // The message held by the Stop, let go by Resume, goes through the same answer.
    await say('three');
    expect(engine.calls.map(sessionOf)).toEqual([undefined, 'session-1', 'session-1']);
    expect(engine.calls[2].prompt).toContain('Half of the plan');
    expect(keep.get(agentThreadId('me'))?.session).toBe('session-1');
  });
});
