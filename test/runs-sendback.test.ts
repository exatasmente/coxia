// Sending a run back to an earlier stage: the person's move, from every state in which a run waits for them and from the end.
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import {
  type FlowStage,
  RunError,
  ask,
  canSendBack,
  cancel,
  commandState,
  defaultSendBackTarget,
  gateApprove,
  looksLikeSendBack,
  parseRun,
  recordQa,
  recordReview,
  reviewReturn,
  sendBackTargets,
  sendBackTo,
  stageDone,
  stageFailed,
  startStage,
} from '../src/shared/runs';
import { agentFlowStages, drive, flowWithAutonomy } from './helpers/runs';

afterEach(() => setLanguage('pt-BR'));

const done = (name: string) => ({ summary: `${name} done`, handoff: `over to the next after ${name}`, artifacts: [`${name}.md`] });
const stage = (d: ReturnType<typeof drive>, id: string) => d.run.stages.find((s) => s.stage === id)!;

/** The engineering flow with `ready` turned into a wait for the merged pull request, so a run can sit there. */
const withWait = (): FlowStage[] => agentFlowStages().map((s) => (s.id === 'ready' ? { ...s, type: 'wait' as const, waitsFor: { kind: 'pr-merged' as const } } : s));

/** A run that went through every stage up to the one after QA. The review approved with a suggestion and QA left one scenario that did not run. */
function atTheEnd(flow: FlowStage[] = agentFlowStages()) {
  const d = drive(flow);
  d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
  d.do((r, t) => gateApprove(r, d.flow, t));
  d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
  d.do((r, t) => gateApprove(r, d.flow, t));
  d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
  const suggestion = { path: 'src/a.ts', line: 7, endLine: null, side: 'new' as const, severity: 'suggestion' as const, body: 'Rename the helper.', suggestion: null };
  d.do((r, t) => recordReview(r, { stage: 'review', by: 'reviewer', verdict: 'approved', summary: 'Fine.', findings: [suggestion], head: 'abc' }, t));
  d.do((r, t) => stageDone(r, d.flow, done('4_REVIEW'), t));
  d.do((r, t) =>
    recordQa(r, { stage: 'qa', by: 'qa', summary: 'Read only.', scenarios: [{ name: 'Login works', result: 'not-run', detail: 'needs a browser' }, { name: 'Logout', result: 'pass', detail: '' }], head: 'abc', commands: [{ command: 'npm test', exitCode: 127, timedOut: false }, { command: 'npm run lint', exitCode: 0, timedOut: false }] }, t),
  );
  d.do((r, t) => stageDone(r, d.flow, done('5_TEST_PLAN'), t));
  return d;
}

describe('where a run can be sent back to', () => {
  it('lists the work stages with an agent before the current one, in order, and nothing for the first stage', () => {
    const flow = agentFlowStages();
    expect(sendBackTargets(flow, 'ready').map((s) => s.id)).toEqual(['refine', 'plan', 'implement', 'review', 'qa']);
    expect(sendBackTargets(flow, 'gate2').map((s) => s.id)).toEqual(['refine', 'plan']);
    expect(sendBackTargets(flow, 'refine')).toEqual([]);
    expect(sendBackTargets(flow, 'ghost')).toEqual([]);
  });

  it('defaults to what the flow names for the stage, unless that stage only verifies: then to the nearest stage whose agent changes the code', () => {
    const flow = agentFlowStages();
    const writes = (a: string) => a === 'developer';
    expect(defaultSendBackTarget(flow, 'gate2', writes)?.id).toBe('plan');
    // the end stage returns to QA by the flow, which verifies and changes nothing
    expect(flow.find((s) => s.id === 'ready')?.returnsTo).toBe('qa');
    expect(defaultSendBackTarget(flow, 'ready', writes)?.id).toBe('implement');
    expect(defaultSendBackTarget(flow, 'qa', writes)?.id).toBe('implement');
    // no agent writes: the stage the flow names, then the nearest work stage
    expect(defaultSendBackTarget(flow, 'ready', () => false)?.id).toBe('qa');
    expect(defaultSendBackTarget(flow, 'refine', writes)).toBeNull();
  });

  it('is open from the states in which the run waits for the person or an event, and from the end, but not while an agent works, once cancelled, or for a squad choice', () => {
    for (const status of ['waiting', 'gate', 'to-start', 'to-accept', 'failed', 'done'] as const) expect(canSendBack({ status, question: null }), status).toBe(true);
    expect(canSendBack({ status: 'question', question: { by: 'a', kind: 'agent', text: 'x', askedAt: '', stage: 'plan' } })).toBe(true);
    expect(canSendBack({ status: 'question', question: { by: 'a', kind: 'squad', text: 'x', askedAt: '', stage: 'plan' } })).toBe(false);
    expect(canSendBack({ status: 'working', question: null })).toBe(false);
    expect(canSendBack({ status: 'cancelled', question: null })).toBe(false);
  });
});

describe('sending a run back', () => {
  it('from a wait goes to the developer as a new attempt, with the note, the open review points and what QA did not pass as the handoff, and the wait is skipped', () => {
    setLanguage('en');
    const d = atTheEnd(withWait());
    expect(d.run).toMatchObject({ status: 'waiting', stage: 'ready', wait: { kind: 'pr-merged' } });
    const before = structuredClone(d.run);
    const tr = d.do((r, t) => sendBackTo(r, d.flow, { toStage: 'implement', note: 'Address the comments on the MR.' }, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement', wait: null, question: null, pending: null, error: null });
    expect(stage(d, 'implement')).toMatchObject({ status: 'running', attempts: 2, endedAt: null });
    expect(stage(d, 'ready')).toMatchObject({ status: 'skipped' });
    // the budget of the review and QA is the person's to give, not theirs to lose
    expect(d.run.returns).toEqual(before.returns);
    expect(d.run.history.slice(-2).map((h) => [h.type, h.by])).toEqual([['sent-back', 'person'], ['stage-started', 'app']]);
    expect(d.run.history.find((h) => h.type === 'sent-back')).toMatchObject({ stage: 'ready', by: 'person', detail: 'implement: Address the comments on the MR.' });
    expect(tr.messages.map((m) => [m.kind, m.to ?? null, m.author.type])).toEqual([['decision', null, 'person'], ['handoff', 'developer', 'person'], ['system', null, 'app']]);
    const handoff = tr.messages[1].text as string;
    expect(handoff).toContain('Address the comments on the MR.');
    expect(handoff).toContain('Open points of the review (round 1)');
    expect(handoff).toContain('[suggestion] src/a.ts:7: Rename the helper.');
    expect(handoff).toContain('Login works, not run: needs a browser');
    expect(handoff).toContain('command npm test: could not run');
    expect(handoff).not.toContain('Logout');
    expect(handoff).not.toContain('npm run lint');
    // the original run was not touched
    expect(d.run).not.toBe(before);
    expect(parseRun(d.run).ok).toBe(true);
  });

  it('from the end reopens the run: it works again, the history says it was reopened and why, and the stage it left keeps how it ended', () => {
    const d = atTheEnd();
    expect(d.run).toMatchObject({ status: 'done', stage: 'ready' });
    const tr = d.do((r, t) => sendBackTo(r, d.flow, { toStage: 'implement', note: 'The QA points are real.' }, t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'implement' });
    expect(stage(d, 'ready').status).toBe('done');
    expect(d.run.history.filter((h) => ['reopened', 'sent-back'].includes(h.type)).map((h) => [h.type, h.by, h.detail])).toEqual([
      ['reopened', 'person', 'The QA points are real.'],
      ['sent-back', 'person', 'implement: The QA points are real.'],
    ]);
    expect(tr.messages[0]).toMatchObject({ kind: 'decision', code: 'run.reopened', text: 'The QA points are real.' });
    // the later stages run again in order: review comes after the developer, as before
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    expect(d.run).toMatchObject({ status: 'working', stage: 'review' });
    expect(stage(d, 'review').attempts).toBe(2);
  });

  it('from a gate, a stage that waits to be accepted, a failure and a question', () => {
    const gate = drive();
    gate.do((r, t) => stageDone(r, gate.flow, done('1_SPEC'), t));
    gate.do((r, t) => gateApprove(r, gate.flow, t));
    gate.do((r, t) => stageDone(r, gate.flow, done('2_PLAN'), t));
    expect(gate.run).toMatchObject({ status: 'gate', stage: 'gate2' });
    gate.do((r, t) => sendBackTo(r, gate.flow, { toStage: 'refine', note: 'The spec is missing the empty case.' }, t));
    expect(gate.run).toMatchObject({ status: 'working', stage: 'refine' });
    expect(stage(gate, 'gate2').status).toBe('rejected');

    const accept = drive(flowWithAutonomy({ reviewer: false }));
    for (const n of ['1_SPEC']) accept.do((r, t) => stageDone(r, accept.flow, done(n), t));
    accept.do((r, t) => gateApprove(r, accept.flow, t));
    accept.do((r, t) => stageDone(r, accept.flow, done('2_PLAN'), t));
    accept.do((r, t) => gateApprove(r, accept.flow, t));
    accept.do((r, t) => stageDone(r, accept.flow, done('3_IMPLEMENTATION'), t));
    accept.do((r, t) => startStage(r, accept.flow, t));
    accept.do((r, t) => reviewReturn(r, accept.flow, { by: 'reviewer', findings: 'F1' }, t));
    expect(accept.run).toMatchObject({ status: 'to-accept', stage: 'review', returns: {} });
    accept.do((r, t) => sendBackTo(r, accept.flow, { toStage: 'plan', note: 'Rethink the approach.' }, t));
    expect(accept.run).toMatchObject({ status: 'working', stage: 'plan', pending: null });

    const failed = drive();
    failed.do((r, t) => stageDone(r, failed.flow, done('1_SPEC'), t));
    failed.do((r, t) => gateApprove(r, failed.flow, t));
    failed.do((r, t) => stageFailed(r, 'the model said no', t));
    expect(failed.run.status).toBe('failed');
    failed.do((r, t) => sendBackTo(r, failed.flow, { toStage: 'refine', note: 'Start from the spec.' }, t));
    expect(failed.run).toMatchObject({ status: 'working', stage: 'refine', error: null });
    expect(stage(failed, 'plan').status).toBe('failed');

    const asked = drive();
    asked.do((r, t) => stageDone(r, asked.flow, done('1_SPEC'), t));
    asked.do((r, t) => gateApprove(r, asked.flow, t));
    asked.do((r, t) => ask(r, { by: 'planner', text: 'Which database?' }, t));
    expect(asked.run.status).toBe('question');
    asked.do((r, t) => sendBackTo(r, asked.flow, { toStage: 'refine', note: 'Decide the database in the spec.' }, t));
    expect(asked.run).toMatchObject({ status: 'working', stage: 'refine', question: null });
  });

  it('is refused for a cancelled run, for a run an agent is working, and for a target that is not an earlier work stage', () => {
    const d = atTheEnd(withWait());
    const flow = d.flow;
    for (const toStage of ['ready', 'gate1', 'ghost', 'communicate']) expect(() => sendBackTo(d.run, flow, { toStage, note: 'x' }, '2026-10-03T12:00:00.000Z'), toStage).toThrow(expect.objectContaining({ code: 'unknown-stage' }));
    const cancelled = cancel(d.run, 'person', '2026-10-03T12:00:00.000Z').run;
    expect(() => sendBackTo(cancelled, flow, { toStage: 'implement', note: 'x' }, '2026-10-03T12:01:00.000Z')).toThrow(expect.objectContaining({ code: 'not-active' }));
    const working = drive();
    expect(() => sendBackTo(working.run, working.flow, { toStage: 'refine', note: 'x' }, '2026-10-03T12:00:00.000Z')).toThrow(RunError);
    expect(() => sendBackTo(working.run, working.flow, { toStage: 'refine', note: 'x' }, '2026-10-03T12:00:00.000Z')).toThrow(expect.objectContaining({ code: 'wrong-state' }));
  });

  it('needs a note only when nothing is open: with a review or QA point left, the points are the instruction', () => {
    const plain = drive();
    plain.do((r, t) => stageDone(r, plain.flow, done('1_SPEC'), t));
    plain.do((r, t) => gateApprove(r, plain.flow, t));
    plain.do((r, t) => stageDone(r, plain.flow, done('2_PLAN'), t));
    expect(() => sendBackTo(plain.run, plain.flow, { toStage: 'plan', note: '  ' }, '2026-10-03T12:00:00.000Z')).toThrow(expect.objectContaining({ code: 'empty-reason' }));
    const d = atTheEnd();
    const tr = d.do((r, t) => sendBackTo(r, d.flow, { toStage: 'implement', note: '' }, t));
    expect(d.run.stage).toBe('implement');
    expect(tr.messages[1].text).toContain('src/a.ts:7');
  });

  it('does not repeat what the stage already worked on: a review that came before its latest attempt is not open any more', () => {
    const d = atTheEnd();
    d.do((r, t) => sendBackTo(r, d.flow, { toStage: 'implement', note: 'First pass.' }, t));
    d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
    // the developer worked after those records: only a note is left to say
    d.do((r, t) => stageFailed(r, 'the model said no', t));
    expect(() => sendBackTo(d.run, d.flow, { toStage: 'implement', note: '' }, '2026-10-03T12:00:00.000Z')).toThrow(expect.objectContaining({ code: 'empty-reason' }));
  });
});

describe('what the screens ask about a text', () => {
  it('reads a command as how it ended, with 126 and 127 as "could not run"', () => {
    expect(commandState({ exitCode: 0, timedOut: false })).toBe('ok');
    expect(commandState({ exitCode: 1, timedOut: false })).toBe('failed');
    expect(commandState({ exitCode: 127, timedOut: false })).toBe('not-run');
    expect(commandState({ exitCode: 126, timedOut: false })).toBe('not-run');
    expect(commandState({ exitCode: null, timedOut: false })).toBe('not-run');
    expect(commandState({ exitCode: null, timedOut: true })).toBe('timeout');
  });

  it('knows a request to send the work back from the name of an agent or from the words of one, in both languages', () => {
    const team = ['developer', 'qa'];
    expect(looksLikeSendBack('volte para o @developer analisar os comentários no MR', team)).toBe(true);
    expect(looksLikeSendBack('@qa please look again', team)).toBe(true);
    expect(looksLikeSendBack('Devolva para o desenvolvimento', team)).toBe(true);
    expect(looksLikeSendBack('refaça o teste', team)).toBe(true);
    expect(looksLikeSendBack('please go back and fix it', team)).toBe(true);
    expect(looksLikeSendBack('Send back to the developer', team)).toBe(true);
    expect(looksLikeSendBack('return it to implement', team)).toBe(true);
    expect(looksLikeSendBack('O MR foi mesclado por fora.', team)).toBe(false);
    expect(looksLikeSendBack('The other issue was closed by hand.', team)).toBe(false);
    // an @ that is not an agent of the team is not one (an e-mail, a handle)
    expect(looksLikeSendBack('ask ana@example.com or @stranger', team)).toBe(false);
  });
});
