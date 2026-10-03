// What a run does when the stages say it: where it goes next, where it goes back to and after how many returns, the stages that wait for an event,
// the stage where it ends, and moving a run to another flow.
import { describe, expect, it } from 'vitest';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { type FlowStage, RunError, askReporter, cancel, flowOf, gateApprove, gateReject, handBack, migrateFlow, recordCommentPublished, recordCommentRemoved, reviewReturn, stageDone, waitDone, waitSkip } from '../src/shared/runs';
import { agentFlowConfig, drive, startInput } from './helpers/runs';

const flowFrom = (edit: (c: WorkspaceConfig) => void): FlowStage[] => {
  const c = agentFlowConfig();
  edit(c);
  return flowOf(c);
};
const done = (name: string) => ({ summary: `${name} done`, handoff: `after ${name}`, artifacts: [`${name}.md`] });
const stageDef = (id: string, over: Partial<StageDef> = {}): StageDef => ({ id, label: id, match: [], kind: 'development', rank: 0, type: 'work', ...over });

/** Drives the run until it is at `id` (working, or waiting there). */
function until(d: ReturnType<typeof drive>, id: string): void {
  for (let i = 0; i < 40 && !(d.run.stage === id); i++) {
    if (d.run.status === 'gate') d.do((r, at) => gateApprove(r, d.flow, at));
    else if (d.run.status === 'working') d.do((r, at) => stageDone(r, d.flow, done(d.run.stage), at));
    else throw new Error(`stuck at ${d.run.stage} (${d.run.status})`);
  }
  expect(d.run.stage).toBe(id);
}

describe('where a run goes next', () => {
  it('skips a stage that was taken out of the flow', () => {
    const flow = flowFrom((c) => c.devCycle.stages.splice(3, 1));
    const d = drive(flow);
    until(d, 'gate1');
    d.do((r, at) => gateApprove(r, flow, at));
    d.do((r, at) => stageDone(r, flow, done('2_PLAN'), at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement' });
  });

  it('goes where `next` says, and ends where a stage says it ends', () => {
    const flow = flowFrom((c) => {
      c.devCycle.stages.find((s) => s.id === 'plan')!.next = 'review';
      c.devCycle.stages.find((s) => s.id === 'review')!.next = null;
    });
    const d = drive(flow);
    until(d, 'plan');
    d.do((r, at) => stageDone(r, flow, done('plan'), at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'review' });
    d.do((r, at) => stageDone(r, flow, done('review'), at));
    expect(d.run).toMatchObject({ status: 'done', stage: 'review' });
    expect(d.messages.at(-1)).toMatchObject({ code: 'run.completed' });
  });

  it('a work stage with no agent is where a run cannot start, and fails a run that reaches it', () => {
    const broken = flowFrom((c) => {
      c.devCycle.stages.push(stageDef('communicate', { agentId: 'refiner' }));
    });
    expect(broken.find((s) => s.id === 'ready')).toMatchObject({ next: 'communicate', agent: null });
    expect(() => drive(broken)).toThrow(expect.objectContaining({ code: 'no-agent' }));
    // an agent that leaves the team in the middle of a run: the run fails at its stage and says so
    const d = drive();
    until(d, 'qa');
    d.do((r, at) => stageDone(r, broken, done('qa'), at));
    expect(d.run).toMatchObject({ status: 'failed', stage: 'ready', error: { code: 'no-agent' } });
  });

  it('a last work stage with an agent is done when it finishes, and the run ends', () => {
    const flow = flowFrom((c) => {
      const ready = c.devCycle.stages.find((s) => s.id === 'ready')!;
      ready.type = 'work';
      ready.agentId = 'refiner';
      ready.produces = ['6_NOTE.md'];
    });
    const d = drive(flow);
    until(d, 'ready');
    expect(d.run).toMatchObject({ status: 'working', stage: 'ready' });
    d.do((r, at) => stageDone(r, flow, done('6_NOTE'), at));
    expect(d.run).toMatchObject({ status: 'done', stage: 'ready' });
    expect(d.run.stages.find((s) => s.stage === 'ready')).toMatchObject({ status: 'done', artifacts: ['6_NOTE.md'] });
  });
});

describe('where work goes back to', () => {
  it('a rejected gate goes to the stage its returnsTo names', () => {
    const flow = flowFrom((c) => (c.devCycle.stages.find((s) => s.id === 'gate2')!.returnsTo = 'refine'));
    const d = drive(flow);
    until(d, 'gate2');
    d.do((r, at) => gateReject(r, flow, 'the spec is wrong too', at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine' });
    expect(d.messages.at(-2)).toMatchObject({ kind: 'handoff', to: 'refiner', text: 'the spec is wrong too' });
  });

  it('a review sends the work to the stage it names, after the rounds it allows: a limit of one asks at the first return', () => {
    const flow = flowFrom((c) => {
      c.devCycle.stages.find((s) => s.id === 'review')!.roundLimit = 1;
      c.devCycle.stages.find((s) => s.id === 'review')!.returnsTo = 'plan';
    });
    const d = drive(flow);
    until(d, 'review');
    d.do((r, at) => reviewReturn(r, flow, { by: 'reviewer', findings: 'F1: naming' }, at));
    expect(d.run).toMatchObject({ status: 'question', question: { kind: 'review-limit' }, returns: { plan: 1 } });
  });

  it('a security review added after the review returns to implement, and its rounds are counted with the others that go there', () => {
    const flow = flowFrom((c) => {
      const at = c.devCycle.stages.findIndex((s) => s.id === 'review');
      c.devCycle.stages.splice(at + 1, 0, stageDef('security', { kind: 'review', agentId: 'qa', produces: ['4B_SECURITY.md'], returnsTo: 'implement' }));
    });
    expect(flow.map((s) => s.id).slice(4, 8)).toEqual(['implement', 'review', 'security', 'qa']);
    const d = drive(flow);
    until(d, 'review');
    d.do((r, at) => stageDone(r, flow, done('review'), at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'security' });
    d.do((r, at) => handBack(r, flow, { by: 'qa', toStage: 'implement', text: 'secret in the log', countRound: true }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', returns: { implement: 1 } });
    until(d, 'review');
    d.do((r, at) => reviewReturn(r, flow, { by: 'reviewer', findings: 'F2' }, at));
    expect(d.run).toMatchObject({ status: 'question', returns: { implement: 2 } });
  });

  it('refuses to send work to a gate or to a stage the flow does not have', () => {
    const flow = flowFrom(() => undefined);
    const d = drive(flow);
    until(d, 'qa');
    expect(() => handBack(d.run, flow, { by: 'qa', toStage: 'gate2', text: 'x' }, '2026-10-03T11:00:00.000Z')).toThrow(RunError);
    expect(() => handBack(d.run, flow, { by: 'qa', toStage: 'nowhere', text: 'x' }, '2026-10-03T11:00:00.000Z')).toThrow(RunError);
  });
});

describe('a stage that waits', () => {
  const waitingFlow = (waitsFor: StageDef['waitsFor']): FlowStage[] =>
    flowFrom((c) => {
      const ready = c.devCycle.stages.find((s) => s.id === 'ready')!;
      ready.type = 'wait';
      ready.waitsFor = waitsFor;
      c.devCycle.stages.push(stageDef('communicate', { agentId: 'refiner' }));
    });

  it('holds the run until the event, says what it waits for, then goes on to the next stage', () => {
    const flow = waitingFlow({ kind: 'pr-merged' });
    const d = drive(flow);
    until(d, 'ready');
    expect(d.run).toMatchObject({ status: 'waiting', stage: 'ready', wait: { kind: 'pr-merged', since: expect.any(String) } });
    expect(d.run.stages.find((s) => s.stage === 'ready')).toMatchObject({ status: 'waiting', agent: null });
    expect(d.messages.at(-1)).toMatchObject({ kind: 'system', code: 'run.stage.wait.pr-merged' });
    d.do((r, at) => waitDone(r, flow, {}, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'communicate', wait: null });
    expect(d.run.stages.find((s) => s.stage === 'ready')).toMatchObject({ status: 'done' });
    expect(d.messages.find((m) => m.code === 'wait.done.pr-merged')).toBeTruthy();
    expect(d.run.history.map((h) => h.type)).toContain('wait-done');
  });

  it('can end the run when nothing follows it', () => {
    const flow = flowFrom((c) => {
      const ready = c.devCycle.stages.find((s) => s.id === 'ready')!;
      ready.type = 'wait';
      ready.waitsFor = { kind: 'label', label: 'shipped' };
    });
    const d = drive(flow);
    until(d, 'ready');
    expect(d.run.wait).toMatchObject({ kind: 'label', label: 'shipped' });
    d.do((r, at) => waitDone(r, flow, {}, at));
    expect(d.run).toMatchObject({ status: 'done', wait: null });
  });

  it('is left by the person with a reason, recorded as a decision', () => {
    const flow = waitingFlow({ kind: 'time', minutes: 60 });
    const d = drive(flow);
    until(d, 'ready');
    expect(() => waitSkip(d.run, flow, '  ', '2026-10-03T11:00:00.000Z')).toThrow(RunError);
    d.do((r, at) => waitSkip(r, flow, 'Merged by hand, the app did not see it.', at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'communicate' });
    expect(d.run.stages.find((s) => s.stage === 'ready')).toMatchObject({ status: 'skipped' });
    expect(d.messages.find((m) => m.code === 'wait.skipped')).toMatchObject({ kind: 'decision', public: true, text: 'Merged by hand, the app did not see it.' });
  });

  it('a wait with no event fails the run and says so, instead of waiting forever', () => {
    const flow = waitingFlow(undefined);
    const d = drive(flow);
    until(d, 'qa');
    d.do((r, at) => stageDone(r, flow, done('qa'), at));
    expect(d.run).toMatchObject({ status: 'failed', error: { code: 'no-event', stage: 'ready' } });
  });

  it('is not left by anything but a run that waits', () => {
    const d = drive();
    expect(() => waitDone(d.run, d.flow, {}, '2026-10-03T11:00:00.000Z')).toThrow(RunError);
  });
});

describe('an agent that asks the person who reported the issue', () => {
  it('waits for the reply and goes on with the same stage and the reply as the answer', () => {
    const d = drive();
    expect(() => askReporter(d.run, { by: 'refiner', text: '  ' }, '2026-10-03T11:00:00.000Z')).toThrow(RunError);
    d.do((r, at) => askReporter(r, { by: 'refiner', text: 'Which browser do you use?' }, at));
    expect(d.run).toMatchObject({ status: 'waiting', stage: 'refine', wait: { kind: 'reporter-reply', by: 'refiner' } });
    expect(d.messages.at(-1)).toMatchObject({ kind: 'question', to: 'reporter', public: true });
    d.do((r, at) => waitDone(r, d.flow, { reply: 'Firefox, on a phone.' }, at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine', wait: null });
    expect(d.run.stages.find((s) => s.stage === 'refine')).toMatchObject({ status: 'running', attempts: 1 });
    expect(d.messages.at(-1)).toMatchObject({ kind: 'answer', text: 'Firefox, on a phone.', public: false });
  });

  it('goes on without a reply when the person says so', () => {
    const d = drive();
    d.do((r, at) => askReporter(r, { by: 'refiner', text: 'Which browser?' }, at));
    d.do((r, at) => waitSkip(r, d.flow, 'It does not matter here.', at));
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine' });
    expect(d.messages.at(-1)).toMatchObject({ kind: 'answer', text: 'It does not matter here.' });
  });
});

describe('moving a run to the current flow', () => {
  it('works while the stage the run is at is still there and the same kind of stage', () => {
    const d = drive();
    until(d, 'gate2');
    const edited = flowFrom((c) => c.devCycle.stages.splice(c.devCycle.stages.findIndex((s) => s.id === 'review') + 1, 0, stageDef('security', { agentId: 'qa', produces: ['4B_SECURITY.md'], returnsTo: 'implement' })));
    const before = d.run.flow?.hash;
    d.do((r, at) => migrateFlow(r, edited, at));
    expect(d.run.flow?.hash).not.toBe(before);
    expect(d.run.flow?.stages.map((s) => s.id)).toContain('security');
    expect(d.run.history.at(-1)).toMatchObject({ type: 'flow-migrated', stage: 'gate2' });
    expect(d.messages.at(-1)).toMatchObject({ code: 'run.flow.migrated' });
  });

  it('is refused when the stage is gone, when it became another kind of stage, and for a run that ended', () => {
    const d = drive();
    until(d, 'gate2');
    const gone = flowFrom((c) => c.devCycle.stages.splice(3, 1));
    expect(() => migrateFlow(d.run, gone, '2026-10-03T11:00:00.000Z')).toThrow(expect.objectContaining({ code: 'unknown-stage' }));
    const other = flowFrom((c) => (c.devCycle.stages.find((s) => s.id === 'gate2')!.type = 'work'));
    expect(() => migrateFlow(d.run, other, '2026-10-03T11:00:00.000Z')).toThrow(expect.objectContaining({ code: 'flow-mismatch' }));
    const e = drive();
    e.do((r, at) => cancel(r, 'person', at));
    expect(() => migrateFlow(e.run, e.flow, '2026-10-03T11:00:00.000Z')).toThrow(expect.objectContaining({ code: 'not-active' }));
  });
});

describe('a comment that was removed', () => {
  it('stays in the run as removed, with no note to edit, and a later post starts again', () => {
    const d = drive(undefined, startInput());
    d.do((r, at) => recordCommentPublished(r, 'refine', { target: 'issue', noteId: 77, url: 'https://example.com/n/77', bodyHash: 'h', body: 'text' }, at));
    d.do((r, at) => recordCommentRemoved(r, 'refine', at));
    expect(d.run.comments.refine).toMatchObject({ status: 'removed', noteId: null, url: 'https://example.com/n/77', body: 'text' });
    expect(() => recordCommentRemoved(d.run, 'plan', '2026-10-03T11:00:00.000Z')).toThrow(RunError);
  });
});
