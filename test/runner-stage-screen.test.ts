// A working stage's screen (#177, acceptance 1 for stages): the agent of any stage that has the switch gets the app's browser, drawn on the display of its shell session or on one of
// the app's own, under the stage's key; a QA stage without the switch is as it was; and the browser ends with the stage, before the display it draws on. The browser is a scripted
// fake and the sandbox runs nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import type { AgentCall } from '../src/main/agents';
import type { ScreenHub } from '../src/main/screen/hub';
import { type Boot, type FakeSandbox, type FakeSession, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';
import { type FakeScreens, fakeScreens } from './helpers/screenSessions';

vi.setConfig({ testTimeout: 30_000 });

const agentOf = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;

function easy(b: Boot, seen: Record<string, AgentCall> = {}, during: Record<string, () => void> = {}): void {
  const note = (id: string, call: AgentCall) => {
    seen[id] = call;
    during[id]?.();
  };
  b.engine.script('refiner', (c) => (note('refiner', c), work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' })));
  b.engine.script('planner', (c) => (note('planner', c), work('Plan.', { artifacts: [doc('2_PLAN.md')] })));
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

const hubFake = () => {
  const events: string[] = [];
  const hub = {
    open: vi.fn(async (s: { key: string; socket: string }) => (events.push(`open:${s.key}:${s.socket}`), true)),
    finish: vi.fn(async (key: string) => (events.push(`finish:${key}`), null)),
    end: vi.fn((key: string) => void events.push(`end:${key}`)),
    state: vi.fn(() => null),
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
  type Row = { name: string; agent: string; shell: 'none' | 'allowlist' | 'sandbox' | 'host'; screen?: boolean; hosts?: string[]; display: boolean; browser: boolean; confirm: boolean; asksDisplay: boolean };
  const rows: Row[] = [
    { name: 'a QA stage with no switch keeps its display and gets only the confirmation tool', agent: 'qa', shell: 'sandbox', display: true, browser: false, confirm: true, asksDisplay: true },
    { name: 'a QA stage with the switch gets the browser on its display', agent: 'qa', shell: 'sandbox', screen: true, display: true, browser: true, confirm: true, asksDisplay: true },
    { name: 'a non-QA stage with the switch and a sandbox gets a display and the browser', agent: 'developer', shell: 'sandbox', screen: true, display: true, browser: true, confirm: true, asksDisplay: true },
    { name: 'a non-QA stage with the switch and no shell gets the browser and no session', agent: 'planner', shell: 'none', screen: true, display: false, browser: true, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage with the switch and the allowlist gets the browser and no session', agent: 'developer', shell: 'allowlist', screen: true, display: false, browser: true, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage with no switch is offered nothing', agent: 'developer', shell: 'sandbox', display: false, browser: false, confirm: false, asksDisplay: false },
    { name: 'a non-QA stage with a host list is offered only the confirmation tool', agent: 'developer', shell: 'sandbox', hosts: ['app.example.com'], display: false, browser: false, confirm: true, asksDisplay: false },
    { name: 'a non-QA stage on the computer\'s shell is offered the confirmation tool', agent: 'developer', shell: 'host', display: false, browser: false, confirm: true, asksDisplay: false },
  ];
  it.each(rows)('$name', async (row) => {
    screens = fakeScreens();
    const sandbox = displayOnRequest(fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: row.shell === 'host' ? 'host' : 'sandbox' } }));
    const seen: Record<string, AgentCall> = {};
    const b = await boot({
      sandbox,
      screens: hubFake().hub,
      sessions: screens.sessions,
      asks: screens.asks,
      configure: (c) => {
        c.runner.sandbox.display = true;
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
