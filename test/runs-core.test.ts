import { describe, expect, it } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import { messageText } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import {
  MAX_REVIEW_ROUNDS,
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
import { AT, agentFlowConfig, agentFlowStages, at, drive, startInput } from './helpers/runs';

const done = (name: string) => ({ summary: `${name} done`, handoff: `over to the next after ${name}`, artifacts: [`${name}.md`] });
const stage = (d: ReturnType<typeof drive>, id: string) => d.run.stages.find((s) => s.stage === id)!;

describe('the flow of the agent cycle', () => {
  it('is the stages in rank order, each with the agent that works it; gates and the last stage have none', () => {
    const flow = agentFlowStages();
    expect(flow.map((s) => [s.id, s.human, s.agent])).toEqual([
      ['refine', false, 'refiner'],
      ['gate1', true, null],
      ['plan', false, 'planner'],
      ['gate2', true, null],
      ['implement', false, 'developer'],
      ['review', false, 'reviewer'],
      ['qa', false, 'qa'],
      ['ready', false, null],
    ]);
    expect(flow[0].artifacts).toEqual(['1_SPEC.md']);
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
    expect(d.run).toMatchObject({ status: 'working', stage: 'refine', rev: 0, question: null, error: null, comments: {}, review: { rounds: 0, max: MAX_REVIEW_ROUNDS } });
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
      expect((e as RunError).message).toContain('Review');
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
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', review: { rounds: 1, max: 2 } });
    expect(stage(d, 'review').status).toBe('rejected');
    expect(stage(d, 'implement').attempts).toBe(2);
    expect(first.messages.map((m) => [m.kind, m.to ?? null])).toEqual([['post', null], ['handoff', 'developer'], ['system', null]]);
    expect(first.messages[1].text).toBe('add the test for F1');
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    expect(d.run.stage).toBe('review');
    const second = d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F2: naming' }, t));
    expect(d.run).toMatchObject({ status: 'question', question: { by: 'app', kind: 'review-limit', text: 'F2: naming', stage: 'review' }, review: { rounds: 2 } });
    expect(second.messages.map((m) => [m.kind, m.code ?? null])).toEqual([['post', null], ['question', 'review.limit']]);
  });

  it('continues after the person answers the limit: back to the developer with the answer, and a fresh budget', () => {
    const d = atReview();
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F1' }, t));
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    d.do((r, t) => reviewReturn(r, d.flow, { by: 'reviewer', findings: 'F2' }, t));
    const tr = d.do((r, t) => answer(r, d.flow, 'just rename it and move on', t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', question: null, review: { rounds: 0 } });
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
