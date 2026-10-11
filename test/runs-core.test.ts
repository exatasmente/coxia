import { describe, expect, it } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import { messageText } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import {
  acceptStage,
  returnStage,
  startStage,
  RunError,
  answer,
  ask,
  cancel,
  flowOf,
  flowProblems,
  gateApprove,
  gateReject,
  gateSkip,
  handBack,
  newRunId,
  parseRun,
  producerOf,
  pushStagesOf,
  recordCommentDraft,
  recordCommentEdited,
  recordCommentProposal,
  recordCommentPublished,
  recordCommentRefused,
  RUN_ID,
  resumeAfterRestart,
  retry,
  reviewReturn,
  stageDone,
  stageFailed,
  startRun,
} from '../src/shared/runs';
import { AT, agentFlowConfig, agentFlowStages, at, drive, flowWithAutonomy, startInput } from './helpers/runs';

const done = (name: string) => ({ summary: `${name} done`, handoff: `over to the next after ${name}`, artifacts: [`${name}.md`] });
const stage = (d: ReturnType<typeof drive>, id: string) => d.run.stages.find((s) => s.stage === id)!;

describe('the stages that push', () => {
  // Who writes is the agent's permission: the test sets it, so the flow's own agents decide nothing by default.
  const withWriters = (ids: string[]) => {
    const c = agentFlowConfig();
    for (const a of c.agents.team) a.permission = ids.includes(a.id) ? 'worktree' : 'read';
    return c;
  };
  const pushes = (ids: string[]) => {
    const c = withWriters(ids);
    return pushStagesOf(c, flowOf(c)).map((s) => s.id);
  };

  it('open the pull request at the last writer before the review, so the review lands on it', () => {
    expect(pushes(['planner', 'developer'])).toEqual(['implement']);
  });

  it('push again at every writer after it, a QA that writes tests included, which only updates the pull request', () => {
    expect(pushes(['refiner', 'planner', 'developer', 'qa'])).toEqual(['implement', 'qa']);
  });

  it('are the last writer when no writer comes before the review', () => {
    expect(pushes(['qa'])).toEqual(['qa']);
  });

  it('are the last writer in a flow with no review', () => {
    const c = withWriters(['developer', 'qa']);
    const flow = flowOf(c).filter((s) => s.kind !== 'review');
    expect(pushStagesOf(c, flow).map((s) => s.id)).toEqual(['qa']);
  });

  it('are none when no agent writes', () => {
    expect(pushes([])).toEqual([]);
  });
});

describe('the flow of the agent cycle', () => {
  it('is the stages in rank order, each with the agent that works it; gates and the last stage have none', () => {
    const flow = agentFlowStages();
    expect(flow.map((s) => [s.id, s.type === 'gate', s.agent])).toEqual([
      ['refine', false, 'refiner'],
      ['gate1', true, null],
      ['plan', false, 'planner'],
      ['gate2', true, null],
      ['implement', false, 'developer'],
      ['review', false, 'reviewer'],
      ['qa', false, 'qa'],
      ['ready', false, null],
    ]);
    expect(flow[0].artifacts).toEqual(['1_SPEC.md', 'REQUIREMENTS.md']);
    expect(flowProblems(flow)).toEqual([]);
  });

  it('reports a stage with no agent, and an empty flow', () => {
    const c = agentFlowConfig();
    c.agents.team = c.agents.team.filter((a) => a.id !== 'developer');
    c.devCycle.stages.find((s) => s.id === 'implement')!.agentId = undefined;
    expect(flowProblems(flowOf(c))).toEqual([{ code: 'no-agent', stage: 'implement' }]);
    expect(flowProblems([])).toEqual([{ code: 'empty', stage: null }]);
  });

  it('falls back to the agent that lists the stage', () => {
    const c = agentFlowConfig();
    c.devCycle.stages.find((s) => s.id === 'implement')!.agentId = undefined;
    c.agents.team.push(newAgent({ id: 'coder', stages: ['implement'] }));
    c.agents.team = c.agents.team.filter((a) => a.id !== 'developer');
    expect(flowOf(c).find((s) => s.id === 'implement')?.agent).toBe('coder');
  });

  it('finds the stage that produced what a gate judges', () => {
    const flow = agentFlowStages();
    expect(producerOf(flow, 'gate1')?.id).toBe('refine');
    expect(producerOf(flow, 'gate2')?.id).toBe('plan');
    expect(producerOf(flow, 'review')?.id).toBe('implement');
    expect(producerOf(flow, 'refine')).toBeNull();
  });
});

describe('starting a run', () => {
  it('begins at the first stage with its agent working, and says so in the thread', () => {
    const d = drive();
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine', rev: 0, question: null, error: null, comments: {}, returns: {}, wait: null });
    expect(stage(d, 'refine')).toMatchObject({ agent: 'refiner', status: 'running', attempts: 1, startedAt: at(0), endedAt: null });
    expect(d.messages.map((m) => [m.kind, m.code])).toEqual([['system', 'run.started'], ['system', 'run.stage.started']]);
    expect(d.run.history.map((h) => h.type)).toEqual(['started', 'stage-started']);
    expect(parseRun(d.run).ok).toBe(true);
  });

  it('is refused, creating nothing, when a stage that needs an agent has none or there is no stage', () => {
    const c = agentFlowConfig();
    c.agents.team = c.agents.team.filter((a) => a.id !== 'reviewer');
    c.devCycle.stages.find((s) => s.id === 'review')!.agentId = undefined;
    expect(() => startRun(startInput(), flowOf(c), AT)).toThrow(RunError);
    try {
      startRun(startInput(), flowOf(c), AT);
    } catch (e) {
      expect((e as RunError).code).toBe('no-agent');
      expect((e as RunError).message).toContain('Revisão');
    }
    expect(() => startRun(startInput(), [], AT)).toThrow(expect.objectContaining({ code: 'no-flow' }));
  });

  it('makes ids the store accepts', () => {
    expect(RUN_ID.test(newRunId(Date.parse(AT), 'ab12'))).toBe(true);
  });
});

describe('a stage ends', () => {
  it('with the agent\'s post and handoff, and the next stage starts: a gate waits for the person', () => {
    const d = drive();
    const before = d.messages.length;
    d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
    expect(d.run).toMatchObject({ status: 'gate', stage: 'gate1' });
    expect(stage(d, 'refine')).toMatchObject({ status: 'done', artifacts: ['1_SPEC.md'], endedAt: at(1) });
    expect(stage(d, 'gate1')).toMatchObject({ agent: null, status: 'waiting' });
    const added = d.messages.slice(before);
    expect(added.map((m) => [m.kind, m.author, m.to ?? m.code])).toEqual([
      ['post', { type: 'agent', id: 'refiner' }, undefined],
      ['handoff', { type: 'agent', id: 'refiner' }, 'person'],
      ['system', { type: 'app' }, 'run.stage.gate'],
    ]);
    expect(added[0].refs).toEqual([{ path: '1_SPEC.md' }]);
    expect(added[0].public).toBe(true);
    expect(added[1].public ?? false).toBe(false);
  });

  it('hands over to the next agent by name, and skips the handoff when there is nothing to say', () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    const tr = d.do((r, t) => stageDone(r, d.flow, { summary: 'plan', handoff: '', artifacts: [] }, t));
    expect(tr.messages.map((m) => m.kind)).toEqual(['post', 'system']);
    d.do((r, t) => gateApprove(r, d.flow, t));
    const tr2 = d.do((r, t) => stageDone(r, d.flow, done('b'), t));
    expect(d.run.stage).toBe('review');
    expect(tr2.messages.find((m) => m.kind === 'handoff')?.to).toBe('reviewer');
  });

  it('only when an agent is working it', () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    expect(() => stageDone(d.run, d.flow, done('b'), at(9))).toThrow(expect.objectContaining({ code: 'wrong-state' }));
  });

  it('never changes the run it was given', () => {
    const d = drive();
    const frozen = JSON.stringify(d.run);
    stageDone(d.run, d.flow, done('a'), at(5));
    ask(d.run, { by: 'refiner', text: 'which one?' }, at(5));
    cancel(d.run, 'person', at(5));
    expect(JSON.stringify(d.run)).toBe(frozen);
  });
});

describe('the gates', () => {
  const atGate1 = () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
    return d;
  };

  it('approving goes on, with the decision in the thread', () => {
    const d = atGate1();
    const tr = d.do((r, t) => gateApprove(r, d.flow, t, 'looks right'));
    expect(d.run).toMatchObject({ status: 'working', stage: 'plan' });
    expect(stage(d, 'gate1')).toMatchObject({ status: 'done' });
    expect(tr.messages[0]).toMatchObject({ kind: 'decision', author: { type: 'person' }, code: 'gate.approved', text: 'looks right', public: true });
  });

  it('rejecting with a reason returns the run to the stage that produced the artifact, with the reason as a handoff', () => {
    const d = atGate1();
    const tr = d.do((r, t) => gateReject(r, d.flow, ' the goal is vague ', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine' });
    expect(stage(d, 'refine')).toMatchObject({ status: 'running', attempts: 2, artifacts: ['1_SPEC.md'] });
    expect(stage(d, 'gate1')).toMatchObject({ status: 'rejected' });
    expect(tr.messages.map((m) => [m.kind, m.code ?? null, m.text ?? null, m.to ?? null])).toEqual([
      ['decision', 'gate.rejected', 'the goal is vague', null],
      ['handoff', null, 'the goal is vague', 'refiner'],
      ['system', 'run.stage.started', null, null],
    ]);
    expect(d.run.history.map((h) => h.type)).toContain('gate-rejected');
  });

  it('rejecting the second gate goes back to the plan, and a gate can be rejected again after the work returns', () => {
    const d = atGate1();
    d.do((r, t) => gateApprove(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
    d.do((r, t) => gateReject(r, d.flow, 'missing tests', t));
    expect(d.run.stage).toBe('plan');
    d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
    expect(d.run.status).toBe('gate');
    d.do((r, t) => gateReject(r, d.flow, 'still missing', t));
    expect(stage(d, 'plan').attempts).toBe(3);
  });

  it('skipping needs a reason and records it as a decision', () => {
    const d = atGate1();
    expect(() => gateSkip(d.run, d.flow, '  ', at(9))).toThrow(expect.objectContaining({ code: 'empty-reason' }));
    expect(() => gateReject(d.run, d.flow, '', at(9))).toThrow(expect.objectContaining({ code: 'empty-reason' }));
    const tr = d.do((r, t) => gateSkip(r, d.flow, 'urgent fix, spec is the issue', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'plan' });
    expect(stage(d, 'gate1').status).toBe('skipped');
    expect(tr.messages[0]).toMatchObject({ kind: 'decision', code: 'gate.skipped', text: 'urgent fix, spec is the issue' });
    expect(d.run.history.find((h) => h.type === 'gate-skipped')).toMatchObject({ by: 'person', detail: 'urgent fix, spec is the issue' });
  });

  it('only when the run is at a gate', () => {
    const d = drive();
    for (const move of [() => gateApprove(d.run, d.flow, AT), () => gateReject(d.run, d.flow, 'x', AT), () => gateSkip(d.run, d.flow, 'x', AT)]) expect(move).toThrow(expect.objectContaining({ code: 'wrong-state' }));
  });
});

describe('questions', () => {
  it('stop the stage and the run until the person answers, and the same attempt goes on', () => {
    const d = drive();
    d.do((r, t) => ask(r, { by: 'refiner', text: ' Which users? ' }, t));
    expect(d.run).toMatchObject({ status: 'question', question: { by: 'refiner', kind: 'agent', text: 'Which users?', stage: 'refine' } });
    expect(stage(d, 'refine').status).toBe('waiting');
    expect(() => stageDone(d.run, d.flow, done('x'), at(9))).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    const tr = d.do((r, t) => answer(r, d.flow, 'All of them', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine', question: null });
    expect(stage(d, 'refine')).toMatchObject({ status: 'running', attempts: 1 });
    expect(tr.messages).toEqual([expect.objectContaining({ kind: 'answer', author: { type: 'person' }, text: 'All of them', public: true })]);
    expect(d.messages.filter((m) => m.kind === 'question')).toHaveLength(1);
  });

  it('keep a run file valid when the answer is longer than a history entry holds', () => {
    const d = drive();
    d.do((r, t) => ask(r, { by: 'refiner', text: 'Which users?' }, t));
    const long = 'x'.repeat(9000);
    const tr = d.do((r, t) => answer(r, d.flow, long, t));
    expect(d.run.history.at(-1)).toMatchObject({ type: 'answer', detail: 'x'.repeat(4000) });
    expect(parseRun(d.run).ok).toBe(true);
    expect(tr.messages[0].text).toBe(long);
  });

  it('are not accepted empty, and an answer needs a question', () => {
    const d = drive();
    expect(() => ask(d.run, { by: 'refiner', text: '  ' }, AT)).toThrow(expect.objectContaining({ code: 'empty-text' }));
    expect(() => answer(d.run, d.flow, 'x', AT)).toThrow(expect.objectContaining({ code: 'wrong-state' }));
  });
});

describe('the review loop', () => {
  const atReview = () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    return d;
  };

  it('sends the work back to the developer with the findings, once, and the second round with findings asks the person', () => {
    const d = atReview();
    expect(d.run.stage).toBe('review');
    const first = d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F1: no test', handoff: 'add the test for F1' }, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', returns: { review: 1 } });
    expect(stage(d, 'review').status).toBe('rejected');
    expect(stage(d, 'implement').attempts).toBe(2);
    expect(first.messages.map((m) => [m.kind, m.to ?? null])).toEqual([['post', null], ['handoff', 'developer'], ['system', null]]);
    expect(first.messages[1].text).toBe('add the test for F1');
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    expect(d.run.stage).toBe('review');
    const second = d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F2: naming' }, t));
    expect(d.run).toMatchObject({ status: 'question', question: { by: 'app', kind: 'review-limit', text: 'F2: naming', stage: 'review' }, returns: { review: 2 } });
    expect(second.messages.map((m) => [m.kind, m.code ?? null])).toEqual([['post', null], ['question', 'review.limit']]);
  });

  it('continues after the person answers the limit: back to the developer with the answer, and a fresh budget', () => {
    const d = atReview();
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F1' }, t));
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F2' }, t));
    const tr = d.do((r, t) => answer(r, d.flow, 'just rename it and move on', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', question: null, returns: { review: 0 } });
    expect(tr.messages.map((m) => [m.kind, m.to ?? null])).toEqual([['answer', null], ['handoff', 'developer'], ['system', null]]);
    expect(tr.messages[1].text).toBe('just rename it and move on');
  });

  it('ends when the reviewer approves: QA, then the run is done', () => {
    const d = atReview();
    d.do((r, t) => stageDone(r, d.flow, done('4_REVIEW'), t));
    expect(d.run.stage).toBe('qa');
    d.do((r, t) => stageDone(r, d.flow, done('5_TEST_PLAN'), t));
    expect(d.run).toMatchObject({ status: 'done', stage: 'ready' });
    expect(stage(d, 'ready')).toMatchObject({ status: 'done', agent: null });
    expect(d.messages.at(-1)).toMatchObject({ code: 'run.completed' });
    expect(() => cancel(d.run, 'person', at(99))).toThrow(expect.objectContaining({ code: 'not-active' }));
  });

  it('hands back by name to an earlier work stage only', () => {
    const d = atReview();
    d.do((r, t) => handBack(r, d.flow, { by: 'reviewer', toStage: 'plan', text: 'the plan misses a migration' }, t));
    expect(d.run.stage).toBe('plan');
    const e = drive();
    for (const toStage of ['gate1', 'refine', 'ghost']) expect(() => handBack(e.run, e.flow, { by: 'refiner', toStage, text: 'x' }, AT), toStage).toThrow(expect.objectContaining({ code: 'unknown-stage' }));
  });
});

describe('failing, retrying and cancelling', () => {
  it('a failed stage waits for a retry, which is a new attempt', () => {
    const d = drive();
    const tr = d.do((r, t) => stageFailed(r, 'the model said no', t));
    expect(d.run).toMatchObject({ status: 'failed', error: { code: 'stage-failed', stage: 'refine', detail: 'the model said no' } });
    expect(stage(d, 'refine').status).toBe('failed');
    expect(tr.messages[0]).toMatchObject({ code: 'run.stage.failed', params: { stage: 'refine', detail: 'the model said no' } });
    d.do((r, t) => retry(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'working', error: null });
    expect(stage(d, 'refine')).toMatchObject({ status: 'running', attempts: 2 });
  });

  it('a stage without an agent cannot start and says so; once the team has one, a retry starts it', () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('b'), t));
    // The developer is deleted while the run is at the second gate.
    const c = agentFlowConfig();
    c.devCycle.stages.find((s) => s.id === 'implement')!.agentId = undefined;
    c.agents.team = c.agents.team.filter((a) => a.id !== 'developer');
    const without = flowOf(c);
    const tr = d.do((r, t) => gateApprove(r, without, t));
    expect(d.run).toMatchObject({ status: 'failed', stage: 'implement', error: { code: 'no-agent', stage: 'implement' } });
    expect(tr.messages.at(-1)).toMatchObject({ kind: 'system', code: 'run.stage.noAgent' });
    d.do((r, t) => retry(r, without, t));
    expect(d.run.status).toBe('failed');
    d.do((r, t) => retry(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement' });
    expect(stage(d, 'implement').agent).toBe('developer');
  });

  it('cancelling stops the run and the stage, deletes nothing and drops the question', () => {
    const d = drive();
    d.do((r, t) => ask(r, { by: 'refiner', text: 'x?' }, t));
    d.do((r, t) => cancel(r, 'person', t));
    expect(d.run).toMatchObject({ status: 'cancelled', question: null, stage: 'refine' });
    expect(stage(d, 'refine').status).toBe('cancelled');
    expect(d.run.stages).toHaveLength(1);
    expect(d.run.worktree).toBe(startInput().worktree);
    expect(d.messages.at(-1)).toMatchObject({ code: 'run.cancelled', author: { type: 'person' } });
    expect(() => cancel(d.run, 'person', at(9))).toThrow(RunError);
  });
});

describe('after the app restarts', () => {
  it('a stage interrupted mid-agent starts over: a new attempt at the same stage', () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    expect(d.run.stage).toBe('plan');
    const tr = d.do((r, t) => resumeAfterRestart(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'plan' });
    expect(stage(d, 'plan')).toMatchObject({ attempts: 2, status: 'running' });
    expect(tr.messages.map((m) => m.code)).toEqual(['run.stage.restarted', 'run.stage.started']);
    expect(d.run.history.map((h) => h.type)).toContain('interrupted');
  });

  it('leaves a run that waits for the person, a failed one and a finished one exactly as they are', () => {
    const d = drive();
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    for (const setup of [() => undefined, () => d.do((r, t) => gateApprove(r, d.flow, t)), () => d.do((r, t) => ask(r, { by: 'planner', text: '?' }, t)), () => d.do((r, t) => answer(r, d.flow, '!', t)), () => d.do((r, t) => stageFailed(r, 'x', t))]) {
      setup();
      if (d.run.status === 'working') continue;
      const tr = resumeAfterRestart(d.run, d.flow, at(99));
      expect(tr.run).toBe(d.run);
      expect(tr.messages).toEqual([]);
    }
  });
});

describe('tracker comments', () => {
  it('are recorded as drafted, proposed, published, edited in place and refused, one record per stage and one for the pull request', () => {
    const d = drive();
    d.do((r, t) => recordCommentProposal(r, 'refine', { target: 'issue', bodyHash: 'h1' }, t));
    expect(d.run.comments.refine).toMatchObject({ target: 'issue', noteId: null, url: null, bodyHash: 'h1', status: 'proposed' });
    d.do((r, t) => recordCommentPublished(r, 'refine', { target: 'issue', noteId: 4411, url: 'https://example.com/n/4411', bodyHash: 'h1' }, t));
    expect(d.run.comments.refine).toMatchObject({ noteId: 4411, status: 'published', url: 'https://example.com/n/4411' });
    // An edit is proposed over the published comment: the note id is kept, so phase 2 knows to edit.
    d.do((r, t) => recordCommentProposal(r, 'refine', { target: 'issue', bodyHash: 'h2' }, t));
    expect(d.run.comments.refine).toMatchObject({ noteId: 4411, status: 'proposed', bodyHash: 'h2' });
    d.do((r, t) => recordCommentEdited(r, 'refine', { bodyHash: 'h2' }, t));
    expect(d.run.comments.refine).toMatchObject({ noteId: 4411, status: 'published', bodyHash: 'h2', url: 'https://example.com/n/4411', updatedAt: at(4) });
    d.do((r, t) => recordCommentRefused(r, 'refine', 'issue', t));
    expect(d.run.comments.refine.status).toBe('published');
    d.do((r, t) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: 'p1' }, t));
    d.do((r, t) => recordCommentRefused(r, 'pr', 'mr', t));
    expect(d.run.comments.pr).toMatchObject({ target: 'mr', noteId: null, status: 'refused' });
    expect(Object.keys(d.run.comments)).toEqual(['refine', 'pr']);
    expect(parseRun(d.run).ok).toBe(true);
    expect(d.run.history.filter((h) => h.type === 'comment').map((h) => [h.stage, h.detail])).toContainEqual(['refine', 'published']);
  });

  it('keep the text last written, its first line and the pull request\'s title, and an edit that does not carry them does not lose them', () => {
    const d = drive();
    d.do((r, t) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: 'p1', body: '**Ready**\n\ntext', headline: 'Ready', title: 'Add the thing' }, t));
    expect(d.run.comments.pr).toMatchObject({ body: '**Ready**\n\ntext', headline: 'Ready', title: 'Add the thing', status: 'draft' });
    d.do((r, t) => recordCommentProposal(r, 'pr', { target: 'mr', bodyHash: 'p1' }, t));
    expect(d.run.comments.pr).toMatchObject({ body: '**Ready**\n\ntext', title: 'Add the thing', status: 'proposed' });
    d.do((r, t) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: 7, url: null, bodyHash: 'p1' }, t));
    expect(d.run.comments.pr).toMatchObject({ noteId: 7, body: '**Ready**\n\ntext', title: 'Add the thing', status: 'published' });
    d.do((r, t) => recordCommentEdited(r, 'pr', { bodyHash: 'p2', body: 'new' }, t));
    expect(d.run.comments.pr).toMatchObject({ body: 'new', headline: 'Ready', title: 'Add the thing' });
    expect(parseRun(JSON.parse(JSON.stringify(d.run))).ok).toBe(true);
    // a run written before these fields reads fine
    const old = JSON.parse(JSON.stringify(d.run)) as { comments: { pr: Record<string, unknown> } };
    for (const k of ['body', 'headline', 'title']) delete old.comments.pr[k];
    expect(parseRun(old).ok).toBe(true);
  });

  it('cannot edit what was never published, and apply to a finished run', () => {
    const d = drive();
    expect(() => recordCommentEdited(d.run, 'plan', { bodyHash: 'x' }, AT)).toThrow(expect.objectContaining({ code: 'unknown-comment' }));
    d.do((r, t) => recordCommentProposal(r, 'plan', { target: 'issue', bodyHash: 'x' }, t));
    expect(() => recordCommentEdited(d.run, 'plan', { bodyHash: 'y' }, AT)).toThrow(expect.objectContaining({ code: 'unknown-comment' }));
    d.do((r, t) => cancel(r, 'person', t));
    d.do((r, t) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: 'abc', url: null, bodyHash: 'z' }, t));
    expect(d.run.comments.pr.noteId).toBe('abc');
  });
});

describe('what the thread says', () => {
  it('has a text in both languages for every code a move can ask for, and nothing else is a key', () => {
    const d = drive();
    d.do((r, t) => ask(r, { by: 'refiner', text: 'q' }, t));
    d.do((r, t) => answer(r, d.flow, 'a', t));
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    d.do((r, t) => gateReject(r, d.flow, 'no', t));
    d.do((r, t) => stageDone(r, d.flow, done('a'), t));
    d.do((r, t) => gateSkip(r, d.flow, 'why', t));
    d.do((r, t) => stageFailed(r, 'boom', t));
    d.do((r, t) => retry(r, d.flow, t));
    d.do((r, t) => resumeAfterRestart(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('b'), t));
    d.do((r, t) => gateApprove(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('c'), t));
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'f' }, t));
    d.do((r, t) => stageDone(r, d.flow, done('c'), t));
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'f' }, t));
    d.do((r, t) => cancel(r, 'person', t));
    const codes = [...new Set(d.messages.flatMap((m) => (m.code ? [m.code] : [])))];
    expect(codes).toEqual(expect.arrayContaining(['run.started', 'run.stage.started', 'run.stage.gate', 'run.stage.failed', 'run.stage.retried', 'run.stage.restarted', 'gate.approved', 'gate.rejected', 'gate.skipped', 'review.limit', 'run.cancelled']));
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      for (const m of d.messages) expect(messageText(m), `${language} ${m.code}`).not.toMatch(/main\.forum|\{\w+\}/);
    }
    setLanguage('pt-BR');
    expect(messageText({ code: 'gate.rejected', params: { stage: 'Gate 1' }, text: 'unclear' })).toBe('Gate 1: devolvido. O motivo:\nunclear');
  });

  it('keeps every run valid against the file schema after every move', () => {
    const d = drive();
    const moves = [
      (r: any, t: string) => stageDone(r, d.flow, done('a'), t),
      (r: any, t: string) => gateReject(r, d.flow, 'x', t),
      (r: any, t: string) => ask(r, { by: 'refiner', text: 'q' }, t),
      (r: any, t: string) => answer(r, d.flow, 'a', t),
      (r: any, t: string) => cancel(r, 'app', t),
    ];
    for (const m of moves) {
      d.do(m);
      expect(parseRun(d.run), JSON.stringify(parseRun(d.run))).toMatchObject({ ok: true });
    }
  });
});

describe('agents that wait for the person', () => {
  // The planner and the reviewer are not autonomous; the rest run by themselves.
  const hybrid = () => flowWithAutonomy({ planner: false, reviewer: false });
  const upToPlan = (flow = hybrid()) => {
    const d = drive(flow);
    d.do((r, t) => stageDone(r, flow, done('1_SPEC'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    return d;
  };

  it('carry the flag of each agent into the flow: gates and the last stage have none', () => {
    expect(agentFlowStages().map((s) => s.autonomous)).toEqual([true, false, true, false, true, true, true, false]);
    expect(hybrid().filter((s) => s.agent).map((s) => [s.id, s.autonomous])).toEqual([['refine', true], ['plan', false], ['implement', true], ['review', false], ['qa', true]]);
  });

  it('the person starting the run starts its first stage, whoever works it', () => {
    const flow = flowWithAutonomy({ refiner: false });
    const d = drive(flow);
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine' });
    expect(stage(d, 'refine')).toMatchObject({ status: 'running', autonomous: false });
  });

  it('a stage whose agent is not autonomous is entered and waits for the person to start it', () => {
    const d = upToPlan();
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'plan' });
    expect(stage(d, 'plan')).toMatchObject({ agent: 'planner', status: 'waiting', attempts: 1, startedAt: null, autonomous: false });
    expect(d.messages.at(-1)).toMatchObject({ kind: 'system', code: 'run.stage.waitStart', params: { stage: 'cycle.agentFlow.stage.plan', agent: 'planner' } });
    expect(d.run.history.at(-1)).toMatchObject({ type: 'stage-waiting', stage: 'plan' });
    expect(() => stageDone(d.run, d.flow, done('2_PLAN'), at(9))).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    const tr = d.do((r, t) => startStage(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'plan' });
    expect(stage(d, 'plan')).toMatchObject({ status: 'running', startedAt: at(3), attempts: 1 });
    expect(tr.messages[0]).toMatchObject({ code: 'run.stage.started' });
    expect(d.run.history.at(-1)).toMatchObject({ type: 'stage-started', by: 'person' });
  });

  it('its result waits for the person to accept it: the post goes out, the handoff and the next stage do not', () => {
    const d = upToPlan();
    d.do((r, t) => startStage(r, d.flow, t));
    const before = d.messages.length;
    d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
    expect(d.run).toMatchObject({ status: 'to-accept', stage: 'plan', pending: { kind: 'done', by: 'planner', handoff: 'over to the next after 2_PLAN', toStage: null } });
    expect(stage(d, 'plan')).toMatchObject({ status: 'waiting', artifacts: ['2_PLAN.md'], endedAt: at(4) });
    expect(d.messages.slice(before).map((m) => [m.kind, m.code ?? null])).toEqual([['post', null], ['system', 'run.stage.waitAccept']]);
    expect(parseRun(d.run)).toMatchObject({ ok: true });
    const tr = d.do((r, t) => acceptStage(r, d.flow, t, 'good plan'));
    expect(d.run).toMatchObject({ status: 'gate', stage: 'gate2', pending: null });
    expect(stage(d, 'plan').status).toBe('done');
    expect(tr.messages.map((m) => [m.kind, m.code ?? m.to ?? null])).toEqual([['decision', 'stage.accepted'], ['handoff', 'person'], ['system', 'run.stage.gate']]);
    expect(tr.messages[0]).toMatchObject({ text: 'good plan', public: true });
    expect(d.run.history.map((h) => h.type)).toEqual(expect.arrayContaining(['stage-waiting', 'stage-ready', 'stage-accepted']));
  });

  it('the person may send the result back with a note: the same stage does it again at once', () => {
    const d = upToPlan();
    d.do((r, t) => startStage(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
    expect(() => returnStage(d.run, d.flow, '  ', at(9))).toThrow(expect.objectContaining({ code: 'empty-reason' }));
    const tr = d.do((r, t) => returnStage(r, d.flow, 'add a rollback section', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'plan', pending: null });
    expect(stage(d, 'plan')).toMatchObject({ attempts: 2, status: 'running', artifacts: ['2_PLAN.md'] });
    expect(tr.messages.map((m) => [m.kind, m.code ?? m.to ?? null, m.text ?? null])).toEqual([
      ['decision', 'stage.returned', 'add a rollback section'],
      ['handoff', 'planner', 'add a rollback section'],
      ['system', 'run.stage.started', null],
    ]);
  });

  it('accept and return only apply to a result that waits, and start only to a stage that waits', () => {
    const d = upToPlan();
    expect(() => acceptStage(d.run, d.flow, AT)).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    expect(() => returnStage(d.run, d.flow, 'x', AT)).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    const e = drive();
    expect(() => startStage(e.run, e.flow, AT)).toThrow(expect.objectContaining({ code: 'wrong-state' }));
  });

  it('refuses to start a stage that lost its agent', () => {
    const d = upToPlan();
    const c = agentFlowConfig();
    c.agents.team = c.agents.team.filter((a) => a.id !== 'planner');
    c.devCycle.stages.find((x) => x.id === 'plan')!.agentId = undefined;
    expect(() => startStage(d.run, flowOf(c), at(9))).toThrow(expect.objectContaining({ code: 'no-agent' }));
  });

  it('a change of the flag applies at the next stage start, never in the middle of a stage', () => {
    // Autonomous when the stage was entered, switched off before it finished: it still goes on by itself.
    const auto = drive();
    auto.do((r, t) => stageDone(r, flowWithAutonomy({ refiner: false }), done('1_SPEC'), t));
    expect(auto.run).toMatchObject({ status: 'gate', stage: 'gate1' });
    // Not autonomous when entered, switched on before the person started it: the start picks the new value up, so the result goes on by itself.
    const d = upToPlan();
    const flowOn = flowWithAutonomy({ planner: true, reviewer: false });
    d.do((r, t) => startStage(r, flowOn, t));
    expect(stage(d, 'plan').autonomous).toBe(true);
    d.do((r, t) => stageDone(r, flowWithAutonomy({ planner: false }), done('2_PLAN'), t));
    expect(d.run).toMatchObject({ status: 'gate', stage: 'gate2' });
    // And the other way: started as not autonomous, switched on in the middle: the result still waits.
    const e = upToPlan();
    e.do((r, t) => startStage(r, e.flow, t));
    e.do((r, t) => stageDone(r, flowWithAutonomy({ planner: true }), done('2_PLAN'), t));
    expect(e.run.status).toBe('to-accept');
  });

  it('applies the flag of the next agent when a stage hands over: an autonomous result into a waiting agent waits to be started', () => {
    const flow = flowWithAutonomy({ developer: false });
    const d = drive(flow);
    d.do((r, t) => stageDone(r, flow, done('1'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('2'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'implement' });
    d.do((r, t) => startStage(r, flow, t));
    expect(d.run.status).toBe('working');
  });

  const toReview = (flow: ReturnType<typeof hybrid>) => {
    const d = drive(flow);
    d.do((r, t) => stageDone(r, flow, done('1'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    d.do((r, t) => startStage(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('2'), t));
    d.do((r, t) => acceptStage(r, flow, t));
    d.do((r, t) => gateApprove(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('3'), t));
    return d;
  };

  it('review findings of a reviewer that is not autonomous wait for the person; accepting them counts the round and sends the work back', () => {
    const d = toReview(hybrid());
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'review' });
    d.do((r, t) => startStage(r, d.flow, t));
    const tr = d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F1: no test', handoff: 'add the test' }, t));
    expect(d.run).toMatchObject({ status: 'to-accept', stage: 'review', returns: {}, pending: { kind: 'return', toStage: 'implement', countRound: true, text: 'F1: no test', handoff: 'add the test' } });
    expect(tr.messages.map((m) => [m.kind, m.code ?? null])).toEqual([['post', null], ['system', 'run.stage.waitAccept']]);
    const acc = d.do((r, t) => acceptStage(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', returns: { review: 1 }, pending: null });
    expect(acc.messages.map((m) => [m.kind, m.code ?? m.to ?? null])).toEqual([['decision', 'stage.accepted'], ['handoff', 'developer'], ['system', 'run.stage.started']]);
    expect(stage(d, 'review').status).toBe('rejected');
    // The second pass with findings, accepted, reaches the limit and asks the person.
    d.do((r, t) => stageDone(r, d.flow, done('3'), t));
    d.do((r, t) => startStage(r, d.flow, t));
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F2' }, t));
    d.do((r, t) => acceptStage(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'question', question: { kind: 'review-limit', text: 'F2' }, returns: { review: 2 } });
  });

  it('what goes back into an agent that is not autonomous waits to be started, unless the person is the one sending it', () => {
    const flow = flowWithAutonomy({ reviewer: false, developer: false });
    const d = drive(flow);
    d.do((r, t) => stageDone(r, flow, done('1'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('2'), t));
    d.do((r, t) => gateApprove(r, flow, t));
    d.do((r, t) => startStage(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('3'), t));
    d.do((r, t) => acceptStage(r, flow, t));
    d.do((r, t) => startStage(r, flow, t));
    d.do((r, t) => reviewReturn(r, flow, { by: 'reviewer', findings: 'F1' }, t));
    d.do((r, t) => acceptStage(r, flow, t));
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'implement' });
    expect(stage(d, 'implement')).toMatchObject({ attempts: 2, status: 'waiting', startedAt: null });
    // A gate rejected by the person goes straight back to a producer that is not autonomous.
    const g = drive(flowWithAutonomy({ refiner: false }));
    g.do((r, t) => stageDone(r, g.flow, done('1'), t));
    g.do((r, t) => acceptStage(r, g.flow, t));
    g.do((r, t) => gateReject(r, g.flow, 'vague', t));
    expect(g.run).toMatchObject({ status: 'working', stage: 'refine' });
    // So does the answer to the review limit.
    const h = drive(flowWithAutonomy({ developer: false }));
    h.do((r, t) => stageDone(r, h.flow, done('1'), t));
    h.do((r, t) => gateApprove(r, h.flow, t));
    h.do((r, t) => stageDone(r, h.flow, done('2'), t));
    h.do((r, t) => gateApprove(r, h.flow, t));
    h.do((r, t) => startStage(r, h.flow, t));
    h.do((r, t) => stageDone(r, h.flow, done('3'), t));
    h.do((r, t) => acceptStage(r, h.flow, t));
    h.do((r, t) => reviewReturn(r, h.flow, { by: 'reviewer', findings: 'F1' }, t));
    h.do((r, t) => startStage(r, h.flow, t));
    h.do((r, t) => stageDone(r, h.flow, done('3'), t));
    h.do((r, t) => acceptStage(r, h.flow, t));
    h.do((r, t) => reviewReturn(r, h.flow, { by: 'reviewer', findings: 'F2' }, t));
    expect(h.run.status).toBe('question');
    h.do((r, t) => answer(r, h.flow, 'rename it and go on', t));
    expect(h.run).toMatchObject({ status: 'working', stage: 'implement' });
  });

  it('a hand back by an agent that is not autonomous waits for the person too', () => {
    const d = toReview(hybrid());
    d.do((r, t) => startStage(r, d.flow, t));
    d.do((r, t) => handBack(r, d.flow, { by: 'reviewer', toStage: 'plan', text: 'the plan misses a migration' }, t));
    expect(d.run).toMatchObject({ status: 'to-accept', pending: { kind: 'return', toStage: 'plan', countRound: false } });
    d.do((r, t) => acceptStage(r, d.flow, t));
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'plan', returns: {} });
  });

  it('the last agent of the cycle waits for acceptance too, and accepting ends the run', () => {
    const flow = flowWithAutonomy({ qa: false });
    const d = drive(flow);
    for (const f of ['1', '2']) {
      d.do((r, t) => stageDone(r, flow, done(f), t));
      d.do((r, t) => gateApprove(r, flow, t));
    }
    d.do((r, t) => stageDone(r, flow, done('3'), t));
    d.do((r, t) => stageDone(r, flow, done('4'), t));
    expect(d.run).toMatchObject({ status: 'to-start', stage: 'qa' });
    d.do((r, t) => startStage(r, flow, t));
    d.do((r, t) => stageDone(r, flow, done('5'), t));
    expect(d.run.status).toBe('to-accept');
    d.do((r, t) => acceptStage(r, flow, t));
    expect(d.run).toMatchObject({ status: 'done', stage: 'ready' });
  });

  it('cancelling drops what waited, and a restart leaves both waiting states as they are', () => {
    const d = upToPlan();
    expect(resumeAfterRestart(d.run, d.flow, at(9))).toEqual({ run: d.run, messages: [] });
    d.do((r, t) => startStage(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('2'), t));
    expect(resumeAfterRestart(d.run, d.flow, at(9))).toEqual({ run: d.run, messages: [] });
    d.do((r, t) => cancel(r, 'person', t));
    expect(d.run).toMatchObject({ status: 'cancelled', pending: null });
    expect(stage(d, 'plan').status).toBe('cancelled');
    const e = upToPlan();
    e.do((r, t) => cancel(r, 'person', t));
    expect(stage(e, 'plan').status).toBe('cancelled');
  });

  it('is worded in both languages', () => {
    const d = toReview(hybrid());
    d.do((r, t) => startStage(r, d.flow, t));
    d.do((r, t) => stageDone(r, d.flow, done('4'), t));
    d.do((r, t) => returnStage(r, d.flow, 'redo', t));
    const codes = new Set(d.messages.flatMap((m) => (m.code ? [m.code] : [])));
    expect([...codes]).toEqual(expect.arrayContaining(['run.stage.waitStart', 'run.stage.waitAccept', 'stage.accepted', 'stage.returned']));
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      for (const m of d.messages) expect(messageText(m), `${language} ${m.code}`).not.toMatch(/main\.forum|\{\w+\}/);
    }
    setLanguage('pt-BR');
  });
});
