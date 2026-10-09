// The app's own recording of a QA stage's screen (#157) inside a run: what the agent cannot do with it and where it never goes. The recording is the app's piece of
// evidence: not citeable, not copied into the cycle folder, not sent to the code host. No model, no host, no network: the engine is scripted and the sandbox is the fake.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { putRecording } from '../src/main/evidence/recording';
import { evidencePath } from '../src/main/evidence/store';
import { type ScreenHub, createScreenHub } from '../src/main/screen/hub';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { runThreadId } from '../src/shared/forum';
import { recordEvidence } from '../src/shared/runs';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, fakeSandbox, keepQaEvidence, work } from './helpers/runner';
import { type FakeSink, fakeSink } from './helpers/recorderSink';
import { type FakeConn, fakeConn } from './helpers/screen';
import { CALL_AGENT_TOOL } from '../src/main/runner/tools';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import { webmHead } from './helpers/webm';

vi.setConfig({ testTimeout: 30_000 });

/** A run that already holds a recording of an earlier attempt of the QA stage, and a QA pass that cites it beside its own evidence. */
async function withEarlierRecording(configure: (b: Boot) => void = () => undefined): Promise<{ b: Boot; run: Run; cited: string[] }> {
  const b = await boot({
    sandbox: fakeSandbox(),
    configure: (c) => {
      c.language = 'en';
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
      c.runner.evidence = 'cycle';
    },
  });
  configure(b);
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => {
    // The earlier attempt of QA left a recording; it is on the run before QA starts.
    const run = b.runner.list()[0];
    const put = putRecording(b.deps.env().dataDir, run, { bytes: webmHead(64), stage: 'qa', by: 'qa', title: 'Screen recording', meta: { durationMs: 1000, width: 8, height: 4, marks: [] }, at: '2026-10-08T12:00:00.000Z' });
    if (!put.ok) throw new Error('not kept');
    b.runs.update(run.id, (r) => recordEvidence(r, put.record, '2026-10-08T12:00:00.000Z'));
    return work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  const cited: string[] = [];
  b.engine.script('qa', async (call) => {
    const own = await keepQaEvidence(call);
    // The agent names the recording as its proof, together with its own piece.
    cited.push(...own);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], evidence: ['ev-1', ...own], scenarios: [{ name: 's', result: 'pass', detail: '', evidenceIds: ['ev-1', ...own] }] });
  });
  let run = await b.runner.start('app#101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return { b, run, cited };
}

describe('the recording of an earlier attempt', () => {
  it('cannot be cited by the agent: the id is unknown, said in the conversation, and dropped from the scenario', async () => {
    const { b, run, cited } = await withEarlierRecording();
    expect(run.status).toBe('done');
    expect(cited).toEqual(['ev-2']);
    const qa = run.qa.at(-1);
    expect(qa?.scenarios[0].evidenceIds).toEqual(['ev-2']);
    const unknown = b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.evidence.unknown');
    expect(unknown.map((m) => m.params.id)).toEqual(['ev-1']);
  });

  it('is never copied into the cycle folder, not even when the workspace chooses to keep evidence there', async () => {
    const { run } = await withEarlierRecording();
    const folder = join(run.worktree, run.cycleFolder, 'evidence');
    expect(readdirSync(folder)).toEqual(['ev-2.txt']);
    expect(existsSync(join(folder, 'ev-1.webm'))).toBe(false);
    expect(run.evidence?.['ev-1']?.inCycle).toBeUndefined();
    expect(run.evidence?.['ev-2']?.inCycle).toBe(true);
  });
});

// ---- the recording kept at the end of the stage ---------------------------------------------------------------------------------------------------------------------

const shellOf = (c: WorkspaceConfig, id: string, shell: 'none' | 'allowlist' | 'sandbox' | 'host') => {
  c.agents.team.find((a) => a.id === id)!.shell = shell;
};

/** A real hub over a fake display and a fake encoder, writing its lines in the run's conversation like the app does. */
function screens(forum: () => Boot['forum'], sink: FakeSink) {
  const conn: FakeConn = fakeConn();
  const hub: ScreenHub = createScreenHub({
    enabled: true,
    encoder: { encode: () => ({ jpeg: Uint8Array.from([1]), width: 1, height: 1 }) },
    connect: async () => conn,
    sink: () => sink,
    note: (run, stage, code, params) => forum().append(runThreadId(run), { kind: 'system', author: { type: 'app' }, code, params, stage }),
  });
  return { conn, hub };
}

function easy(b: Boot, qa: Parameters<Boot['engine']['script']>[1]): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', qa);
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

const passes = async (call: Parameters<Parameters<Boot['engine']['script']>[1]>[0]) => {
  const evidenceIds = await keepQaEvidence(call);
  return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '', ...(evidenceIds.length ? { evidenceIds } : {}) }] });
};

/** The pieces of evidence that are the app's own recording. */
const recordingsOf = (run: Run) => Object.values(run.evidence ?? {}).filter((e) => e.recording);

async function qaStage(o: { sink?: FakeSink; qa?: Parameters<Boot['engine']['script']>[1]; evidence?: 'cycle'; onClose?: () => void } = {}) {
  let b!: Boot;
  const sink = o.sink ?? fakeSink();
  const s = screens(() => b.forum, sink);
  const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' }, onClose: o.onClose });
  b = await boot({
    sandbox,
    screens: s.hub,
    configure: (c) => {
      c.language = 'en';
      shellOf(c, 'qa', 'sandbox');
      if (o.evidence) c.runner.evidence = o.evidence;
    },
  });
  // The look at the screen made when it opens has gone through before the agent answers.
  easy(b, o.qa ?? (async (call) => {
    await vi.waitFor(() => expect(sink.fed.length).toBeGreaterThan(0));
    return passes(call);
  }));
  const run = await b.runner.start('app#101');
  return { b, run, sink, ...s };
}

describe('the recording of a QA stage', () => {
  it('is kept as one piece of evidence of the stage, with one run revision and one post of the app, before the stage folder goes', async () => {
    const closed: { file: boolean | null; folder: boolean | null }[] = [];
    let b!: Boot;
    let seen: () => { file: boolean; folder: boolean } = () => ({ file: false, folder: false });
    const w = await qaStage({
      onClose: () => {
        const at = seen();
        closed.push({ file: at.file, folder: at.folder });
      },
    });
    b = w.b;
    seen = () => {
      const run = b.runs.list()[0];
      const rec = recordingsOf(run)[0];
      return { file: !!rec && !!evidencePath(b.deps.env().dataDir, run.id, rec), folder: true };
    };
    const run = await reach(b, w.run, 'ready');
    expect(run.status).toBe('done');
    // The file was in the store when the sandbox was closed (the stage folder goes with it).
    expect(closed).toEqual([{ file: true, folder: true }]);
    const recs = recordingsOf(run);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ kind: 'webm', stage: 'qa', by: 'qa', title: 'Screen recording of the stage (made by the app)', recording: { width: 8, height: 4, marks: [] } });
    expect(recs[0].recording?.durationMs).toBeGreaterThan(0);
    // Not among what the agent kept: its own piece is ev-1, the recording is ev-2.
    expect(Object.keys(run.evidence ?? {})).toEqual(['ev-1', 'ev-2']);
    expect(run.qa.at(-1)?.scenarios[0].evidenceIds).toEqual(['ev-1']);
    // One run revision for it.
    expect(run.history.filter((h) => h.type === 'evidence' && h.detail?.startsWith(recs[0].id))).toHaveLength(1);
    // One post, written by the app, internal, carrying the video.
    const posts = b.thread(run).filter((m) => (m.evidence ?? []).some((e) => e.id === recs[0].id));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: 'post', author: { type: 'app' }, public: false, stage: 'qa', code: 'runner.evidence.recorded' });
    expect(posts[0].evidence?.[0]).toMatchObject({ media: 'video/webm', name: 'screen-recording.webm' });
    // The bytes on disk are the muxer's own WebM.
    const path = evidencePath(b.deps.env().dataDir, run.id, recs[0]) as string;
    expect([...readFileSync(path).subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(w.sink.closed).toBe(1);
    expect(w.conn.closed).toBe(true);
  });

  it('is written to the run file as version 2, and the run without a recording stays 1', async () => {
    const w = await qaStage();
    const run = await reach(w.b, w.run, 'ready');
    const file = (id: string) => JSON.parse(readFileSync(join(w.b.dir, 'runs', `${id}.json`), 'utf8')) as { version: number; evidence: Record<string, { kind: string }> };
    expect(file(run.id).version).toBe(2);
    expect(Object.values(file(run.id).evidence).map((e) => e.kind)).toEqual(['text', 'webm']);
    const plain = await boot({ sandbox: fakeSandbox(), configure: (c) => shellOf(c, 'qa', 'sandbox') });
    easy(plain, passes);
    const other = await reach(plain, await plain.runner.start('app#101'), 'ready');
    expect(JSON.parse(readFileSync(join(plain.dir, 'runs', `${other.id}.json`), 'utf8')).version).toBe(1);
  });

  it('is not copied into the cycle folder, with the workspace choosing to keep evidence there, and the agent\'s own piece is', async () => {
    const w = await qaStage({ evidence: 'cycle' });
    const run = await reach(w.b, w.run, 'ready');
    expect(run.status).toBe('done');
    expect(readdirSync(join(run.worktree, run.cycleFolder, 'evidence'))).toEqual(['ev-1.txt']);
    expect(recordingsOf(run)[0].inCycle).toBeUndefined();
  });

  it('is kept when the stage fails, with nothing the agent answered', async () => {
    const w = await qaStage({
      qa: async () => {
        await vi.waitFor(() => expect(w.sink.fed.length).toBeGreaterThan(0));
        throw new Error('the model stopped answering');
      },
    });
    const run = await reach(w.b, w.run, 'qa');
    expect(run.status).toBe('failed');
    expect(recordingsOf(run)).toHaveLength(1);
    expect(w.b.thread(run).filter((m) => (m.evidence ?? []).some((e) => e.media === 'video/webm'))).toHaveLength(1);
  });

  it('is kept when the stage fails before the part that builds it, by the stage\'s safety net', async () => {
    let b!: Boot;
    const sink = fakeSink();
    const s = screens(() => b.forum, sink);
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' } });
    // The app's commands before QA run in the sandbox: the first of them waits until the screen was recorded, so the failure that follows has a video to keep.
    const open = sandbox.open.bind(sandbox);
    sandbox.open = async (options) => {
      const session = await open(options);
      const exec = session.exec.bind(session);
      session.exec = async (command) => {
        await vi.waitFor(() => expect(sink.fed.length).toBeGreaterThan(0));
        return exec(command);
      };
      return session;
    };
    b = await boot({
      sandbox,
      screens: s.hub,
      // The stage cannot go on once the sandbox is open: this comes before the agent's call, outside the part of the stage that builds the recording.
      pluginNotes: () => {
        if (sandbox.opened.length) throw new Error('the notes could not be read');
        return [];
      },
      configure: (c) => {
        c.language = 'en';
        shellOf(c, 'qa', 'sandbox');
        c.runner.commands = ['npm test'];
      },
    });
    easy(b, passes);
    const run = await reach(b, await b.runner.start('app#101'), 'qa');
    expect(run.status).toBe('failed');
    expect(b.engine.calls.some((c) => c.agent.id === 'qa')).toBe(false);
    expect(recordingsOf(run)).toHaveLength(1);
    expect(b.thread(run).filter((m) => (m.evidence ?? []).some((e) => e.media === 'video/webm'))).toHaveLength(1);
    expect(s.conn.closed).toBe(true);
    expect(sink.closed).toBe(1);
    expect(sink.aborted).toBe(0);
  });

  it('is kept when the stage is cancelled', async () => {
    let started = false;
    const w = await qaStage({
      qa: (call) => {
        started = true;
        return new Promise((_resolve, reject) => call.abort?.signal.addEventListener('abort', () => reject(new Error('cancelled'))));
      },
    });
    // The run goes through its gates on its own until QA starts and waits for an answer that never comes.
    await vi.waitFor(
      () => {
        if (w.b.runner.get(w.run.id)?.status === 'gate') w.b.runner.gate(w.run.id, 'approve');
        expect(started).toBe(true);
      },
      { timeout: 20_000, interval: 20 },
    );
    await vi.waitFor(() => expect(w.sink.fed.length).toBeGreaterThan(0));
    const cancelled = w.b.runner.cancel(w.run.id);
    expect(cancelled.status).toBe('cancelled');
    await w.b.settle();
    const run = w.b.runner.get(w.run.id) as Run;
    expect(recordingsOf(run)).toHaveLength(1);
    expect(w.conn.closed).toBe(true);
  });

  it('says why when there is nothing to keep, and the stage still completes', async () => {
    const sink = fakeSink();
    sink.refuseOpen = true;
    const w = await qaStage({ sink, qa: passes });
    const run = await reach(w.b, w.run, 'ready');
    expect(run.status).toBe('done');
    expect(recordingsOf(run)).toEqual([]);
    const lines = w.b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.screen.notKept');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ author: { type: 'app' }, stage: 'qa', params: { agent: 'qa', reason: 'the video encoder did not work' } });
  });

  it('says why when the store refuses the file, and the stage still completes', async () => {
    const w = await qaStage({
      qa: async (call) => {
        await vi.waitFor(() => expect(w.sink.fed.length).toBeGreaterThan(0));
        const answer = await passes(call);
        // Where the recording would be written its temporary name is already taken, so the store cannot write it.
        writeFileSync(join(w.b.dir, 'evidence', w.run.id, `ev-2.webm.tmp-${process.pid}`), 'taken');
        return answer;
      },
    });
    const run = await reach(w.b, w.run, 'ready');
    expect(run.status).toBe('done');
    expect(recordingsOf(run)).toEqual([]);
    const lines = w.b.thread(run).filter((m) => m.kind === 'system' && m.code === 'runner.screen.notKept');
    expect(lines.map((m) => m.params.reason)).toEqual(['the file could not be written']);
    expect(existsSync(join(w.b.dir, 'evidence', run.id, 'ev-2.webm'))).toBe(false);
  });

  it('is said once when it stops at a limit, and what came before is kept as truncated', async () => {
    const sink = fakeSink(400);
    let b!: Boot;
    const conn = fakeConn();
    const hub = createScreenHub({
      enabled: true,
      encoder: { encode: () => ({ jpeg: Uint8Array.from([1]), width: 1, height: 1 }) },
      connect: async () => conn,
      sink: () => sink,
      recordingLimits: { bytes: 3000, reserve: 1200 },
      note: (run, stage, code, params) => b.forum.append(runThreadId(run), { kind: 'system', author: { type: 'app' }, code, params, stage }),
      // The look at the screen goes off at once, as if every second passed.
      schedule: (_ms, fn) => {
        const timer = setTimeout(fn, 0);
        return () => clearTimeout(timer);
      },
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
    });
    b = await boot({ sandbox: fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' } }), screens: hub, configure: (c) => { c.language = 'en'; shellOf(c, 'qa', 'sandbox'); } });
    easy(b, async (call) => {
      // The screen changes under the recorder until it is full.
      for (let i = 0; i < 12; i++) {
        conn.pixels.fill(10 + i);
        await new Promise((r) => setTimeout(r, 5));
      }
      return passes(call);
    });
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    expect(b.thread(run).filter((m) => m.code === 'runner.screen.cappedSize')).toHaveLength(1);
    expect(recordingsOf(run)[0].recording?.truncated).toBe('size');
  });
});

describe('an agent called during a QA stage', () => {
  it('has its own sandbox but never takes the stage\'s live screen or recording from it', async () => {
    let b!: Boot;
    const sink = fakeSink();
    const conn = fakeConn();
    const connect = vi.fn(async () => conn);
    const hub = createScreenHub({
      enabled: true,
      encoder: { encode: () => ({ jpeg: Uint8Array.from([1]), width: 1, height: 1 }) },
      connect,
      sink: () => sink,
      note: (run, stage, code, params) => b.forum.append(runThreadId(run), { kind: 'system', author: { type: 'app' }, code, params, stage }),
    });
    const sandbox = fakeSandbox({ gui: { browsers: null, display: 'on' }, screen: { socket: '/stage/x11/X99', kind: 'sandbox' } });
    b = await boot({ sandbox, screens: hub, configure: (c) => { c.language = 'en'; shellOf(c, 'qa', 'sandbox'); shellOf(c, 'developer', 'sandbox'); } });
    const seen: { closed: boolean; fedBefore: number; opened: number }[] = [];
    easy(b, async (call) => {
      await vi.waitFor(() => expect(sink.fed.length).toBeGreaterThan(0));
      const call2 = (call.runnerTools as ToolImpl[]).find((x) => x.name === CALL_AGENT_TOOL)!;
      await call2.run({ to: 'developer', topic: 'Can you check the page?', place: 'run' }, {} as never);
      seen.push({ closed: conn.closed, fedBefore: sink.fed.length, opened: connect.mock.calls.length });
      return passes(call);
    });
    // The first call of the developer is its own stage; the second is the one the QA agent makes.
    b.engine.script('developer', () => work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] }), () => ({ texto: 'looks fine' }));
    const run = await reach(b, await b.runner.start('app#101'), 'ready');
    expect(run.status).toBe('done');
    // The called agent got a sandbox of its own with a display, and the hub was not asked for a second screen.
    expect(sandbox.opened.filter((o) => o.options.display)).toHaveLength(2);
    expect(seen).toEqual([{ closed: false, fedBefore: expect.any(Number), opened: 1 }]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(b.thread(run).filter((m) => m.code === 'runner.screen.noConnect')).toEqual([]);
    // The recording is the stage's: one encoder, closed once, kept once.
    expect(sink.opened).toHaveLength(1);
    expect(sink.closed).toBe(1);
    expect(sink.aborted).toBe(0);
    expect(recordingsOf(run)).toHaveLength(1);
    expect(conn.closed).toBe(true);
  });
});
