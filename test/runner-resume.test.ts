// A stage that runs again: why (read from the run's history) and what the earlier attempts left done, so the agent is told what was asked instead of
// starting the stage over; and the person's note, said apart from what review and QA left open.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { ForumMessage } from '../src/shared/forum';
import { gateApprove, recordQa, retry, resumeAfterRestart, reviewReturn, sendBackText, sendBackTo, stageDone, stageFailed } from '../src/shared/runs';
import { resumeWhy, stageResume } from '../src/main/runner/executor';
import { agentFlowStages, drive } from './helpers/runs';

afterEach(() => setLanguage('pt-BR'));

const done = (name: string) => ({ summary: `${name} done`, handoff: `over to the next after ${name}`, artifacts: [`${name}.md`] });

/** A run up to the stage after QA, with a QA pass that left one scenario not run. */
function toTheEnd() {
  const d = drive(agentFlowStages());
  d.do((r, t) => stageDone(r, d.flow, done('1_SPEC'), t));
  d.do((r, t) => gateApprove(r, d.flow, t));
  d.do((r, t) => stageDone(r, d.flow, done('2_PLAN'), t));
  d.do((r, t) => gateApprove(r, d.flow, t));
  d.do((r, t) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), t));
  d.do((r, t) => stageDone(r, d.flow, done('4_REVIEW'), t));
  d.do((r, t) => recordQa(r, { stage: 'qa', by: 'qa', summary: 'Read only.', scenarios: [{ name: 'Login works', result: 'not-run', detail: 'needs a browser' }], head: 'abc' }, t));
  d.do((r, t) => stageDone(r, d.flow, done('5_TEST_PLAN'), t));
  return d;
}

const msg = (seq: number, over: Partial<ForumMessage>): ForumMessage =>
  ({ v: 1, type: 'message', seq, thread: 'run-x', at: '2026-10-03T10:00:00.000Z', kind: 'post', author: { type: 'person' }, text: '', code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null, ...over }) as ForumMessage;

describe('why a stage runs again', () => {
  it('is null for a stage reached by moving forward', () => {
    const d = toTheEnd();
    expect(resumeWhy(d.run, 'plan')).toBeNull();
    expect(resumeWhy(d.run, 'qa')).toBeNull();
  });

  it('tells a send-back, a return, a retry and a restart apart', () => {
    const sent = toTheEnd();
    sent.do((r, t) => sendBackTo(r, sent.flow, { toStage: 'qa', note: 'Keep the screenshots.' }, t));
    expect(resumeWhy(sent.run, 'qa')).toBe('sent-back');

    const returned = drive(agentFlowStages());
    returned.do((r, t) => stageDone(r, returned.flow, done('1_SPEC'), t));
    returned.do((r, t) => gateApprove(r, returned.flow, t));
    returned.do((r, t) => stageDone(r, returned.flow, done('2_PLAN'), t));
    returned.do((r, t) => gateApprove(r, returned.flow, t));
    returned.do((r, t) => stageDone(r, returned.flow, done('3_IMPLEMENTATION'), t));
    returned.do((r, t) => reviewReturn(r, returned.flow, { by: 'reviewer', findings: 'Name the constant.' }, t));
    expect(resumeWhy(returned.run, 'implement')).toBe('returned');

    const failed = drive(agentFlowStages());
    failed.do((r, t) => stageFailed(r, 'the provider refused', t));
    failed.do((r, t) => retry(r, failed.flow, t));
    expect(resumeWhy(failed.run, failed.run.stage)).toBe('retried');

    const restarted = drive(agentFlowStages());
    restarted.do((r, t) => resumeAfterRestart(r, restarted.flow, t));
    expect(resumeWhy(restarted.run, restarted.run.stage)).toBe('restarted');
  });
});

describe('what a stage that runs again is told about the earlier attempts', () => {
  it('lists its documents already in the folder, the evidence it kept and its last report', () => {
    const d = toTheEnd();
    d.do((r, t) => sendBackTo(r, d.flow, { toStage: 'qa', note: 'Keep the screenshots.' }, t));
    const run = { ...d.run, evidence: { 'ev-1': { id: 'ev-1', stage: 'qa', by: 'qa', title: 'Runs screen', description: '', name: 'a.png', kind: 'png', bytes: 10, at: d.run.updatedAt, from: null, message: null }, 'ev-2': { id: 'ev-2', stage: 'review', by: 'reviewer', title: 'Other stage', description: '', name: 'b.png', kind: 'png', bytes: 10, at: d.run.updatedAt, from: null, message: null } } } as typeof d.run;
    const wt = mkdtempSync(join(tmpdir(), 'resume-'));
    mkdirSync(join(wt, run.cycleFolder), { recursive: true });
    writeFileSync(join(wt, run.cycleFolder, '5_TEST_PLAN.md'), '# Plan\n');
    const stage = d.flow.find((s) => s.id === 'qa')!;
    const thread = [msg(1, { kind: 'post', author: { type: 'agent', id: 'qa' }, stage: 'qa', text: 'Ten scenarios checked.' }), msg(2, { kind: 'post', author: { type: 'agent', id: 'qa' }, stage: 'review', text: 'not this stage' })];
    expect(stageResume(run, stage, 'qa', thread, wt)).toEqual({ why: 'sent-back', done: ['5_TEST_PLAN.md'], evidence: [{ id: 'ev-1', title: 'Runs screen' }], previous: 'Ten scenarios checked.' });
    expect(stageResume(run, d.flow.find((s) => s.id === 'plan')!, 'planner', thread, wt)).toBeNull();
  });
});

describe('the note the person sends back with', () => {
  it('comes first, and what review and QA left open follows as context for it', () => {
    setLanguage('en');
    const d = toTheEnd();
    const text = sendBackText(d.run, 'qa', 'Only redo the evidence.');
    expect(text.startsWith('Only redo the evidence.\n\nContext for the request above, not new work')).toBe(true);
    expect(text).toContain('Login works');
  });

  it('is the whole request when the person writes nothing, with no context label', () => {
    setLanguage('en');
    const text = sendBackText(toTheEnd().run, 'qa', '');
    expect(text).not.toContain('Context for the request above');
    expect(text).toContain('Login works');
  });
});
