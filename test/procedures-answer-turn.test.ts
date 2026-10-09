// The last turn of a conversation answer (#187, spec rules 12 to 14 and 17; acceptance 5 and 6): once the answer is posted, an answer whose work had trial and error and kept no
// procedure gets one more call, detached from the thread's queue, and the offer it leaves is the thread's. The real procedure port and offer store over a temp folder, the
// fake sandbox, the app's browser over a scripted server and the fake engine; no model, no network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { AgentCall } from '../src/main/agents';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions, type MentionDeps } from '../src/main/mentions/answer';
import { createKeptSessions } from '../src/main/mentions/kept';
import { createCallStops } from '../src/main/mentions/stop';
import type { MentionPlace } from '../src/main/mentions/place';
import { createProcedureOffers, type ProcedureOffers } from '../src/main/procedures/offers';
import { createProceduresPort } from '../src/main/procedures/port';
import { createProcedureStore } from '../src/main/procedures/store';
import { runWrapUp } from '../src/main/procedures/wrapup';
import type { HandoffService } from '../src/main/screen/handoff';
import { createTypedValues } from '../src/main/screen/typedValues';
import { getConfig } from '../src/main/workspaceConfig';
import { type FakeSandbox, fakeEngine, fakeSandbox } from './helpers/runner';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

vi.setConfig({ testTimeout: 30_000 });

let root: string;
let forum: ForumStore;
let screens: FakeScreens | undefined;
let offers: ProcedureOffers;
let tasks: Promise<void>[];
let sandbox: FakeSandbox;

beforeEach(() => {
  setLanguage('en');
  root = mkdtempSync(join(tmpdir(), 'coxia-procedures-answer-turn-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
  offers = createProcedureOffers({ store: createProcedureStore(root), config: getConfig, sessions: () => screens?.sessions ?? null, note: (thread, code, params) => void forum.append(thread, { kind: 'system', author: { type: 'app' }, code, params }) });
  tasks = [];
  screens = fakeScreens();
});
afterEach(() => {
  setLanguage('pt-BR');
  screens?.dispose();
  screens = undefined;
  rmSync(root, { recursive: true, force: true });
});

const place = (over: Partial<MentionPlace> = {}): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing', ...over }) as MentionPlace;
const say = () => forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn do it', mentions: ['turn'] })[0];
const config = (agent: Record<string, unknown> = {}): WorkspaceConfig => {
  const c = neutralConfig();
  c.language = 'en';
  c.runner.sandbox.display = true;
  c.runner.procedures = true;
  c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell: 'sandbox' as const, screen: true, allowedHosts: ['docs.example.com'], ...agent } : { ...a, permission: 'read' as const, shell: 'none' as const }));
  return c;
};
/** `npm test` fails and the same program then works with a flag: the trial and error a draft keeps. */
const TABLE = { 'npm test': { exitCode: 1 } };

function world(agent: Record<string, unknown> = {}, over: Partial<MentionDeps> = {}, c: WorkspaceConfig = config(agent)) {
  const engine = fakeEngine();
  sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'sandbox' }, table: TABLE });
  const d: MentionDeps = {
    forum,
    config: () => c,
    sandbox,
    env: () => ({ fallbackCwd: root }),
    screens: () => ({ sessions: screens!.sessions, asks: screens!.asks }),
    kept: createKeptSessions(),
    stops: createCallStops(),
    procedures: createProceduresPort({ config: () => c, dir: root }),
    engine,
    offers,
    // the detached turn, waited for by the test
    wrapUp: (deps, run) => {
      const task = runWrapUp(deps, run);
      tasks.push(task);
      return task;
    },
    ...over,
  };
  return { d, engine };
}
const fight = async (call: AgentCall): Promise<void> => {
  await call.exec?.exec('npm ci');
  await call.exec?.exec('npm test');
  await call.exec?.exec('npm test -- --runInBand');
};
const open = (call: AgentCall, url: string) => call.screen!.browser!.call('browser_navigate', { url });
const turnCalls = (engine: ReturnType<typeof fakeEngine>): AgentCall[] => engine.calls.filter((c) => c.procedureOnly);
const codes = (): string[] => (forum.read('squads', 0, 200)?.messages ?? []).map((m) => m.code ?? m.kind);
const settled = (): Promise<unknown> => Promise.all(tasks);

describe('an answer that fought a command and kept nothing', () => {
  it('posts the answer first, then gives the agent its last turn beside the thread, then offers the draft in the thread', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { d, engine } = world();
    engine.script('turn', async (call) => {
      if (call.procedureOnly) {
        await gate;
        return { note: '' };
      }
      await fight(call);
      return { text: 'The tests pass with --runInBand.' };
    });
    const answers = await answerMentions(place(), say(), d);
    // answerMentions came back with the turn still waiting: the next message in the thread is not held up by it
    expect(answers).toEqual([{ agent: 'turn', text: 'The tests pass with --runInBand.' }]);
    expect(forum.read('squads', 0, 100)?.messages.some((m) => m.kind === 'post' && m.author.type === 'agent')).toBe(true);
    await vi.waitFor(() => expect(turnCalls(engine)).toHaveLength(1));
    expect(offers.list()).toEqual([]);
    expect(codes()).not.toContain('runner.procedures.wrapUp');
    release();
    await settled();
    const call = turnCalls(engine)[0];
    expect(call.agent.permission).toBe('read');
    expect(call.exec).toBeUndefined();
    expect(call.screen).toBeUndefined();
    expect(call.maxTurns).toBe(3);
    expect(call.prompt).toContain('The tests pass with --runInBand.');
    expect(call.prompt).toContain('run: npm test -- --runInBand');
    expect(codes()).toEqual(expect.arrayContaining(['runner.procedures.wrapUp', 'runner.procedures.offered']));
    const [offer] = offers.list('squads');
    expect(offer).toMatchObject({ agent: 'turn', thread: 'squads', kind: 'tool' });
    expect(offer.steps.map((s) => s.run)).toEqual(['npm ci', 'npm test -- --runInBand']);
  });

  it('runs the turn after the answer\'s shell is closed: the draft was copied first, and the uses are closed after the turn', async () => {
    const { d, engine } = world({ screen: false });
    let closedDuringTurn: boolean | undefined;
    engine.script('turn', async (call) => {
      if (call.procedureOnly) {
        await new Promise((r) => setTimeout(r, 10));
        closedDuringTurn = sandbox.opened[0].session.closed;
        // the agent keeps it from the draft the app registered before the shell closed
        const r = await call.procedures?.save({ kind: 'tool', key: 'npm', title: 'Run the tests with a retry', draft: 'c-1' });
        expect(r?.text).toMatch(/^Saved p-/);
        return { note: 'kept' };
      }
      await fight(call);
      return { text: 'Done.' };
    });
    const path = join(root, 'repos', 'api');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'README.md'), '# api\n');
    await answerMentions(place({ repos: [{ id: 'api', path, remoteUrl: null, vcsId: null, projectPath: 'group/api' }] }), say(), d);
    await settled();
    expect(closedDuringTurn).toBe(true);
    expect(offers.list()).toEqual([]);
    expect(codes()).toContain('runner.procedures.saved');
  });

  it('is given once for a screen at a draft mark: the second answer before the mark moves gets no second turn', async () => {
    const { d, engine } = world({ shell: 'none' });
    engine.script('turn', async (call) => {
      if (call.procedureOnly) return { note: '' };
      const n = engine.calls.filter((c) => !c.procedureOnly).length;
      for (const page of ['budget', 'summary', 'details', 'export', 'archive']) await open(call, `https://docs.example.com/${page}-${'abc'[n - 1]}`);
      return { text: `Answer ${n}.` };
    });
    await answerMentions(place(), say(), d);
    await settled();
    expect(turnCalls(engine)).toHaveLength(1);
    const first = offers.list()[0];
    await answerMentions(place(), say(), d);
    await settled();
    // more steps, same mark: the card is waiting for the person and no new turn is spent, but the card is refreshed from the newer answer
    expect(turnCalls(engine)).toHaveLength(1);
    expect(offers.list()).toHaveLength(1);
    expect(offers.list()[0].offerId).not.toBe(first.offerId);
    expect(offers.list()[0].steps.length).toBeGreaterThan(first.steps.length);
    expect(codes().filter((c) => c === 'runner.procedures.offered')).toHaveLength(1);
    expect(offers.list()[0]).toMatchObject({ kind: 'gui', key: 'docs.example.com', screen: true });
    // the person said no: the mark moved and the next answer's steps earn a turn again
    expect(offers.decline(offers.list()[0].offerId)).toEqual({ ok: true });
    await answerMentions(place(), say(), d);
    await settled();
    expect(turnCalls(engine)).toHaveLength(2);
  });
});

describe('what the person typed in a hand-off', () => {
  it('is still refused by field in the detached turn, plain or encoded, and is forgotten when the turn ends', async () => {
    const typed = createTypedValues();
    // The hand-off as the answer sees it: the values are forgotten the moment the answer ends, as the real call's `end` does.
    const handoff = { begin: () => ({ typed, request: async () => null, active: () => false, end: () => typed.clear() }), hadHandoff: () => false } as unknown as HandoffService;
    const { d, engine } = world({}, { screens: () => ({ sessions: screens!.sessions, asks: screens!.asks, handoff }) });
    const saves: string[] = [];
    engine.script('turn', async (call) => {
      if (call.procedureOnly) {
        // the answer is over, so the call's own values are gone: the turn's save still cannot hold them
        await new Promise((r) => setTimeout(r, 20));
        expect(typed.hits('maple 4 sunset')).toBe(false);
        saves.push((await call.procedures!.save({ kind: 'tool', key: 'npm', title: 'Run the tests', steps: [{ text: 'Log in with maple 4 sunset' }] })).text);
        saves.push((await call.procedures!.save({ kind: 'tool', key: 'npm', title: 'Run the tests', steps: [{ text: 'Open login?pw=maple%204%20sunset' }] })).text);
        return { note: '' };
      }
      typed.add(['maple 4 sunset']);
      await fight(call);
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    await settled();
    expect(turnCalls(engine)).toHaveLength(1);
    expect(saves).toHaveLength(2);
    for (const text of saves) expect(text).toMatch(/^Not saved: steps\[0\]\.text holds text the person typed|^Not saved: .*holds text the person typed/);
    expect(JSON.stringify(saves)).not.toContain('Saved p-');
    expect(createProcedureStore(root).list().records).toEqual([]);
  });
});

describe('an answer that earned nothing', () => {
  const script = (engine: ReturnType<typeof fakeEngine>, act: (call: AgentCall) => Promise<void>) =>
    engine.script('turn', async (call) => {
      if (call.procedureOnly) return { note: '' };
      await act(call);
      return { text: 'Done.' };
    });

  it('all commands worked, or the agent saved a procedure itself', async () => {
    const worked = world({ screen: false });
    script(worked.engine, async (call) => {
      await call.exec?.exec('npm ci');
    });
    const path = join(root, 'repos', 'api');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'README.md'), '# api\n');
    const withRepo = place({ repos: [{ id: 'api', path, remoteUrl: null, vcsId: null, projectPath: 'group/api' }] });
    await answerMentions(withRepo, say(), worked.d);
    await settled();
    expect(turnCalls(worked.engine)).toEqual([]);

    const saved = world({ screen: false });
    script(saved.engine, async (call) => {
      await fight(call);
      await call.procedures?.save({ kind: 'tool', key: 'npm', title: 'Run the tests', steps: [{ text: 'Run npm test -- --runInBand' }] });
    });
    await answerMentions(withRepo, say(), saved.d);
    await settled();
    expect(turnCalls(saved.engine)).toEqual([]);
    expect(offers.list()).toEqual([]);
  });

  it('a ceremony, an agent called by another, a workspace with the switch off, and a caller with no offers', async () => {
    const ceremony = world();
    script(ceremony.engine, fight);
    await answerMentions({ ...place(), kind: 'ceremony' } as MentionPlace, say(), ceremony.d);

    const called = world({}, { chain: ['developer'] });
    script(called.engine, fight);
    await answerMentions(place(), say(), called.d);

    const off = config();
    off.runner.procedures = false;
    const switched = world({}, {}, off);
    script(switched.engine, fight);
    await answerMentions(place(), say(), switched.d);

    const none = world({}, { offers: undefined });
    script(none.engine, fight);
    await answerMentions(place(), say(), none.d);

    await settled();
    for (const w of [ceremony, called, switched, none]) expect(turnCalls(w.engine)).toEqual([]);
    expect(offers.list()).toEqual([]);
    expect(codes()).not.toContain('runner.procedures.wrapUp');
  });

  it('an answer that failed gets no turn', async () => {
    const { d, engine } = world();
    engine.script('turn', async (call) => {
      await fight(call);
      throw new Error('the model went away');
    });
    await answerMentions(place(), say(), d);
    await settled();
    expect(turnCalls(engine)).toEqual([]);
  });
});

describe('what the turn never does to the answer', () => {
  it('a turn that fails leaves the answer and the thread as they were, and the card is still offered', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        const { d, engine } = world();
      engine.script('turn', async (call) => {
        if (call.procedureOnly) throw new Error('the provider fell over');
        await fight(call);
        return { text: 'Done.' };
      });
      const answers = await answerMentions(place(), say(), d);
      await settled();
      expect(answers).toEqual([{ agent: 'turn', text: 'Done.' }]);
      expect(codes()).not.toContain('runner.mentionFailed');
      expect(offers.list()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });
});
