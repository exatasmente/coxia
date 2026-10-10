// The draft and the check of what the person typed, through the real call paths (#179 phase D): an agent mentioned in a conversation and a working stage, each with the app's
// browser over a scripted server, the real screen sessions, the real hand-off service and the real procedure port over a temp folder. Neutral hosts only.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { setLanguage } from '../src/shared/i18n';
import { prompt as cycleWords } from '../src/main/cyclePrompts';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { ProcedureRecord } from '../src/shared/procedures';
import type { AgentCall } from '../src/main/agents';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { answerMentions, type MentionDeps } from '../src/main/mentions/answer';
import { createKeptSessions } from '../src/main/mentions/kept';
import type { MentionPlace } from '../src/main/mentions/place';
import type { ScreenHub } from '../src/main/screen/hub';
import { createCallStops } from '../src/main/mentions/stop';
import { createProceduresPort } from '../src/main/procedures/port';
import { getConfig } from '../src/main/workspaceConfig';
import { proceduresPath } from '../src/main/procedures/store';
import { type FakeSandbox, boot, doc, fakeEngine, fakeSandbox, work } from './helpers/runner';
import { fakeHandoff } from './helpers/handoff';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

vi.setConfig({ testTimeout: 30_000 });

let root: string;
let forum: ForumStore;
let screens: FakeScreens;
const SECRET = 'correct horse 42';

beforeEach(() => {
  setLanguage('en');
  root = mkdtempSync(join(tmpdir(), 'coxia-procedures-gui-calls-'));
  forum = createForumStore(join(root, 'forum'));
  forum.ensureThread({ id: 'squads', kind: 'channel', title: 'Squads' });
});
afterEach(() => {
  setLanguage('pt-BR');
  screens?.dispose();
  rmSync(root, { recursive: true, force: true });
});

const config = (agent: Record<string, unknown> = {}): WorkspaceConfig => {
  const c = neutralConfig();
  c.language = 'en';
  c.runner.sandbox.display = true;
  c.runner.procedures = true;
  c.agents.team = c.agents.team.map((a) => (a.id === 'turn' ? { ...a, permission: 'read' as const, shell: 'none' as const, screen: true, allowedHosts: ['docs.example.com'], ...agent } : { ...a, permission: 'read' as const, shell: 'none' as const }));
  return c;
};

const say = () => forum.append('squads', { kind: 'post', author: { type: 'person' }, text: '@turn do the budget', mentions: ['turn'] })[0];
const place = (): MentionPlace => ({ thread: 'squads', kind: 'channel', squad: null, repos: [], ref: 'app#7', title: 'The thing' });
const withDisplay = (): FakeSandbox => fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/s/x11/X99', kind: 'sandbox' } });
const records = (): ProcedureRecord[] => {
  const dir = proceduresPath(root);
  return existsSync(dir) ? readdirSync(dir).filter((f) => /^p-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : [];
};

function world(o: { agent?: Record<string, unknown>; withHandoff?: boolean } = {}) {
  const engine = fakeEngine();
  const handoff = o.withHandoff ? fakeHandoff() : undefined;
  const c = config(o.agent);
  const d: MentionDeps = {
    forum,
    config: () => c,
    sandbox: withDisplay(),
    env: () => ({ fallbackCwd: root }),
    screens: () => ({ sessions: screens.sessions, asks: screens.asks, ...(handoff ? { handoff: handoff.service } : {}) }),
    kept: createKeptSessions(),
    stops: createCallStops(),
    procedures: createProceduresPort({ config: () => c, dir: root }),
    engine,
  };
  return { d, engine, handoff };
}

const text = (r: { text: string } | undefined): string => r?.text ?? '';
const open = (call: AgentCall, url: string) => call.screen!.browser!.call('browser_navigate', { url });

describe('an agent mentioned in a conversation', () => {
  it('is given the draft with its browser, drafts what the browser did, and saves it as a gui procedure with the site as the key', async () => {
    screens = fakeScreens();
    const { d, engine } = world();
    let drafted = '';
    let saved = '';
    engine.script('turn', async (call) => {
      expect(call.procedures?.draft).toBeTypeOf('function');
      await open(call, 'https://docs.example.com/budget');
      await open(call, 'https://docs.example.com/budget/summary?x=1#top');
      drafted = text(await call.procedures?.draft?.({}));
      saved = text(await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Open the budget summary' }));
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(drafted).toContain('1. Open /budget on docs.example.com');
    expect(drafted).toContain('2. Open /budget/summary on docs.example.com');
    expect(drafted).not.toContain('x=1');
    expect(saved).toMatch(/^Saved p-[0-9a-f]{8} at revision 1/);
    const [rec] = records();
    expect(rec).toMatchObject({ kind: 'gui', key: 'docs.example.com', keyedBy: 'app', stepsFrom: 'recording', origin: { by: 'turn', surface: 'channel', ref: 'squads' } });
    expect(rec.origin.handoff).toBeUndefined();
    expect(forum.read('squads', 0, 100)?.messages.some((m) => m.code === 'runner.procedures.saved')).toBe(true);
  });

  it('is told in its rules to keep a screen task with the draft, and an agent with no browser is not', async () => {
    const gui = cycleWords('runner.rules.proceduresGui');
    const base = cycleWords('runner.rules.procedures');
    screens = fakeScreens();
    const withScreen = world();
    withScreen.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), withScreen.d);
    expect(withScreen.engine.calls[0].system).toContain(base);
    expect(withScreen.engine.calls[0].system).toContain(gui);
    expect(withScreen.engine.calls[0].system).toContain('procedures_draft');
    expect(gui).toMatch(/whole screen from when it opened|tela inteira desde que ela abriu/);
    const without = world({ agent: { screen: false } });
    without.engine.script('turn', () => ({ text: 'Done.' }));
    await answerMentions(place(), say(), without.d);
    expect(without.engine.calls[0].system).toContain(base);
    expect(without.engine.calls[0].system).not.toContain(gui);
    expect(without.engine.calls[0].system).not.toContain('procedures_draft');
  });

  it('drafts the whole screen: the steps an earlier answer took on the screen kept between messages are in this one too (#187)', async () => {
    screens = fakeScreens();
    const { d, engine } = world();
    let second = '';
    engine.script('turn', async (call) => {
      if (engine.calls.length === 1) {
        await open(call, 'https://docs.example.com/earlier');
        return { text: 'First.' };
      }
      await open(call, 'https://docs.example.com/later');
      second = text(await call.procedures?.draft?.({}));
      return { text: 'Second.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(second).toContain('1. Open /earlier on docs.example.com');
    expect(second).toContain('2. Open /later on docs.example.com');
    expect(second).toContain('on this screen since it opened, in all your answers');
  });

  it('starts the next draft of the screen after the steps a save used, and after the steps seen when it read the procedure it followed (#187)', async () => {
    screens = fakeScreens();
    const { d, engine } = world();
    const drafts: string[] = [];
    engine.script('turn', async (call) => {
      const n = engine.calls.length;
      if (n === 1) {
        await open(call, 'https://docs.example.com/first');
        await open(call, 'https://docs.example.com/second');
        drafts.push(text(await call.procedures?.draft?.({})));
        await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Open the first pages' });
      } else if (n === 2) {
        // A save moved the mark: only this answer's step is in the draft, though the screen is the same.
        await open(call, 'https://docs.example.com/third');
        drafts.push(text(await call.procedures?.draft?.({})));
        // Reading the procedure moves it to the screen's last step, so what came before is not the changed part.
        await call.procedures?.get({ id: records()[0].id });
        await open(call, 'https://docs.example.com/fourth');
        drafts.push(text(await call.procedures?.draft?.({})));
      }
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(drafts[0]).toContain('1. Open /first on docs.example.com');
    expect(drafts[1]).toContain('1. Open /third on docs.example.com');
    expect(drafts[1]).not.toContain('/first');
    expect(drafts[1]).not.toContain('/second');
    expect(drafts[2]).toContain('1. Open /fourth on docs.example.com');
    expect(drafts[2]).not.toContain('/third');
  });

  it('starts a new screen at the beginning: the mark a save left on the closed one does not hide its steps', async () => {
    screens = fakeScreens();
    const { d, engine } = world();
    let second = '';
    engine.script('turn', async (call) => {
      if (engine.calls.length === 1) {
        await open(call, 'https://docs.example.com/a');
        await open(call, 'https://docs.example.com/b');
        await open(call, 'https://docs.example.com/c');
        await call.procedures?.draft?.({});
        await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Open a, b and c' });
        return { text: 'First.' };
      }
      await open(call, 'https://docs.example.com/fresh');
      second = text(await call.procedures?.draft?.({}));
      return { text: 'Second.' };
    });
    await answerMentions(place(), say(), d);
    const [kept] = screens.sessions.list();
    expect(screens.sessions.markOf(kept.key)).toBe(3);
    await screens.sessions.close(kept.key);
    await answerMentions(place(), say(), d);
    expect(screens.sessions.markOf(kept.key)).toBe(0);
    expect(second).toContain('1. Open /fresh on docs.example.com');
  });

  it('has no draft in a call without the app\'s browser, and a gui save there is refused', async () => {
    screens = fakeScreens();
    const { d, engine } = world({ agent: { screen: false } });
    let save = '';
    engine.script('turn', async (call) => {
      expect(call.procedures).toBeDefined();
      expect(call.procedures?.draft).toBeUndefined();
      save = text(await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'x' }));
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(save).toMatch(/this call has no browser of the app/);
    expect(records()).toEqual([]);
  });

  it('refuses what the person typed in a hand-off in a save of any kind, and holds a record written after one', async () => {
    screens = fakeScreens();
    const { d, engine, handoff } = world({ withHandoff: true });
    let refused = '';
    let held = '';
    engine.script('turn', async (call) => {
      await open(call, 'https://docs.example.com/login');
      // What the person typed while they had the screen: the call's own typed values, the ones the browser's results are masked with.
      call.screen!.typed!.add([SECRET]);
      await call.procedures?.draft?.({});
      refused = text(await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Log in', pitfalls: [`The code ${SECRET} fails`] }));
      held = text(await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Log in' }));
      return { text: 'Done.' };
    });
    await answerMentions(place(), say(), d);
    expect(handoff?.calls[0].typed).toBeDefined();
    expect(refused).toMatch(/^Not saved: pitfalls\[0\] holds text the person typed/);
    expect(refused).not.toContain('correct horse');
    expect(held).toContain('waits for their review');
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ reviewed: false, origin: { handoff: true } });
    const notice = forum.read('squads', 0, 100)?.messages.find((m) => m.code === 'runner.procedures.heldForReview');
    expect(notice?.params).toMatchObject({ title: 'Log in' });
    expect(JSON.stringify(forum.read('squads', 0, 100))).not.toContain('correct horse');
  });

  it('holds a record written in a later answer on a screen where the person already used it, though the values of that answer are gone', async () => {
    screens = fakeScreens();
    const { d, engine, handoff } = world({ withHandoff: true });
    engine.script('turn', async (call) => {
      if (engine.calls.length === 1) {
        call.screen!.typed!.add([SECRET]);
        // The service learns of a hand-off when one is requested and taken; the test stands in for it the way the service's own record does.
        vi.spyOn(handoff!.service, 'hadHandoff').mockReturnValue(true);
        return { text: 'First.' };
      }
      await open(call, 'https://docs.example.com/budget');
      await call.procedures?.draft?.({});
      await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Open the budget' });
      return { text: 'Second.' };
    });
    await answerMentions(place(), say(), d);
    await answerMentions(place(), say(), d);
    expect(records()[0].origin.handoff).toBe(true);
  });
});

describe('a working stage', () => {
  it('gets the draft of its own steps under the stage\'s key, saves from it, and keeps the record out of every prompt once the person used the screen', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const handoff = fakeHandoff();
    const b = await boot({
      dir: root,
      // The hub is what makes the screen one the person can take; without it no hand-off is offered.
      screens: { open: vi.fn(async () => true), finish: vi.fn(async () => null), end: vi.fn(), state: vi.fn(() => ({})), frame: vi.fn() } as unknown as ScreenHub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      procedures: createProceduresPort({ config: getConfig, dir: root }),
      configure: (c) => {
        c.language = 'en';
        c.runner.sandbox.display = true;
        c.runner.procedures = true;
        Object.assign(c.agents.team.find((a) => a.id === 'planner')!, { screen: true, shell: 'none', allowedHosts: ['docs.example.com'] });
      },
    });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    let drafted = '';
    let saved = '';
    b.engine.script('planner', async (call) => {
      await call.screen!.browser!.call('browser_navigate', { url: 'https://docs.example.com/plan' });
      call.screen!.typed!.add([SECRET]);
      drafted = text(await call.procedures?.draft?.({}));
      saved = text(await call.procedures?.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Open the plan' }));
      return work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] });
    });
    b.engine.script('developer', () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
    let run = await b.runner.start('app#101');
    // The stage of the planner comes after the refinement's gate.
    for (let i = 0; i < 6 && !drafted; i++) {
      await b.settle();
      run = b.runner.get(run.id)!;
      if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    }
    await b.settle();
    expect(drafted).toContain('1. Open /plan on docs.example.com');
    expect(saved).toContain('waits for their review');
    expect(b.engine.calls.find((c) => c.agent.id === 'planner')?.system).toContain(cycleWords('runner.rules.proceduresGui'));
    expect(b.engine.calls.find((c) => c.agent.id === 'refiner')?.system).not.toContain(cycleWords('runner.rules.proceduresGui'));
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ kind: 'gui', keyedBy: 'app', origin: { by: 'planner', surface: 'stage', handoff: true } });
    expect(b.thread(run).find((m) => m.code === 'runner.procedures.heldForReview')?.stage).toBeDefined();
  });
});
