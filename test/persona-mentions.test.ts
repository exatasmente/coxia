// The persona's answer, through the real answerMentions and the real engine against a fake OpenAI server: plain Markdown with no schema and no proposals, stored once with
// the message it answers and the buttons it offered, streamed while it is written, stopped with what was written kept, failed with nothing kept. Every other agent's direct
// conversation still answers with the structured object and its proposals.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActivityEntry, mentionJob } from '../src/shared/activity';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { type ForumMessage, agentThreadId, isInterrupted } from '../src/shared/forum';
import { type LiveAnswer, type LiveEvent, applyLive } from '../src/shared/persona';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { personPost } from '../src/main/forum';
import { t } from '../src/shared/i18n';
import { createPersonaLive } from '../src/main/persona/live';
import { BUTTON_SCREENS, type ScreenFacts } from '../src/main/persona/openScreen';
import { createCallStops } from '../src/main/mentions/stop';
import { type Fake, type Step, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';
import { fakeEngine } from './helpers/runner';

let home: string;
let fake: Fake;
let agents: typeof import('../src/main/agents');
let log: typeof import('../src/main/activity');
let answer: typeof import('../src/main/mentions/answer');
let place: typeof import('../src/main/mentions/place');
let forum: ForumStore;
let script: (req: Fake['requests'][number]) => Step = () => textStep('ok');
let pushed: ActivityEntry[] = [];
let events: LiveEvent[] = [];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-mentions-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => script(req));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  agents = await import('../src/main/agents');
  log = await import('../src/main/activity');
  answer = await import('../src/main/mentions/answer');
  place = await import('../src/main/mentions/place');
  // A neutral workspace in English: the texts the model reads are in the workspace's language, and none of this computer's own documentation is a source.
  const base = neutralConfig();
  (await import('../src/main/workspaceConfig')).saveConfig({ ...base, language: 'en' });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  forum = createForumStore(join(home, `forum-${Math.random().toString(36).slice(2)}`));
  fake.requests.length = 0;
  pushed = [];
  events = [];
  log.activityLog.clear();
  log.activityLog.setSink((e) => pushed.push(e));
});

const persona = (over: Partial<AgentDef> = {}): AgentDef => newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'The person is a maintainer who never wants a surprise.', ...over });

function config(extra: AgentDef[] = [persona()]): WorkspaceConfig {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = [...c.agents.team.map((a) => ({ ...a, permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const })), ...extra];
  c.projects.repos = [];
  return c;
}

const FACTS: ScreenFacts = {
  ceremonies: () => ({ preDaily: true, unblock: true, gate: true, qaHandoff: false, retro: false, releaseConflicts: true }),
  ceremonyName: (id) => (id === 'preDaily' ? 'morning sync' : t(`main.persona.openScreen.ceremony.${id}`)),
  cards: async () => ['app#1', 'app#2'],
  run: (id) => id === 'r1',
  conflict: () => false,
  thread: () => true,
};

const live = () => createPersonaLive({ emit: (e) => events.push(e), redact: (t) => t });

/** One answer of `id` in its direct conversation, over the real engine. */
async function ask(c: WorkspaceConfig, id: string, text: string, over: Partial<Parameters<typeof answer.answerMentions>[2]> = {}) {
  ensureAgentThread(forum, { id, name: id }, 'en');
  const thread = agentThreadId(id);
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text });
  const where = place.placeOfThread(forum.summary(thread), () => null, c)!;
  const line = log.beginCallActivity(id, { jobId: mentionJob(thread), call: { agent: id, thread, message: message.seq }, node: { type: 'call', label: text }, isSecretPath: (p) => agents.secretPath(p, home) });
  line.status('started');
  const out = await answer.answerMentions(where, message, { forum, config: () => c, engine: agents.runAgent, env: () => ({ fallbackCwd: home }), calls: [id], callOf: () => ({ activity: line, queued: false }), ...over });
  return { thread, message, out, line, posts: () => (forum.read(thread, 0, 2000)?.messages ?? []).filter((m) => m.author.type === 'agent'), all: () => forum.read(thread, 0, 2000)?.messages ?? [] };
}

const toolNames = (req: Fake['requests'][number]): string[] => ((req.body?.tools ?? []) as { function: { name: string } }[]).map((x) => x.function.name);
const code = (messages: ForumMessage[], c: string) => messages.find((m) => m.code === c);

describe('the persona\'s answer is plain text', () => {
  it('asks the model for no structured answer and no proposals, and stores the Markdown as written, once, with the message it answers', async () => {
    const TEXT = 'Here is **the plan**:\n\n- one\n- two\n\n```ts\nconst a = 1;\n```';
    script = () => textStep(TEXT, { pieces: 5 });
    const c = config();
    const r = await ask(c, 'me', 'What should we do today?', { persona: { live: live(), screens: FACTS } });
    const body = fake.chats()[0].body as Record<string, any>;
    expect(body.response_format).toBeUndefined();
    expect(toolNames(fake.chats()[0])).not.toContain('final_answer');
    expect(JSON.stringify(body.messages)).not.toContain('proposals');
    expect(r.out).toEqual([{ agent: 'me', text: TEXT }]);
    const posts = r.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ text: TEXT, kind: 'post', answersTo: r.message.seq });
    expect(posts[0].buttons).toBeUndefined();
    // the call is the persona's: its words, not a thread's
    const system = String(body.messages[0].content);
    // hermetic: nothing of the machine's own documentation reaches the fake model
    expect(system).not.toContain('Contents of /');
    expect(system).toContain("the person's representative");
    expect(system).toContain('never wants a surprise');
    // the persona's own text, and none of the thread's: it says nothing of proposals or of an activity's thread
    const own = system.slice(system.indexOf('You are Me'));
    expect(own).not.toMatch(/propos/i);
    expect(own).not.toContain('thread of the activity');
  });

  it('never asks for a write: tracker read does not give the persona a proposals field', async () => {
    script = () => textStep('Read only.');
    const c = config([persona({ tracker: 'read' })]);
    const propose = vi.fn(async () => []);
    const r = await ask(c, 'me', 'Close #5, please', { persona: { live: live(), screens: FACTS }, propose });
    expect(propose).not.toHaveBeenCalled();
    expect(r.posts()).toHaveLength(1);
  });

  it('another agent\'s direct conversation still answers with the structured object and its proposals', async () => {
    const c = config([persona(), newAgent({ id: 'helper', name: 'Helper', tracker: 'read' })]);
    const engine = fakeEngine();
    engine.script('helper', () => ({ text: 'Structured.', proposals: [] }));
    ensureAgentThread(forum, { id: 'helper', name: 'Helper' }, 'en');
    const thread = agentThreadId('helper');
    const [m] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'hi' });
    await answer.answerMentions(place.placeOfThread(forum.summary(thread), () => null, c)!, m, { forum, config: () => c, engine, env: () => ({ fallbackCwd: home }), calls: ['helper'], propose: async () => [], persona: { live: live(), screens: FACTS } });
    expect(engine.calls[0].schema).toMatchObject({ properties: { text: { type: 'string' }, proposals: expect.anything() } });
    expect(engine.calls[0].text).toBeUndefined();
    const post = (forum.read(thread, 0, 100)?.messages ?? []).find((x) => x.author.type === 'agent') as ForumMessage;
    expect(post.text).toBe('Structured.');
    expect(post.answersTo).toBeUndefined();
    expect(post.buttons).toBeUndefined();
  });

  it('turns an answer that is a JSON object with a text field into its text, as every answer does', async () => {
    script = () => textStep('{"text":"Unwrapped."}');
    const r = await ask(config(), 'me', 'hi', { persona: { live: live(), screens: FACTS } });
    expect(r.posts()[0].text).toBe('Unwrapped.');
  });
});

describe('the answer streams while it is written', () => {
  it('publishes the text as it grows and ends on the stored text, with no stored message but the answer', async () => {
    const TEXT = 'The quick brown fox jumps over the lazy dog, and then it sleeps.';
    script = () => textStep(TEXT, { pieces: 5 });
    const store = live();
    const r = await ask(config(), 'me', 'tell me', { persona: { live: store, screens: FACTS } });
    const written = events.filter((e) => !e.end);
    expect(written.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ end: true, thread: r.thread, to: r.message.seq, agent: 'me' });
    // what a device that applied every event holds, before the end, is the stored text
    let state: LiveAnswer | null = null;
    for (const e of written) state = applyLive(state, e).state;
    expect(state?.text).toBe(r.posts()[0].text);
    expect(state?.text).toBe(TEXT);
    // the live text is never a message of its own
    expect(r.all().map((m) => m.kind)).toEqual(['post', 'post']);
    expect(store.read(r.thread)).toEqual([]);
  });

  it('moves the text of a tool turn to the activity: the bubble holds only the next turn', async () => {
    script = (req) => (req.body?.messages.some((m: { role: string }) => m.role === 'tool') ? textStep('It is Friday.', { pieces: 3 }) : toolStep([{ id: 'p1', name: 'procedures_list', args: {} }], { text: 'Let me check my notes first. ' }));
    const r = await ask(config(), 'me', 'When is the release?', { persona: { live: live(), screens: FACTS }, procedures: undefined });
    expect(r.posts()[0].text).toBe('It is Friday.');
    // After the tool turn the text on every device is the second turn's alone.
    let state: LiveAnswer | null = null;
    let sawNarration = false;
    for (const e of events.filter((x) => !x.end)) {
      state = applyLive(state, e).state;
      if (state?.text.includes('Let me check')) sawNarration = true;
    }
    expect(state?.text).toBe('It is Friday.');
    void sawNarration;
  });
});

describe('the buttons', () => {
  it('stores what OpenScreen offered with the answer, worded by the app (targets only), and says nothing was opened', async () => {
    script = (req) => (req.body?.messages.some((m: { role: string }) => m.role === 'tool') ? textStep('The button is under this answer.') : toolStep([{ id: 'b1', name: 'OpenScreen', args: { to: 'call' } }, { id: 'b2', name: 'OpenScreen', args: { to: 'deep', ref: 'app#2' } }]));
    const r = await ask(config(), 'me', 'start the pre-daily', { persona: { live: live(), screens: FACTS } });
    const post = r.posts()[0];
    expect(post.text).toBe('The button is under this answer.');
    expect(post.buttons).toEqual([{ to: 'call' }, { to: 'deep', ref: 'app#2' }]);
    expect(toolNames(fake.chats()[0])).toContain('OpenScreen');
    // the call line shows the tool, like any other
    expect(pushed.some((e) => e.kind === 'tool' && e.label.startsWith('OpenScreen'))).toBe(true);
  });

  it('refuses a ceremony the cycle has turned off, a card that is not loaded and a made-up screen, with the reason, and stores no button', async () => {
    const answers: string[] = [];
    script = (req) => {
      const tool = (req.body?.messages ?? []).filter((m: { role: string }) => m.role === 'tool');
      if (!tool.length) return toolStep([{ id: 'r1', name: 'OpenScreen', args: { to: 'retro' } }, { id: 'r2', name: 'OpenScreen', args: { to: 'qa', ref: 'app#9' } }, { id: 'r3', name: 'OpenScreen', args: { to: 'nowhere' } }, { id: 'r4', name: 'OpenScreen', args: { to: 'deep' } }, { id: 'r5', name: 'OpenScreen', args: { to: 'gate', ref: 'app#9' } }]);
      answers.push(...tool.map((m: { content: string }) => m.content));
      return textStep('I could not open them.');
    };
    const r = await ask(config(), 'me', 'open the retro, the qa of 9 and a thing', { persona: { live: live(), screens: FACTS } });
    expect(r.posts()[0].buttons).toBeUndefined();
    const said = answers.join('\n');
    expect(said).toContain(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.retro') }));
    expect(said).toContain(t('main.persona.openScreen.off', { ceremony: t('main.persona.openScreen.ceremony.qaHandoff') }));
    // a name the tool does not list is stopped by its own parameters, before it runs
    expect(said).toMatch(/\$\.to/);
    expect(said).toContain(t('main.persona.openScreen.invalid', { to: 'deep', list: BUTTON_SCREENS.join(', ') }));
    expect(said).toContain(t('main.persona.openScreen.noCard', { ref: 'app#9', list: 'app#1, app#2' }));
  });

  it('offers a persona being tested no button tool, and the real persona its own', async () => {
    script = () => textStep('ok');
    const c = config([persona(), persona({ id: 'me-test', name: 'Me (test)', draft: true })]);
    await ask(c, 'me-test', 'hello', { persona: { live: live(), screens: FACTS } });
    expect(toolNames(fake.chats()[0])).not.toContain('OpenScreen');
    expect(String(fake.chats()[0].body?.messages[0].content)).not.toContain('OpenScreen');
    fake.requests.length = 0;
    await ask(c, 'me', 'hello', { persona: { live: live(), screens: FACTS } });
    expect(toolNames(fake.chats()[0])).toContain('OpenScreen');
    expect(String(fake.chats()[0].body?.messages[0].content)).toContain('OpenScreen');
  });

  it('keeps at most four buttons, each target once', async () => {
    script = (req) =>
      req.body?.messages.some((m: { role: string }) => m.role === 'tool')
        ? textStep('Buttons.')
        : toolStep(['call', 'call', 'board', 'procedures', 'memory', 'history'].map((to, i) => ({ id: `t${i}`, name: 'OpenScreen', args: { to } })));
    const r = await ask(config(), 'me', 'give me everything', { persona: { live: live(), screens: FACTS } });
    expect(r.posts()[0].buttons).toEqual([{ to: 'call' }, { to: 'board' }, { to: 'procedures' }, { to: 'memory' }]);
  });
});

describe('stop and failure', () => {
  const stops = createCallStops();

  it('posts what had been written as the persona\'s message when the person stops, with the line that says it was cut', async () => {
    const store = live();
    const engine = async (call: Parameters<typeof agents.runAgent>[0]) => {
      call.text?.piece('Part one is done and ');
      call.text?.piece('part two is half');
      await new Promise((_, reject) => {
        call.abort?.signal.addEventListener('abort', () => reject(new Error('aborted')));
        stops.stop(agentThreadId('me'), 'me');
      });
      return { data: '', sessionId: 's', sources: [] };
    };
    const r = await ask(config(), 'me', 'write it', { persona: { live: store, screens: FACTS }, engine: engine as never, stops });
    const messages = r.all();
    const post = messages.find((m) => m.author.type === 'agent') as ForumMessage;
    expect(post).toMatchObject({ text: 'Part one is done and part two is half', answersTo: r.message.seq, params: { interrupted: 'stop' } });
    expect(isInterrupted(post)).toBe(true);
    expect(code(messages, 'runner.mention.stoppedPartial')).toBeTruthy();
    expect(code(messages, 'runner.mention.stopped')).toBeUndefined();
    expect(events.at(-1)?.end).toBe(true);
    expect(store.read(r.thread)).toEqual([]);
    // the next message is answered
    script = () => textStep('Back again.');
    const next = await ask(config(), 'me', 'and now?', { persona: { live: store, screens: FACTS } });
    expect(next.posts().at(-1)?.text).toBe('Back again.');
  });

  it('posts only the stopped line when nothing had been written', async () => {
    const engine = async (call: Parameters<typeof agents.runAgent>[0]) => {
      await new Promise((_, reject) => {
        call.abort?.signal.addEventListener('abort', () => reject(new Error('aborted')));
        stops.stop(agentThreadId('me'), 'me');
      });
      return { data: '', sessionId: 's', sources: [] };
    };
    const r = await ask(config(), 'me', 'write it', { persona: { live: live(), screens: FACTS }, engine: engine as never, stops });
    expect(r.posts()).toHaveLength(0);
    expect(code(r.all(), 'runner.mention.stopped')).toBeTruthy();
    expect(code(r.all(), 'runner.mention.stoppedPartial')).toBeUndefined();
  });

  it('posts the failure line and none of the text when the call fails, and the bubble goes', async () => {
    const store = live();
    const engine = async (call: Parameters<typeof agents.runAgent>[0]) => {
      call.text?.piece('Half a sentence that never ');
      throw new Error('upstream exploded');
    };
    const r = await ask(config(), 'me', 'write it', { persona: { live: store, screens: FACTS }, engine: engine as never });
    expect(r.posts()).toHaveLength(0);
    expect(code(r.all(), 'runner.mentionFailed')).toMatchObject({ params: { agent: 'me' } });
    expect(events.at(-1)).toMatchObject({ end: true });
    // the end was a drop: nothing published after the last words the devices saw
    expect(events.filter((e) => !e.end).map((e) => e.text).join('')).not.toContain('sentence that never ');
    expect(store.read(r.thread)).toEqual([]);
  });
});

describe('the quiet post', () => {
  it('leaves a @name in the persona\'s chat as plain text: no mention and no note', () => {
    ensureAgentThread(forum, { id: 'me', name: 'Me' }, 'en');
    ensureAgentThread(forum, { id: 'other', name: 'Other' }, 'en');
    const quiet = personPost(forum, ['dev'], agentThreadId('me'), '@dev please look', true);
    expect(quiet.mentions).toEqual([]);
    expect((forum.read(agentThreadId('me'), 0, 20)?.messages ?? []).filter((m) => m.kind === 'system')).toEqual([]);
    const loud = personPost(forum, ['dev'], agentThreadId('other'), '@dev please look and @ghost too');
    expect(loud.mentions).toEqual(['dev']);
    expect((forum.read(agentThreadId('other'), 0, 20)?.messages ?? []).some((m) => m.code === 'main.forum.mentions.unknown')).toBe(true);
  });
});

describe('the work under the answer', () => {
  it('hangs the agent the persona calls under the persona\'s own node', async () => {
    const c = config();
    script = (req) => {
      const tools = toolNames(req);
      // The called agent answers in the structured shape; the persona calls it first and then answers in plain text.
      if (tools.includes('final_answer')) return toolStep([{ name: 'final_answer', args: { text: 'Support says yes.' } }]);
      return req.body?.messages.some((m: { role: string }) => m.role === 'tool') ? textStep('They agree.') : toolStep([{ id: 'c1', name: 'CallAgent', args: { to: 'reply', topic: 'Is it doable?' } }]);
    };
    const r = await ask(c, 'me', 'ask the team', { persona: { live: live(), screens: FACTS } });
    expect(r.posts().map((m) => m.text)).toContain('They agree.');
    const roots = [...new Set(pushed.map((e) => e.runId))];
    const child = pushed.find((e) => e.node?.type === 'call' && e.role === 'reply');
    expect(child).toBeTruthy();
    expect(child?.parent).toBe(r.line.id);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    // the persona's own line carries the call it answers, so the chat finds its work by the message
    expect(pushed.find((e) => e.runId === r.line.id)?.call).toMatchObject({ agent: 'me', thread: r.thread, message: r.message.seq });
  });
});
