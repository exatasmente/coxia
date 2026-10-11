// The persona's tools through the real answerMentions and the real open engine against a fake OpenAI server (#248): the four acts of the issue, each with its audit line and its
// line in the conversation; who is given the tools and who is not; a call that is not well formed read by the model as an error; a Stop pressed while an act is running; and a secret
// the persona read kept out of everything the answer writes. No model, host or network is real.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mentionJob } from '../src/shared/activity';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { AgentDef } from '../src/shared/config/types';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { type Fake, type Step, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';
import { fakeGitlabRuntime } from './helpers/vcs';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

let home: string;
let fake: Fake;
let script: (req: Fake['requests'][number]) => Step = () => textStep('ok');
const steps = (...list: Step[]) => {
  const queue = [...list];
  script = () => queue.shift() ?? textStep('(nothing scripted)');
};

const VALUE = 'correct-horse-battery-staple-9';
process.env.PERSONA_TOOLS_SECRET = VALUE;

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { personaStop } = await import('../src/main/persona/runtime');
const { createPersonaLive } = await import('../src/main/persona/live');
const { BUTTON_SCREENS } = await import('../src/main/persona/openScreen');
const { TOOL_NAMES } = await import('../src/main/persona/doorTable');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { ATAS } = await import('../src/main/env');
const { ensureAgentThread } = await import('../src/main/forum-channels');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const agents = await import('../src/main/agents');
const log = await import('../src/main/activity');
const answer = await import('../src/main/mentions/answer');
const place = await import('../src/main/mentions/place');

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const ctx = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined };
const asPerson = async (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);

const THREAD = agentThreadId('me');
const why = 'The person asked me to.';
let hostGate: Promise<void> = Promise.resolve();
let hostStarted = 0;
let events: unknown[] = [];
let pushed: unknown[] = [];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-tools-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => script(req));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  setLanguage('en');
  const base = neutralConfig();
  saveConfig({
    ...base,
    language: 'en',
    agents: {
      ...base.agents,
      team: [
        ...base.agents.team.map((a) => ({ ...a, permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const })),
        newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'The person is a maintainer who never wants a surprise.' }),
        newAgent({ id: 'dev', name: 'Developer', permission: 'read' }),
      ],
    },
    projects: { ...base.projects, repos: [] },
    devCycle: { ...base.devCycle, priority: { ...base.devCycle.priority, labels: ['high', 'low'] }, stages: [{ id: 'backlog', label: 'Backlog', match: [], kind: 'backlog', rank: 0 }, { id: 'doing', label: 'Doing', match: [], kind: 'development', rank: 1 }] },
  });
  mkdirSync(join(ATAS, 'forum'), { recursive: true });
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  ensureAgentThread(forumStore(), { id: 'dev', name: 'Developer' }, 'en');
  const { configModule } = await import('../src/main/configModule');
  const { runsModule } = await import('../src/main/runner/module');
  const { register: turnAsksModule } = await import('../src/main/turnAsks');
  const { register: board } = await import('../src/main/board');
  const { errorlog } = await import('../src/main/errorlog');
  for (const register of [configModule, runsModule, turnAsksModule, board, errorlog]) register(ctx as never);
  handle('actions:approve', ((id: string) => actions.approveAction(id)) as never);
  handle('actions:list', (() => actions.listActions()) as never);
  setVcsRuntimeForTests(fakeGitlabRuntime(async () => ({}), undefined, async () => {
      hostStarted++;
      await hostGate;
      return 'ok';
    }));
});

afterAll(async () => {
  setVcsRuntimeForTests(null);
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  fake.requests.length = 0;
  events = [];
  pushed = [];
  hostGate = Promise.resolve();
  hostStarted = 0;
  log.activityLog.clear();
  log.activityLog.setSink((e) => pushed.push(e));
  if (personaStop().stopped()) personaStop().resume('window');
});

const live = () => createPersonaLive({ emit: (e) => events.push(e), redact: (t) => t });
const FACTS = { ceremonies: () => ({ preDaily: true }) as never, ceremonyName: () => 'x', cards: async () => ['app#1'], run: () => false, conflict: () => false, thread: () => true };
const toolNames = (req: Fake['requests'][number]): string[] => ((req.body?.tools ?? []) as { function: { name: string } }[]).map((x) => x.function.name);

/** One answer of `id` in its direct conversation: the message of the person, the real answerMentions over the real engine, the door of the persona. */
async function ask(id: string, text: string, over: Partial<Parameters<typeof answer.answerMentions>[2]> = {}) {
  const forum = forumStore();
  const thread = agentThreadId(id);
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text });
  const where = place.placeOfThread(forum.summary(thread), () => null, getConfig())!;
  const line = log.beginCallActivity(id, { jobId: mentionJob(thread), call: { agent: id, thread, message: message.seq }, node: { type: 'call', label: text }, isSecretPath: (p) => agents.secretPath(p, home) });
  line.status('started');
  const out = await answer.answerMentions(where, message, { forum, config: getConfig, engine: agents.runAgent, env: () => ({ fallbackCwd: home }), calls: [id], callOf: () => ({ activity: line, queued: false }), persona: { live: live(), screens: FACTS, door: personaDoor }, ...over });
  const all = (): ForumMessage[] => forum.read(thread, 0, 2000)?.messages ?? [];
  return { thread, message, out, all, after: () => all().filter((m) => m.seq > message.seq) };
}

const proposal = (key: string) => actions.proposeVcsAction({ key, issue: 12, issueTitle: 'Fix', summary: `Comment ${key}`, command: { via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/12/notes', fields: { body: key } } });

describe('the four acts of the issue, asked in the chat', () => {
  it('changes a setting, moves a card\'s priority, approves a proposal and answers a hold: four lines of audit and four lines in the conversation, before the answer', async () => {
    const card = (await asPerson('board:create', { title: 'Plan the beta', column: 'backlog' })) as { id: string };
    const waiting = proposal('k-four');
    if (!waiting) throw new Error('no proposal');
    const { screenAsks } = await import('../src/main/runner/module');
    const hold = screenAsks()!.confirm({ key: 'call:general:dev', agent: 'dev', place: 'conversation', confirmKind: 'send', words: 'send the quarterly report to the client' });
    const askId = screenAsks()!.list()[0].id;
    steps(
      toolStep([{ name: 'Settings', args: { op: 'set', path: 'agents.team[me].shell', value: 'sandbox', why: 'The person wants me to run the tests.' } }]),
      toolStep([{ name: 'Board', args: { op: 'update', id: card.id, priority: 'high', why: 'The person said this goes first.' } }]),
      toolStep([{ name: 'Actions', args: { op: 'approve', id: waiting.id, why: 'It is the comment the person reviewed.' } }]),
      toolStep([{ name: 'Asks', args: { op: 'screenAnswer', askId, decision: 'no', note: 'not now', why: 'The person does not want it sent.' } }]),
      textStep('I changed the setting, put the card first, approved the comment and said no to the browser.'),
    );
    const r = await ask('me', 'Do the four things, please.');
    expect(r.out[0].text).toContain('I changed the setting');
    await expect(hold).resolves.toEqual({ answer: 'no', note: 'not now' });
    expect(getConfig().agents.team.find((a) => a.id === 'me')?.shell).toBe('sandbox');

    const mine = listAudit().filter((e) => e.actor === 'persona');
    const kinds = (kind: string) => mine.filter((e) => e.kind === kind);
    expect(kinds('config')).toHaveLength(1);
    expect(kinds('config')[0]).toMatchObject({ door: 'window', said: 'The person wants me to run the tests.', fields: { raised: 'agents.team[me].shell' } });
    expect(mine.find((e) => e.target === 'Board.update')).toMatchObject({ kind: 'act', said: 'The person said this goes first.', ok: true });
    expect(mine.find((e) => e.target === 'POST projects/acme%2Fweb/issues/12/notes')).toMatchObject({ door: 'window', said: 'It is the comment the person reviewed.' });
    expect(kinds('screen-confirm')[0]).toMatchObject({ via: 'persona', fields: { through: 'persona' }, said: 'The person does not want it sent.' });
    for (const e of mine) expect(e.basis?.message, e.target).toBe(r.message.seq);

    // four lines in the conversation, in order, and the answer after them
    const lines = r.after();
    const acts = lines.filter((m) => m.code === 'persona.act');
    expect(acts.map((m) => `${m.params?.tool}.${m.params?.op}`)).toEqual(['Settings.set', 'Board.update', 'Actions.approve', 'Asks.screenAnswer']);
    for (const m of acts) expect(m.params).toMatchObject({ result: 'ok' });
    expect(lines.at(-1)).toMatchObject({ kind: 'post', answersTo: r.message.seq });
    expect(lines.findIndex((m) => m.kind === 'post')).toBeGreaterThan(lines.findLastIndex((m) => m.code === 'persona.act'));
    // the proposal was the person's: the line of approving it does not claim the persona proposed it
    expect(mine.find((e) => e.target === 'POST projects/acme%2Fweb/issues/12/notes')?.proposedBy).toBeUndefined();
  });
});

describe('who is given the tools', () => {
  const eleven = [...TOOL_NAMES];

  it('gives the real persona the eleven and the button, with the persona\'s own words about them', async () => {
    steps(textStep('Hello.'));
    await ask('me', 'Hi');
    const names = toolNames(fake.chats()[0]);
    for (const name of eleven) expect(names, name).toContain(name);
    expect(names).toContain('OpenScreen');
    const body = JSON.stringify(fake.chats()[0].body?.messages);
    expect(body).toContain('You also have tools to act in the app');
    expect(body).not.toContain('you change nothing');
    // the descriptions the model got name the operations
    const approve = (fake.chats()[0].body?.tools as { function: { name: string; description: string } }[]).find((x) => x.function.name === 'Actions');
    expect(approve?.function.description).toContain('approve(id, why) [writes]');
  });

  it('gives its test copy, another agent, an agent the persona called and a persona with no door none of them', async () => {
    const copy: AgentDef = newAgent({ id: 'me', name: 'Me', kind: 'persona', draft: true, instructions: 'a draft' });
    const withCopy = { ...getConfig(), agents: { ...getConfig().agents, team: [...getConfig().agents.team.filter((a) => a.id !== 'me'), copy] } };
    for (const [id, over] of [
      ['me', { config: () => withCopy }],
      ['dev', {}],
      ['me', { chain: ['dev'] }],
      ['me', { persona: { live: live(), screens: FACTS } }],
    ] as const) {
      fake.requests.length = 0;
      steps(textStep('Hello.'));
      await ask(id, 'Hi', over as never);
      const names = toolNames(fake.chats()[0]);
      for (const name of eleven) expect(names, `${id} ${JSON.stringify(Object.keys(over))} ${name}`).not.toContain(name);
    }
  });

  it('marks every one of them for the principal agent only, so a sub-agent of the open engine never gets one', async () => {
    const { personaToolImpls } = await import('../src/main/persona/tools');
    const { createSession } = await import('../src/main/persona/session');
    const tools = personaToolImpls(personaDoor, createSession({ persona: 'me', thread: THREAD, seq: 1, door: 'window' }));
    expect(tools.every((x) => x.principalOnly)).toBe(true);
    expect(BUTTON_SCREENS.length).toBeGreaterThan(0);
  });
});

describe('a call that is not well formed', () => {
  it('is read by the model as an error, with no handler run and no audit line, and the model recovers', async () => {
    const before = listAudit().length;
    steps(
      toolStep([{ name: 'Runs', args: { op: 'cancel', run: 'r-nothing' } }]),
      toolStep([{ name: 'Runs', args: { op: 'resume' } }]),
      toolStep([{ name: 'Runs', args: { op: 'gate', run: 'r-nothing', action: 'maybe', why } }]),
      textStep('I could not do that.'),
    );
    const r = await ask('me', 'Cancel it');
    expect(r.out[0].text).toBe('I could not do that.');
    const tool = (n: number) => {
      const messages = (fake.chats()[n].body?.messages ?? []) as { role: string; content: string }[];
      return messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    };
    expect(tool(1)).toMatch(/takes a reason/);
    // the open engine checks the schema before the door does: an op that is not listed is refused with the list, and resume is not on it
    expect(tool(2)).toMatch(/\$\.op: must be one of/);
    expect(tool(2)).not.toContain('resume');
    expect(tool(3)).toMatch(/\$\.action: must be one of/);
    expect(listAudit()).toHaveLength(before);
    expect(r.after().filter((m) => m.code === 'persona.act')).toHaveLength(0);
  });

  it('is told what the handler said when the handler refuses, and the refusal is recorded as the persona\'s', async () => {
    steps(toolStep([{ name: 'Runs', args: { op: 'cancel', run: 'r-nothing', why } }]), textStep('That run does not exist.'));
    const r = await ask('me', 'Cancel r-nothing');
    const last = ((fake.chats()[1].body?.messages ?? []) as { role: string; content: string }[]).filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    expect(last).toMatch(/Runs\.cancel failed/);
    expect(listAudit().find((e) => e.target === 'Runs.cancel')).toMatchObject({ actor: 'persona', ok: false });
    expect(r.after().find((m) => m.code === 'persona.act')?.params).toMatchObject({ result: 'refused' });
  });
});

describe('the Stop', () => {
  it('lets the act that had begun finish and be audited, names it among those in flight, ends the answer, and refuses the call that comes after', async () => {
    const cancels = listAudit().filter((e) => e.target === 'Runs.cancel').length;
    const waiting = proposal('k-stop');
    if (!waiting) throw new Error('no proposal');
    let release: () => void = () => undefined;
    hostGate = new Promise<void>((r) => (release = r));
    steps(
      toolStep([{ name: 'Actions', args: { op: 'approve', id: waiting.id, why: 'Approving the comment.' } }]),
      toolStep([{ name: 'Runs', args: { op: 'cancel', run: 'r-never', why } }]),
      textStep('Done.'),
    );
    const running = ask('me', 'Approve the comment', { latched: () => personaStop().stopped() });
    await vi.waitFor(() => expect(hostStarted).toBe(1));
    personaStop().stop('window');
    release();
    const r = await running;
    const lines = r.after();
    // the approval finished and was audited, as if the person had clicked and then pressed Stop
    expect(listAudit().find((e) => e.target === 'POST projects/acme%2Fweb/issues/12/notes' && e.actor === 'persona')).toBeDefined();
    const stopped = lines.filter((m) => m.code?.startsWith('persona.stoppedInflight'));
    expect(stopped).toHaveLength(1);
    expect(String(stopped[0].params?.inflight)).toContain('Actions.approve');
    // no per-answer stop line besides the one of the latch, and no second tool call was run
    expect(lines.filter((m) => m.code?.startsWith('runner.mention.stopped'))).toHaveLength(0);
    expect(listAudit().filter((e) => e.target === 'Runs.cancel')).toHaveLength(cancels);
    expect(personaStop().stopped()).toBe(true);
  });
});

describe('a secret the persona read', () => {
  it('reaches the model and nothing the answer writes: the posted text, the live text, the lines of the act and the activity hold the masked form', async () => {
    const s = await personaDoor.run({ ...(await import('../src/main/persona/session')).createSession({ persona: 'me', thread: THREAD, seq: 1, door: 'window' }) }, 'Secrets', { op: 'set', ref: 'test.tools', source: 'env', name: 'PERSONA_TOOLS_SECRET', why });
    expect(s).toMatch(/^Done\./);
    steps(
      toolStep([{ name: 'Secrets', args: { op: 'read', ref: 'test.tools', why: 'The person asked me to check the key.' } }]),
      textStep(`The key is ${VALUE}.`),
    );
    const r = await ask('me', 'What is the key?');
    // the model was given the value by the tool
    const toolText = ((fake.chats()[1].body?.messages ?? []) as { role: string; content: string }[]).filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    expect(toolText).toContain(VALUE);
    // and nothing stored or shown holds it
    const posted = r.after().filter((m) => m.kind === 'post').at(-1);
    expect(posted?.text).toBe('The key is [secret].');
    expect(JSON.stringify(r.after())).not.toContain(VALUE);
    expect(JSON.stringify(listAudit())).not.toContain(VALUE);
    expect(JSON.stringify(events)).not.toContain(VALUE);
    expect(pushed.length).toBeGreaterThan(0);
    expect(JSON.stringify(pushed)).not.toContain(VALUE);
    expect(listAudit().find((e) => e.kind === 'secret' && e.fields.op === 'read')).toMatchObject({ actor: 'persona', fields: { ref: 'test.tools' } });
  });
});
