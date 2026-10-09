// The live screen in a run's stage (#157): the QA stage with a virtual display opens it before the agent's first command, the run carries it only while the stage works and
// never saves it, and it ends with the stage however the stage ended and before its sandbox is taken away. The display is a fake connection and the sandbox runs nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { runThreadId } from '../src/shared/forum';
import type { Run } from '../src/shared/runs';
import type { ScreenSocket } from '../src/main/sandbox/session';
import { type ScreenHub, createScreenHub } from '../src/main/screen/hub';
import { type Boot, type FakeSession, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';
import { type FakeConn, fakeConn } from './helpers/screen';

vi.setConfig({ testTimeout: 30_000 });

const shellOf = (c: WorkspaceConfig, id: string, shell: 'none' | 'allowlist' | 'sandbox' | 'host') => {
  c.agents.team.find((a) => a.id === id)!.shell = shell;
};

function easy(b: Boot, qa?: Parameters<Boot['engine']['script']>[1]): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script(
    'qa',
    qa ??
      (async (call) => {
        const evidenceIds = await keepQaEvidence(call);
        return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
      }),
  );
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

const SOCKET: ScreenSocket = { socket: '/stage/x11/X99', kind: 'sandbox' };

function screens(o: { connectFails?: boolean; forum?: () => Boot['forum'] } = {}) {
  const conn: FakeConn = fakeConn();
  const events: string[] = [];
  const connected: string[] = [];
  const hub: ScreenHub = createScreenHub({
    enabled: true,
    encoder: { encode: () => ({ jpeg: Uint8Array.from([1]), width: 1, height: 1 }) },
    connect: async (socket) => {
      connected.push(socket);
      events.push('connect');
      if (o.connectFails) throw new Error('refused');
      return conn;
    },
    note: (run, stage, code, params) => o.forum?.().append(runThreadId(run), { kind: 'system', author: { type: 'app' }, code, params, stage }),
  });
  return { conn, hub, events, connected };
}

const passes = async (call: Parameters<Parameters<Boot['engine']['script']>[1]>[0]) => {
  const evidenceIds = await keepQaEvidence(call);
  return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
};

const savedRuns = (b: Boot): Record<string, unknown>[] => {
  const dir = join(b.dir, 'runs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>);
};

describe('a QA stage with a virtual display', () => {
  it.each(['sandbox', 'host'] as const)('opens the live screen of an agent set to the %s before it runs a command, and the run carries it only while the stage works', async (shell) => {
    const s = screens();
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: shell } });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', shell) });
    let during: Run | undefined;
    easy(b, async (call) => {
      s.events.push('agent');
      during = b.runner.list()[0];
      // An agent that runs commands on this computer waits for the person's yes: the order is what the events say.
      if (shell === 'sandbox') await call.exec?.exec('echo hi');
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(s.connected).toEqual(['/stage/x11/X99']);
    expect(s.events.slice(0, 2)).toEqual(['connect', 'agent']);
    expect(during?.screen).toMatchObject({ stage: 'qa', width: 8, height: 4, control: false });
    expect(during?.screen?.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The stage is over: the run is handed out with no screen, the connection is closed and nothing of it was written to the run's file.
    expect(b.runner.get(run.id)?.screen).toBeUndefined();
    expect(b.runner.list().every((r) => r.screen === undefined)).toBe(true);
    expect(s.conn.closed).toBe(true);
    expect(JSON.stringify(savedRuns(b))).not.toContain('"screen"');
    expect(JSON.stringify(b.runs.get(run.id))).not.toContain('"screen"');
  });

  it('ends the live screen before its sandbox is taken away', async () => {
    const s = screens();
    const states: (string | null)[] = [];
    let id = '';
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET, onClose: () => void states.push(s.hub.state(id)?.stage ?? null) });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    easy(b, (call) => {
      id = b.runner.list()[0].id;
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(states).toEqual([null]);
  });

  it('ends it when the stage fails, and reads nothing of the screen afterwards', async () => {
    const s = screens();
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    easy(b, async () => {
      throw new Error('the model stopped answering');
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'qa');
    expect(run.status).toBe('failed');
    expect(b.runner.get(run.id)?.screen).toBeUndefined();
    expect(s.conn.closed).toBe(true);
    const grabs = s.conn.grabs;
    expect(await s.hub.frame(run.id, 0, 640)).toEqual({ state: 'none' });
    expect(s.conn.grabs).toBe(grabs);
  });

  it('says in the thread that the live screen is not available when the display cannot be reached, and the stage goes on without it', async () => {
    const s = screens({ connectFails: true });
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    let during: Run | undefined;
    easy(b, (call) => {
      during = b.runner.list()[0];
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(during?.screen).toBeUndefined();
    expect(b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.screen.noConnect')).toHaveLength(1);
  });

  it.each([
    ['a display that is missing', { browsers: null, display: 'missing' as const }, undefined],
    ['a display that failed', { browsers: null, display: 'failed' as const }, undefined],
    ['a stage that asked for no display', { browsers: '/b', display: null }, undefined],
  ])('has no live screen with %s', async (_name, gui, screen) => {
    const s = screens();
    const sandbox = fakeSandbox({ gui, ...(screen ? { screen } : {}) });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    let during: Run | undefined;
    easy(b, (call) => {
      during = b.runner.list()[0];
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(during?.screen).toBeUndefined();
    expect(s.connected).toEqual([]);
    expect(b.thread(run).some((m) => m.kind === 'system' && m.code === 'runner.screen.noConnect')).toBe(false);
  });

  it('opens nothing for a stage that is not QA, even for an agent with a sandbox, and for a runner given no hub', async () => {
    const s = screens();
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET });
    const b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'developer', 'sandbox') });
    easy(b);
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    // The fake gives a session with a screen to whatever stage opens it: the app opens a live screen only for a stage that asked for a display.
    expect(sandbox.opened.map((o) => o.options.display)).toEqual([false]);
    expect(s.connected).toEqual([]);
    const none = await boot({ sandbox: fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET }), configure: (c) => shellOf(c, 'qa', 'sandbox') });
    easy(none);
    let other = await none.runner.start('app#101');
    other = await reach(none, other, 'ready');
    expect(other.status).toBe('done');
    expect(none.runner.get(other.id)?.screen).toBeUndefined();
  });
});

describe('the person using the screen of a QA stage', () => {
  it('is not a command of the agent: it does not wait for one that is running, is not in the stage\'s log or its commands, and the conversation says it in the app\'s own words', async () => {
    let b!: Boot;
    const s = screens({ forum: () => b.forum });
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET });
    b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    const answers: unknown[] = [];
    let session!: FakeSession;
    // What the app itself ran before QA is in the log already; the person's input must add nothing to it.
    let before: { log: number; asked: number; lines: number } = { log: -1, asked: -1, lines: -1 };
    const execLines = (id: string) => b.thread(id).filter((m) => m.kind === 'system' && m.code === 'runner.exec').length;
    easy(b, async (call) => {
      const id = b.runner.list()[0].id;
      session = call.exec as FakeSession;
      before = { log: session.log.length, asked: session.asked.length, lines: execLines(id) };
      // A command of the agent that does not end: whatever waited behind it would wait for ever.
      session.exec = () => new Promise(() => undefined);
      void session.exec('sleep 600');
      answers.push(await s.hub.control(id, true));
      answers.push(await s.hub.input(id, [{ t: 'move', x: 2, y: 1 }, { t: 'button', b: 1, down: true }, { t: 'button', b: 1, down: false }]));
      expect(b.runner.get(id)?.screen?.control).toBe(true);
      answers.push(await s.hub.control(id, false));
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(answers).toEqual([{ ok: true }, { ok: true, delivered: 3, rejected: 0 }, { ok: true }]);
    expect(s.conn.sent.flat()).toHaveLength(3);
    // Not in the agent's log, not asked of its session, not a command in the thread.
    expect(before.log).toBeGreaterThanOrEqual(0);
    expect(session.log).toHaveLength(before.log);
    expect(session.asked).toHaveLength(before.asked);
    const lines = b.thread(run).filter((m) => m.kind === 'system');
    expect(lines.filter((m) => m.code === 'runner.exec')).toHaveLength(before.lines);
    const ours = lines.filter((m) => m.code?.startsWith('runner.screen.'));
    expect(ours.map((m) => m.code)).toEqual(['runner.screen.controlOn', 'runner.screen.used', 'runner.screen.controlOff']);
    expect(ours.every((m) => m.author.type === 'app' && m.stage === 'qa')).toBe(true);
    expect(ours[1].params).toMatchObject({ agent: 'qa' });
  });

  it('is given back when the stage ends with control still on: the conversation says so and the connection closes', async () => {
    let b!: Boot;
    const s = screens({ forum: () => b.forum });
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: SOCKET });
    b = await boot({ sandbox, screens: s.hub, configure: (c) => shellOf(c, 'qa', 'sandbox') });
    easy(b, async (call) => {
      const id = b.runner.list()[0].id;
      await s.hub.control(id, true);
      await s.hub.input(id, [{ t: 'key', key: 'A', down: true }]);
      return passes(call);
    });
    let run = await b.runner.start('app#101');
    run = await reach(b, run, 'ready');
    expect(run.status).toBe('done');
    expect(b.thread(run).filter((m) => m.code?.startsWith('runner.screen.')).map((m) => m.code)).toEqual(['runner.screen.controlOn', 'runner.screen.used', 'runner.screen.controlOff']);
    // What was held down was put up before the display went.
    expect(s.conn.sent.flat().filter((e) => e.type === 'key' && !e.down).length).toBe(2);
    expect(s.conn.closed).toBe(true);
  });
});
