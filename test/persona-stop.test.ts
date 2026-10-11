// The Stop of the persona (#248): the latch outside the configuration, the stop that returns only after the persona is halted, the messages that wait and the Resume that answers
// them in order, the channels (open to a paired browser, not external effects, not queueable) and the audit. Through the mentions module as the app runs it, with the real engine
// against a fake OpenAI server that can hold a model call open; no real model, host or network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { PERSONA_LATCH_EVENT, PERSONA_STOP_CHANNELS, type PersonaState } from '../src/shared/personaStop';
import { isQueueable } from '../src/shared/outbox';
import { EXTERNAL_EFFECT, PERSONA_CHANNELS, webAccess, webRefusal } from '../src/main/webPolicy';
import { LATCH_FILE, createLatch, readLatch } from '../src/main/persona/latch';
import { beginInflight, inflightLabels } from '../src/main/persona/inflight';
import { createPersonaStop, unansweredSince, type StopPorts } from '../src/main/persona/stop';

let home: string;
let server: Server;
let mode: 'hang' | 'answer' = 'answer';
const seen = { requests: 0, closed: 0 };
let n = 0;

const chunk = (delta: object, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
function chat(req: IncomingMessage, res: ServerResponse): void {
  seen.requests += 1;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: '' }))}\n\n`);
  // A model call that never finishes: it ends only when the app drops the connection.
  req.on('close', () => (seen.closed += 1));
  if (mode === 'hang') return;
  const text = `Answer number ${++n}.`;
  res.write(`data: ${JSON.stringify(chunk({ content: text }))}\n\n`);
  res.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  res.end('data: [DONE]\n\n');
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-stop-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  server = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) return chat(req, res);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(home, { recursive: true, force: true });
});

describe('the latch', () => {
  const file = () => join(home, `latch-${Math.random().toString(36).slice(2)}.json`);

  it('is not stopped when there is no file, and writes one when it is set', () => {
    const f = file();
    expect(readLatch(f)).toEqual({ stopped: false, since: null, door: null });
    const latch = createLatch(f);
    expect(latch.stopped()).toBe(false);
    latch.set(true, 'paired', new Date('2026-10-11T10:00:00Z'));
    expect(latch.state()).toEqual({ stopped: true, since: '2026-10-11T10:00:00.000Z', door: 'paired' });
    // A restart: a new latch over the same file is stopped, by the same door.
    expect(createLatch(f).state()).toEqual({ stopped: true, since: '2026-10-11T10:00:00.000Z', door: 'paired' });
    latch.set(false, 'window');
    expect(createLatch(f).stopped()).toBe(false);
  });

  it.each([
    ['not json', '{nope'],
    ['empty', ''],
    ['a list', '[]'],
    ['a number', '3'],
    ['a newer format', JSON.stringify({ v: 2, stopped: false })],
    ['an unknown shape', JSON.stringify({ v: 1, stopped: 'no' })],
    ['no version', JSON.stringify({ stopped: false })],
  ])('starts stopped when the file is unreadable: %s', (_name, text) => {
    const f = file();
    writeFileSync(f, text);
    expect(readLatch(f).stopped).toBe(true);
    expect(createLatch(f).stopped()).toBe(true);
  });

  it('keeps the stop in memory when the disk fails, and does not resume when the file is deleted while the app runs', () => {
    const f = file();
    const latch = createLatch(f);
    latch.set(true, 'window');
    rmSync(f);
    expect(latch.stopped()).toBe(true);
    const bad = createLatch(join(home, 'no-such-folder', 'deeper', 'x.json'));
    mkdirSync(join(home, 'no-such-folder'));
    writeFileSync(join(home, 'no-such-folder', 'deeper'), 'a file, not a folder');
    expect(() => bad.set(true, 'window')).not.toThrow();
    expect(bad.stopped()).toBe(true);
  });
});

describe('the service, with fakes', () => {
  function build(over: Partial<StopPorts> = {}) {
    const posted: { thread: string; code: string; params: Record<string, string | number> }[] = [];
    const aborted: string[] = [];
    const states: PersonaState[] = [];
    const audits: string[] = [];
    let running = [{ thread: 'agent-me', agent: 'me' }, { thread: 'agent-me', agent: 'helper' }];
    const ports: StopPorts = {
      latch: createLatch(join(home, `svc-${Math.random().toString(36).slice(2)}.json`)),
      thread: () => 'agent-me',
      running: () => running,
      abort: (thread, agent) => (aborted.push(`${thread}/${agent}`), true),
      inflight: () => [],
      post: (thread, code, params) => void posted.push({ thread, code, params }),
      messages: () => [],
      pending: () => false,
      audit: (op, door) => void audits.push(`${op}:${door}`),
      emit: (s) => void states.push(s),
      ...over,
    };
    return { stop: createPersonaStop(ports), posted, aborted, states, audits, setRunning: (r: typeof running) => (running = r) };
  }

  it('sets the latch first, ends every call registered in the persona thread, says it once and publishes the state', () => {
    const w = build();
    const state = w.stop.stop('window');
    expect(state).toMatchObject({ stopped: true, door: 'window', waiting: 0 });
    expect(w.stop.stopped()).toBe(true);
    expect(w.aborted).toEqual(['agent-me/me', 'agent-me/helper']);
    expect(w.posted).toEqual([{ thread: 'agent-me', code: 'persona.stopped.window', params: {} }]);
    expect(w.audits).toEqual(['stop:window']);
    expect(w.states.at(-1)).toMatchObject({ stopped: true });
  });

  it('names the acts still running, masked and cut, and says they finish on their own', () => {
    const w = build({ inflight: () => ['Actions.approve push of the branch', 'x'.repeat(600)], words: (t) => t.replace('branch', 'b***') });
    w.stop.stop('paired');
    expect(w.posted[0].code).toBe('persona.stoppedInflight.paired');
    const said = String(w.posted[0].params.inflight);
    expect(said).toContain('Actions.approve push of the b***');
    expect(said.length).toBeLessThanOrEqual(300);
  });

  it('holds messages in the order they were written, whichever reached the list first, and starts them on Resume', () => {
    const w = build({ messages: () => [] });
    const started: number[] = [];
    w.stop.stop('window');
    w.stop.hold({ thread: 'agent-me', seq: 12, start: () => void started.push(12) });
    w.stop.hold({ thread: 'agent-me', seq: 9, start: () => void started.push(9) });
    w.stop.hold({ thread: 'agent-me', seq: 9, start: () => void started.push(99) });
    expect(w.stop.state().waiting).toBe(2);
    expect(w.stop.holds('agent-me')).toBe(true);
    expect(w.stop.holds('agent-other')).toBe(false);
    const state = w.stop.resume('paired');
    expect(started).toEqual([9, 12]);
    expect(state).toMatchObject({ stopped: false, waiting: 0 });
    expect(w.posted.at(-1)).toMatchObject({ code: 'persona.resumed.paired' });
    expect(w.audits).toEqual(['stop:window', 'resume:paired']);
    expect(w.stop.holds('agent-me')).toBe(false);
  });

  it('does not stop without a persona, but still holds the latch', () => {
    const w = build({ thread: () => null });
    expect(w.stop.stop('window').stopped).toBe(true);
    expect(w.posted).toEqual([]);
    expect(w.aborted).toEqual([]);
  });

  it('survives a failing thread, audit and event: the stop is set whatever else breaks', () => {
    const w = build({
      post: () => {
        throw new Error('forum down');
      },
      audit: () => {
        throw new Error('disk full');
      },
      emit: () => {
        throw new Error('window gone');
      },
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(w.stop.stop('window').stopped).toBe(true);
    expect(w.stop.resume('window').stopped).toBe(false);
    quiet.mockRestore();
  });

  it('counts, on Resume after a stop, the messages written meanwhile that nothing answers and nothing will (the app restarted)', () => {
    const msg = (seq: number, over: Partial<ForumMessage>): ForumMessage => ({ v: 1, seq, thread: 'agent-me', at: '2026-10-11T10:00:00Z', kind: 'post', author: { type: 'person' }, text: 'x', code: null, params: {}, mentions: [], refs: [], stage: null, to: null, replyTo: null, public: false, published: null, attachments: [], ...over }) as ForumMessage;
    const messages = [msg(1, {}), msg(2, { author: { type: 'agent', id: 'me' }, answersTo: 1 }), msg(3, { kind: 'system', author: { type: 'app' }, code: 'persona.stopped.window' }), msg(4, {}), msg(5, {}), msg(6, {}), msg(7, { author: { type: 'agent', id: 'me' }, answersTo: 6 })];
    expect(unansweredSince(messages, () => false)).toBe(2);
    expect(unansweredSince(messages, (seq) => seq === 4)).toBe(1);
    expect(unansweredSince(messages.slice(0, 2), () => false)).toBe(0);
    const w = build({ messages: () => messages, pending: (_t, seq) => seq === 5 });
    w.stop.stop('window');
    w.stop.resume('window');
    expect(w.posted.at(-1)).toMatchObject({ code: 'persona.notAnswered', params: { count: 1 } });
  });

  it('keeps a registry of the acts running now', () => {
    expect(inflightLabels()).toEqual([]);
    const a = beginInflight('Runs.accept run r1');
    const b = beginInflight('Actions.approve push');
    expect(inflightLabels()).toEqual(['Runs.accept run r1', 'Actions.approve push']);
    a();
    expect(inflightLabels()).toEqual(['Actions.approve push']);
    b();
    expect(inflightLabels()).toEqual([]);
  });
});

describe('the persona answering, stopped, and resumed', () => {
  let mentions: typeof import('../src/main/mentions/module');
  let runtime: typeof import('../src/main/persona/runtime');
  let forumMod: typeof import('../src/main/forum');
  let assist: typeof import('../src/main/persona/assist');
  let audit: typeof import('../src/main/auditoria');
  let stops: typeof import('../src/main/mentions/stop');
  const emitted: { name?: string; payload?: unknown }[] = [];
  const thread = agentThreadId('me');

  const messages = (id = thread): ForumMessage[] => forumMod.forumStore().read(id, 0, 2000)?.messages ?? [];
  const codes = (): string[] => messages().filter((m) => m.kind === 'system').map((m) => m.code ?? '');
  const answers = (): ForumMessage[] => messages().filter((m) => m.author.type === 'agent' && m.kind === 'post');
  const say = (text: string, id = thread) => forumMod.forumStore().append(id, { kind: 'post', author: { type: 'person' }, text })[0];
  const until = async (check: () => boolean, what: string): Promise<void> => {
    for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    if (!check()) throw new Error(`timed out waiting for ${what}`);
  };

  beforeAll(async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const base = neutralConfig();
    saveConfig({
      ...base,
      language: 'en',
      agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' }), newAgent({ id: 'me-test', name: 'Me (test)', kind: 'persona', draft: true, instructions: 'a test copy' })] },
    });
    mentions = await import('../src/main/mentions/module');
    runtime = await import('../src/main/persona/runtime');
    forumMod = await import('../src/main/forum');
    assist = await import('../src/main/persona/assist');
    audit = await import('../src/main/auditoria');
    stops = await import('../src/main/mentions/stop');
    const { ensureAgentThread } = await import('../src/main/forum-channels');
    ensureAgentThread(forumMod.forumStore(), { id: 'me', name: 'Me' }, 'en');
    ensureAgentThread(forumMod.forumStore(), { id: 'me-test', name: 'Me (test)' }, 'en');
    runtime.setLatchEmitter((s) => emitted.push({ name: PERSONA_LATCH_EVENT, payload: s }));
    mentions.mentionsModule({ handle: () => undefined, notify: () => undefined, emit: () => undefined, job: () => undefined });
  });

  afterEach(async () => {
    mode = 'answer';
    if (runtime.personaStop().stopped()) runtime.personaStop().resume('window');
    await mentions.mentionsIdle();
  });

  it('halts a model call that is in progress before the stop returns, ends the answer with one line, and holds what is written after', async () => {
    mode = 'hang';
    const before = seen.requests;
    say('first question');
    await until(() => seen.requests === before + 1, 'the model call');
    expect(stops.callStops.running(thread)).toEqual([{ thread, agent: 'me' }]);

    const state = runtime.personaStop().stop('window');
    // Before the call returns: the latch is set and the call is told to end.
    expect(state).toMatchObject({ stopped: true, door: 'window', waiting: 0 });
    expect(runtime.personaStop().stopped()).toBe(true);
    await until(() => seen.closed >= 1, 'the model connection to be dropped');
    await until(() => !stops.callStops.running(thread).length, 'the answer to end');
    expect(codes().filter((c) => c.startsWith('persona.stopped'))).toEqual(['persona.stopped.window']);
    // The stop says it: the answer writes no line of its own about a stop of one answer.
    expect(codes().filter((c) => c.startsWith('runner.mention.stopped'))).toEqual([]);
    expect(answers()).toHaveLength(0);

    // A message written now waits for Resume: no model call, a queued line, counted.
    const requests = seen.requests;
    const second = say('second question');
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.requests).toBe(requests);
    expect(runtime.personaStop().state().waiting).toBe(1);
    expect(mentions.answerPending(thread)).toBe(true);
    expect(emitted.at(-1)?.payload).toMatchObject({ stopped: true, waiting: 1 });

    // Clear and Delete count a message that waits as an answer to wait for.
    expect(() => assist.personaClear()).toThrow();
    expect(() => assist.personaDelete()).toThrow();

    mode = 'answer';
    runtime.personaStop().resume('window');
    await mentions.mentionsIdle();
    await until(() => answers().length === 1, 'the held message to be answered');
    expect(answers()[0].answersTo).toBe(second.seq);
    expect(codes()).toContain('persona.resumed.window');
    expect(runtime.personaStop().state()).toMatchObject({ stopped: false, waiting: 0 });
  });

  it('holds a message that was queued behind the stopped answer, and answers the waiting ones in the order they were written', async () => {
    mode = 'hang';
    const before = seen.requests;
    const lines = codes().length;
    const answered = answers().length;
    const a = say('message a');
    const b = say('message b queued behind a');
    await until(() => seen.requests === before + 1, 'the first model call');
    runtime.personaStop().stop('paired');
    const c = say('message c written while stopped');
    await until(() => runtime.personaStop().state().waiting === 2, 'both waiting messages to be held');
    expect(codes().slice(lines).filter((x) => x.startsWith('persona.stopped'))).toEqual(['persona.stopped.paired']);

    mode = 'answer';
    runtime.personaStop().resume('paired');
    await until(() => answers().length === answered + 2, 'the two held messages to be answered');
    await mentions.mentionsIdle();
    // a was cut and had nothing written; b then c are answered, b first although c reached the list before it.
    expect(answers().slice(answered).map((m) => m.answersTo)).toEqual([b.seq, c.seq]);
    expect(a.seq).toBeLessThan(b.seq);
    expect(codes().slice(lines).filter((x) => x.startsWith('persona.resumed'))).toEqual(['persona.resumed.paired']);
  });

  it('never holds the persona being tested in the wizard: its test copy cannot act', async () => {
    runtime.personaStop().stop('window');
    const testThread = agentThreadId('me-test');
    const asked = say('hello test copy', testThread);
    await mentions.mentionsIdle();
    await until(() => messages(testThread).some((m) => m.answersTo === asked.seq), 'the test copy to answer');
    expect(runtime.personaStop().state().waiting).toBe(0);
  });

  it('says what was still running when the persona was stopped', () => {
    const done = beginInflight('Actions.approve push of the release branch');
    runtime.personaStop().stop('window');
    done();
    const line = messages().filter((m) => m.code?.startsWith('persona.stoppedInflight')).at(-1);
    expect(line?.code).toBe('persona.stoppedInflight.window');
    expect(String(line?.params?.inflight)).toContain('Actions.approve push of the release branch');
  });

  it('writes the stop and the resume in the audit with the door, and no text', () => {
    runtime.personaStop().stop('window');
    runtime.personaStop().resume('window');
    const lines = audit.listAudit().filter((e) => e.kind === 'persona' && e.target.startsWith('persona:s') || e.target === 'persona:resume');
    expect(lines.some((e) => e.target === 'persona:stop' && e.via === 'window' && e.fields.door === 'window')).toBe(true);
    expect(lines.some((e) => e.target === 'persona:resume' && e.via === 'window')).toBe(true);
  });

  it('keeps the latch on disk, outside the configuration, so a restart finds the persona stopped', async () => {
    const { ATAS } = await import('../src/main/env');
    const { getConfig } = await import('../src/main/workspaceConfig');
    runtime.personaStop().stop('window');
    expect(JSON.stringify(getConfig())).not.toContain('latch');
    expect(readLatch(join(ATAS, LATCH_FILE)).stopped).toBe(true);
    expect(JSON.parse(readFileSync(join(ATAS, LATCH_FILE), 'utf8'))).toMatchObject({ v: 1, stopped: true, door: 'window' });
    runtime.personaStop().resume('window');
    expect(readLatch(join(ATAS, LATCH_FILE)).stopped).toBe(false);
    expect(existsSync(join(ATAS, LATCH_FILE))).toBe(true);
  });
});

describe('the channels', () => {
  it('are open to a paired browser with the external-effects switch off, are not external effects, and are not queueable', () => {
    expect([...PERSONA_STOP_CHANNELS]).toEqual(['persona:stop', 'persona:resume', 'persona:state']);
    for (const channel of PERSONA_STOP_CHANNELS) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
      expect(PERSONA_CHANNELS.has(channel), channel).toBe(true);
      expect(isQueueable(channel), channel).toBe(false);
    }
  });

  it('stop, resume and read the state through the rpc, from the window and from a paired browser, saying which', async () => {
    const { bindIpc, handle, invoke } = await import('../src/main/rpc');
    const { personaModule } = await import('../src/main/persona/module');
    const { personaStop } = await import('../src/main/persona/runtime');
    const { listAudit } = await import('../src/main/auditoria');
    const ipc = new Map<string, (...args: unknown[]) => unknown>();
    bindIpc((channel, fn) => ipc.set(channel, fn as (...args: unknown[]) => unknown));
    const events: { name?: string; payload?: unknown }[] = [];
    personaModule({ handle: (channel, fn) => handle(channel, fn as never), notify: () => undefined, emit: (e) => void events.push(e as never), job: () => undefined });

    expect(await ipc.get('persona:state')?.()).toMatchObject({ stopped: false, waiting: 0 });
    expect(await ipc.get('persona:stop')?.()).toMatchObject({ stopped: true, door: 'window' });
    expect(await invoke('persona:state', [], 'device-1')).toMatchObject({ stopped: true, door: 'window' });
    expect(events.at(-1)).toMatchObject({ name: PERSONA_LATCH_EVENT, payload: { stopped: true } });
    expect(await invoke('persona:resume', [], 'device-1')).toMatchObject({ stopped: false });
    expect(await invoke('persona:stop', [], 'device-1')).toMatchObject({ stopped: true, door: 'paired' });
    expect(personaStop().state().door).toBe('paired');
    const stop = listAudit().find((e) => e.target === 'persona:stop');
    expect(stop).toMatchObject({ via: 'paired', fields: { door: 'paired' } });
    expect(stop?.actor).toBeUndefined();
    await invoke('persona:resume', [], 'device-1');
  });
});
