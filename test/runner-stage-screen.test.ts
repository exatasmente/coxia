// A working stage's screen (#177, acceptance 1 for stages): the agent of any stage that has the switch gets the app's browser, drawn on the display of its shell session or on one of
// the app's own, under the stage's key; a QA stage without the switch is as it was; and the browser ends with the stage, before the display it draws on. The browser is a scripted
// fake and the sandbox runs nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { listAudit } from '../src/main/auditoria';
import type { Run } from '../src/shared/runs';
import type { AgentCall } from '../src/main/agents';
import type { ScreenHub } from '../src/main/screen/hub';
import { type Boot, type FakeSandbox, type FakeSession, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';
import { type FakeHandoff, fakeHandoff } from './helpers/handoff';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

vi.setConfig({ testTimeout: 30_000 });

const agentOf = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;

function easy(b: Boot, seen: Record<string, AgentCall> = {}, during: Record<string, () => void> = {}): void {
  const note = (id: string, call: AgentCall) => {
    seen[id] = call;
    during[id]?.();
  };
  b.engine.script('refiner', (c) => (note('refiner', c), work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' })));
  b.engine.script('planner', (c) => (note('planner', c), work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] })));
  b.engine.script('developer', async (c, tools) => {
    note('developer', c);
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', (c) => (note('reviewer', c), work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })));
  b.engine.script('qa', async (call) => {
    note('qa', call);
    const evidenceIds = await keepQaEvidence(call);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
  });
}

async function reach(b: Boot, run: Run, id: string): Promise<Run> {
  for (let i = 0; i < 20; i++) {
    await b.settle();
    run = b.runner.get(run.id)!;
    if (run.stage === id && run.status !== 'working') return run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else break;
  }
  return run;
}

const hubFake = (live = false) => {
  const events: string[] = [];
  const hub = {
    open: vi.fn(async (s: { key: string; socket: string }) => (events.push(`open:${s.key}:${s.socket}`), true)),
    finish: vi.fn(async (key: string) => (events.push(`finish:${key}`), null)),
    end: vi.fn((key: string) => void events.push(`end:${key}`)),
    state: vi.fn(() => (live ? {} : null)),
    frame: vi.fn(),
  };
  return { hub: hub as unknown as ScreenHub, events };
};

/** The real sandbox gives a session a display only when the stage asked for one; the fake gives the one it was made with, so the answer is taken away when nobody asked. */
const displayOnRequest = (inner: FakeSandbox): FakeSandbox => {
  const strip = (session: FakeSession, asked: boolean | undefined): FakeSession => {
    if (!asked) {
      const bare = session as { screen?: unknown; gui?: unknown };
      delete bare.screen;
      delete bare.gui;
    }
    return session;
  };
  return Object.assign(Object.create(inner) as FakeSandbox, {
    open: async (o: Parameters<FakeSandbox['open']>[0]) => strip((await inner.open(o)) as FakeSession, o.display),
    openHost: async (o: Parameters<FakeSandbox['openHost']>[0]) => strip((await inner.openHost(o)) as FakeSession, o.display),
  });
};

let screens: FakeScreens | null = null;
afterEach(() => {
  screens?.dispose();
  screens = null;
});

describe('the screen of a stage', () => {
  it('gives a stage with no shell the app\'s browser on a display of the app\'s own, under the stage\'s key, and ends it with the stage', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const h = hubFake();
    const seen: Record<string, AgentCall> = {};
    const open: string[][] = [];
    const b = await boot({
      screens: h.hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'planner'), { screen: true, shell: 'none' });
      },
    });
    easy(b, seen, { planner: () => open.push(screens!.sessions.list().map((s) => s.key)) });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const planner = seen.planner;
    expect(planner.screen?.browser?.tools().map((t) => t.name)).toContain('browser_navigate');
    expect(planner.screen?.confirm).toBeTypeOf('function');
    expect(screens.starts).toHaveLength(1);
    expect(screens.starts[0].display).toBeNull();
    expect(open[0]).toEqual([`run:${run.id}`]);
    // The live screen follows the display the app made, and the stage's recording is taken before the browser (and the display with it) ends.
    const opened = h.events.indexOf(`open:run:${run.id}:/own/X77`);
    expect(opened).toBeGreaterThan(-1);
    expect(h.events.indexOf(`finish:run:${run.id}`, opened)).toBeGreaterThan(opened);
    expect(screens.log.indexOf('close')).toBeGreaterThan(-1);
    expect(screens.sessions.list()).toEqual([]);
    expect(screens.lines.map((l) => l.code)).toEqual(expect.arrayContaining(['runner.screen.opened', 'runner.screen.closed']));
    expect(screens.lines.find((l) => l.code === 'runner.screen.closed')).toMatchObject({ thread: `run-${run.id}`, params: { agent: 'planner' } });
  });

  it('hands the stage\'s abort to the screen, so a stage that is cancelled while the browser starts does not wait for it', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const asked: (AbortSignal | undefined)[] = [];
    const acquire = screens.sessions.acquire.bind(screens.sessions);
    screens.sessions.acquire = (req) => (asked.push(req.signal), acquire(req));
    const b = await boot({
      screens: hubFake().hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'planner'), { screen: true, shell: 'none' });
      },
    });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeInstanceOf(AbortSignal);
  });

  it('lends the browser the display of the agent\'s own shell session, and the browser ends before the session does', async () => {
    screens = fakeScreens();
    const h = hubFake();
    const log = screens.log;
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' }, onClose: () => void log.push('session.close') });
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: h.hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'developer'), { screen: true, shell: 'sandbox' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    // The sandbox was asked for a display because the agent has a screen, though its stage is not QA.
    expect(sandbox.opened.find((o) => o.options.display)).toBeTruthy();
    expect(screens.starts[0].display).toEqual({ socket: '/stage/x11/X99', name: 'X99' });
    expect(seen.developer.screen?.browser).toBeTruthy();
    // The stage registered its own session's display with the hub (not the sessions): once, under the run key.
    expect(h.events.filter((e) => e.startsWith('open:'))).toEqual([`open:run:${run.id}:/stage/x11/X99`]);
    // The browser ends first: the display it draws on is the session's.
    const closed = screens.log.indexOf('close');
    expect(closed).toBeGreaterThan(-1);
    expect(screens.log.indexOf('session.close')).toBeGreaterThan(closed);
  });

  it('closes the browser of a stage that failed, and tells the thread why', async () => {
    screens = fakeScreens();
    const b = await boot({
      screens: hubFake().hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'refiner'), { screen: true, shell: 'none' });
      },
    });
    easy(b);
    b.engine.script('refiner', async () => {
      throw new Error('the model stopped answering');
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'refinement');
    expect(run.status).toBe('failed');
    expect(screens.sessions.list()).toEqual([]);
    expect(screens.log).toContain('close');
  });

  it('closes what an earlier stage left open in the run\'s thread when the next stage begins', async () => {
    screens = fakeScreens();
    const b = await boot({ screens: hubFake().hub, sessions: screens.sessions, asks: screens.asks, configure: (c) => void (c.runner.sandbox.display = true) });
    easy(b);
    // A mentioned agent's screen in the run's thread is the run's: it goes when a stage starts.
    let run = await b.runner.start('app#101');
    await b.settle();
    run = b.runner.get(run.id)!;
    const key = `call:run-${run.id}:planner`;
    Object.assign(agentOf((await import('../src/main/workspaceConfig')).getConfig(), 'planner'), { screen: true });
    const got = await screens.sessions.acquire({ key, agent: { id: 'planner', screen: true, shell: 'none' }, thread: `run-${run.id}`, place: 'conversation', seesImages: true });
    expect(got.ok).toBe(true);
    if (got.ok) got.lease.release();
    expect(screens.sessions.has(key)).toBe(true);
    await screens.sessions.closeThread(`run-${run.id}`, 'stage');
    expect(screens.sessions.has(key)).toBe(false);
  });
});

describe('what a stage is offered of the screen', () => {
  /** `display`: the stage asked its sandbox for a display (the sandbox gives none when the workspace's switch is off). */
  type Row = { name: string; agent: string; shell: 'none' | 'allowlist' | 'sandbox' | 'host'; screen?: boolean; hosts?: string[]; workspace?: false; display: boolean; browser: boolean; confirm: boolean; asksDisplay: boolean };
  const rows: Row[] = [
    { name: 'a QA stage with no switch keeps its display and gets only the confirmation tool', agent: 'qa', shell: 'sandbox', display: true, browser: false, confirm: true, asksDisplay: true },
    { name: 'a QA stage with the switch gets the browser on its display', agent: 'qa', shell: 'sandbox', screen: true, display: true, browser: true, confirm: true, asksDisplay: true },
    { name: 'a non-QA stage with the switch and a sandbox gets a display and the browser', agent: 'developer', shell: 'sandbox', screen: true, display: true, browser: true, confirm: true, asksDisplay: true },
    { name: 'a non-QA stage with the switch and no shell gets the browser and no session', agent: 'planner', shell: 'none', screen: true, display: false, browser: true, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage with the switch and the allowlist gets the browser and no session', agent: 'developer', shell: 'allowlist', screen: true, display: false, browser: true, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage with no switch is offered nothing', agent: 'developer', shell: 'sandbox', display: false, browser: false, confirm: false, asksDisplay: false },
    { name: 'a non-QA stage with a host list is offered only the confirmation tool', agent: 'developer', shell: 'sandbox', hosts: ['app.example.com'], display: false, browser: false, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage on the computer\'s shell is offered the confirmation tool', agent: 'developer', shell: 'host', display: false, browser: false, confirm: true, asksDisplay: false },
    { name: 'a QA stage with no switch on the computer\'s shell keeps its display and gets only the confirmation tool', agent: 'qa', shell: 'host', display: true, browser: false, confirm: true, asksDisplay: true },
    { name: 'a non-QA stage with the switch on the computer\'s shell gets a display and the browser', agent: 'developer', shell: 'host', screen: true, display: true, browser: true, confirm: true, asksDisplay: true },
    { name: 'with the workspace\'s display off, a stage with the switch and a sandbox gets no display and no browser', agent: 'developer', shell: 'sandbox', screen: true, workspace: false, display: true, browser: false, confirm: false, asksDisplay: false },
    { name: 'with the workspace\'s display off, a stage with the switch and no shell gets no browser', agent: 'planner', shell: 'none', screen: true, workspace: false, display: false, browser: false, confirm: false, asksDisplay: false },
    { name: 'with the workspace\'s display off, a QA stage gets no display', agent: 'qa', shell: 'sandbox', workspace: false, display: true, browser: false, confirm: false, asksDisplay: false },
  ];
  it.each(rows)('$name', async (row) => {
    screens = fakeScreens({ configure: (c) => void (c.runner.sandbox.display = row.workspace !== false) });
    const sandbox = displayOnRequest(fakeSandbox({ gui: { browsers: null, display: row.workspace === false ? null : 'on' }, screen: { socket: '/stage/x11/X99', kind: row.shell === 'host' ? 'host' : 'sandbox' } }));
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake().hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = row.workspace !== false;
        c.runner.sandbox.network = 'off';
        Object.assign(agentOf(c, row.agent), { shell: row.shell, ...(row.screen ? { screen: true } : {}), ...(row.hosts ? { allowedHosts: row.hosts } : {}) });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    if (row.shell === 'host') await b.settle();
    const call = seen[row.agent];
    expect(call, 'the stage ran').toBeTruthy();
    expect(!!call.screen?.browser).toBe(row.browser);
    expect(!!call.screen?.confirm).toBe(row.confirm);
    expect(sandbox.opened.some((o) => o.options.display === true)).toBe(row.display);
    expect(screens.starts.length).toBe(row.browser ? 1 : 0);
    if (row.browser) expect(screens.starts[0].display === null).toBe(!row.asksDisplay);
  });
});

// Acceptance 18, the voluntary case: a QA agent drives a browser of its own from its shell and never calls `screen_confirm`. The app sees none of it: no hold, no confirmation, no
// step log and no mask. What it still has is the recording of the display, the agent's host list on the sandbox and the audit lines of the session and of the commands.
describe('the shell path: an agent that runs its own browser and never calls the confirmation tool', () => {
  it('produces no hold and no confirmation and has no step log, and keeps its recording, its host list and its audited session', async () => {
    screens = fakeScreens();
    const { hub, events } = hubFake();
    const sandbox = displayOnRequest(fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' } }));
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
        c.runner.sandbox.network = 'off';
        Object.assign(agentOf(c, 'qa'), { shell: 'sandbox', allowedHosts: ['app.example.com'] });
      },
    });
    easy(b, seen);
    // The agent's own Playwright, run as a command; the confirmation tool is there to call and is never called.
    b.engine.script('qa', async (call) => {
      seen.qa = call;
      await call.exec?.exec('node drive-the-page.js');
      const evidenceIds = await keepQaEvidence(call);
      return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const call = seen.qa;
    expect(call.screen?.confirm, 'the tool is offered').toBeTypeOf('function');
    expect(call.screen?.browser, 'and the app\'s browser is not').toBeUndefined();
    // Nothing was held, nothing asked, no step kept, no browser session to mask.
    expect(screens.asks.list()).toEqual([]);
    expect(screens.sessions.list()).toEqual([]);
    expect(screens.sessions.stepsOf(`run:${run.id}`)).toEqual([]);
    expect(screens.sessions.masksOf(`run:${run.id}`)).toBeNull();
    const audited = listAudit().map((e) => e.kind);
    expect(audited).not.toContain('screen-hold');
    expect(audited).not.toContain('screen-confirm');
    // What the app still has: the display's recording (finished with the stage), the host list on the sandbox, the session lines and the command.
    expect(events).toContain(`finish:run:${run.id}`);
    expect(sandbox.opened.find((o) => o.options.display === true)?.options.agent?.allowedHosts).toEqual(['app.example.com']);
    expect(audited).toEqual(expect.arrayContaining(['screen-open', 'screen-close', 'exec']));
  });
});

describe('the recording of an agent called in the run\'s thread', () => {
  it('is kept as a piece of the run\'s evidence, as a stage\'s is, and a recording that failed is said in the thread', async () => {
    const b = await boot();
    easy(b);
    let run = await b.runner.start('app#101');
    await b.settle();
    run = b.runner.get(run.id)!;
    const { webmHead } = await import('./helpers/webm');
    const meta = { durationMs: 5000, width: 8, height: 4, marks: [] };
    expect(b.runner.keepCallRecording(run.id, 'planner', { ok: true, bytes: webmHead(300), meta })).toBe('kept');
    const kept = b.runner.evidence(run.id)?.filter((e) => e.recording);
    expect(kept).toHaveLength(1);
    expect(kept?.[0]).toMatchObject({ kind: 'webm', by: 'planner', bytes: 312 });
    expect(b.thread(run).some((m) => m.code === 'runner.evidence.recorded')).toBe(true);
    expect(b.runner.keepCallRecording(run.id, 'planner', { ok: false, reason: 'encoder' })).toBe('not');
    expect(b.thread(run).filter((m) => m.code === 'runner.screen.notKept')).toHaveLength(1);
    expect(b.runner.keepCallRecording(run.id, 'planner', null)).toBe('not');
    expect(b.runner.keepCallRecording('r-gone', 'planner', { ok: true, bytes: webmHead(300), meta })).toBe('not');
  });
});

describe('the hand-off of a stage', () => {
  const sandboxFor = (shell: 'sandbox' | 'host', atOpen?: (n: number) => void, handoff?: FakeHandoff) => {
    const inner = displayOnRequest(fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: shell } }));
    const wrap = Object.assign(Object.create(inner) as FakeSandbox, {
      open: async (o: Parameters<FakeSandbox['open']>[0]) => (atOpen?.(handoff?.begun.length ?? 0), inner.open(o)),
      openHost: async (o: Parameters<FakeSandbox['openHost']>[0]) => (atOpen?.(handoff?.begun.length ?? 0), inner.openHost(o)),
    });
    return { sandbox: wrap, inner };
  };

  it('begins the call before the sandbox opens, gives the sandbox its gate and its mask, and offers the tool with the call\'s typed values', async () => {
    screens = fakeScreens();
    const handoff = fakeHandoff();
    let begunAtOpen = -1;
    const { sandbox, inner } = sandboxFor('sandbox', (n) => void (begunAtOpen = n), handoff);
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'developer'), { screen: true, shell: 'sandbox' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const at = handoff.begun.findIndex((x) => x.agent === 'developer');
    expect(at).toBeGreaterThan(-1);
    expect(begunAtOpen).toBeGreaterThan(at);
    expect(handoff.begun[at]).toMatchObject({ key: `run:${run.id}`, thread: `run-${run.id}`, place: 'stage', issue: 101, agent: 'developer', paths: { browser: true, shell: 'sandbox' } });
    expect(handoff.begun[at].about).toContain('app#101');
    const options = inner.opened.find((o) => o.options.display)?.options;
    expect(options?.held).toBe(handoff.calls[at].active);
    expect(options?.mask).toBe(handoff.calls[at].typed.mask);
    expect(seen.developer.screen?.handoff).toBeTruthy();
    expect(seen.developer.screen?.typed).toBe(handoff.calls[at].typed);
    // The agent is told, because the tool is offered; a stage that is not offered it is not told.
    expect(seen.developer.system).toContain('screen_handoff');
    expect(seen.reviewer.system).not.toContain('screen_handoff');
  });

  it('gives a host session the same gate and mask, and words the warning for the computer\'s shell', async () => {
    screens = fakeScreens();
    const handoff = fakeHandoff();
    const { sandbox, inner } = sandboxFor('host');
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'developer'), { screen: true, shell: 'host' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    await b.settle();
    const at = handoff.begun.findIndex((x) => x.agent === 'developer');
    const host = inner.opened.find((o) => o.host);
    expect(host?.options.held).toBe(handoff.calls[at].active);
    expect(host?.options.mask).toBe(handoff.calls[at].typed.mask);
    expect(handoff.begun[at].paths).toEqual({ browser: true, shell: 'host' });
  });

  it('offers the tool to a stage with no shell whose screen is the app\'s own display, and words the warning for no programs', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const handoff = fakeHandoff();
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'planner'), { screen: true, shell: 'none' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    const at = handoff.begun.findIndex((x) => x.agent === 'planner');
    expect(handoff.begun[at].paths).toEqual({ browser: true, shell: 'none' });
    expect(seen.planner.screen?.handoff).toBeTruthy();
  });

  it('offers it to a QA stage with only the display it was given, and words the warning without the browser', async () => {
    screens = fakeScreens();
    const handoff = fakeHandoff();
    const { sandbox } = sandboxFor('sandbox');
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'qa'), { shell: 'sandbox' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    const at = handoff.begun.findIndex((x) => x.agent === 'qa');
    expect(handoff.begun[at].paths).toEqual({ browser: false, shell: 'sandbox' });
    expect(seen.qa.screen?.browser).toBeUndefined();
    expect(seen.qa.screen?.handoff).toBeTruthy();
  });

  it('does not offer it when the person cannot take the screen (the hub does not have it), nor to a stage that cannot have a screen', async () => {
    screens = fakeScreens();
    const handoff = fakeHandoff();
    const { sandbox } = sandboxFor('sandbox');
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake(false).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'developer'), { screen: true, shell: 'sandbox' });
      },
    });
    easy(b, seen);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(seen.developer.screen?.handoff).toBeUndefined();
    expect(seen.developer.screen?.typed).toBeUndefined();
    // The reviewer has no screen and no display: no call object was made for it.
    expect(handoff.begun.map((x) => x.agent)).not.toContain('reviewer');
    expect(seen.reviewer.screen).toBeUndefined();
  });

  it('stops the stage\'s clocks while the person is asked, and ends the request with no result when the stage ends', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const handoff = fakeHandoff();
    const b = await boot({
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'planner'), { screen: true, shell: 'none' });
      },
    });
    easy(b);
    let waiting: Promise<unknown> = Promise.resolve();
    let during = -1;
    let card = 0;
    b.engine.script('planner', (call) => {
      waiting = call.screen!.handoff!.request({ what: 'Log in to the site' });
      during = handoff.paused;
      card = handoff.asks.list().filter((a) => a.kind === 'handoff').length;
      return work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] });
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(during).toBe(1);
    expect(card).toBe(1);
    await expect(waiting).resolves.toBeNull();
    expect(handoff.paused).toBe(0);
    expect(handoff.asks.list()).toEqual([]);
  });

  // #177 hands the stage's abort to the screen and #178 to the hand-off: a cancel while the person has the screen must end both.
  it('ends a hand-off the person is in, and releases the screen, when the stage is cancelled', async () => {
    screens = fakeScreens({ ownDisplay: '/own/X77' });
    const handoff = fakeHandoff();
    const b = await boot({
      screens: hubFake(true).hub,
      sessions: screens.sessions,
      asks: screens.asks,
      handoff: handoff.service,
      configure: (c) => {
        c.runner.sandbox.display = true;
        Object.assign(agentOf(c, 'planner'), { screen: true, shell: 'none' });
      },
    });
    easy(b);
    let waiting: Promise<unknown> = Promise.resolve();
    let started = false;
    b.engine.script('planner', (call) => {
      started = true;
      waiting = call.screen!.handoff!.request({ what: 'Log in to the site' });
      return new Promise((_resolve, reject) => call.abort?.signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    });
    const run = await b.runner.start('app#101');
    await vi.waitFor(
      () => {
        if (b.runner.get(run.id)?.status === 'gate') b.runner.gate(run.id, 'approve');
        expect(started).toBe(true);
      },
      { timeout: 20_000, interval: 20 },
    );
    const key = `run:${run.id}`;
    await handoff.take(key);
    const call = handoff.calls[0];
    expect(call.active()).toBe(true);
    expect(handoff.hub.held(key)).toBe(true);
    expect(b.runner.cancel(run.id).status).toBe('cancelled');
    await b.settle();
    await expect(waiting).resolves.toBeNull();
    expect(call.active()).toBe(false);
    expect(handoff.hub.held(key)).toBe(false);
    expect(handoff.paused).toBe(0);
    expect(handoff.asks.list()).toEqual([]);
    // The browser ends with the stage: nothing of it is left open for the person to find.
    expect(screens.sessions.list()).toEqual([]);
  });
});
