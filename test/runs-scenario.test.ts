import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createForumStore } from '../src/main/forum-core';
import { beginRun, moveRun } from '../src/main/runs-forum';
import { createRunStore } from '../src/main/runs-core';
import { messageText, runThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { answer, ask, gateApprove, gateReject, resumeAfterRestart, reviewReturn, stageDone, startRun } from '../src/shared/runs';
import { agentFlowStages, at, startInput } from './helpers/runs';

// The run of the spec's acceptance, minus the agents: both gates approved (one of them rejected once), one review round sent back, one question
// answered, an app restart in the middle of a stage. The run store and the forum store are the real ones, over temporary folders.

const flow = agentFlowStages();
const dirs = () => {
  const root = mkdtempSync(join(tmpdir(), 'coxia-scenario-'));
  return { runs: join(root, 'runs'), forum: join(root, 'forum') };
};
const open = (d: { runs: string; forum: string }) => ({ runs: createRunStore(d.runs), forum: createForumStore(d.forum) });
const done = (file: string) => ({ summary: `${file} written`, handoff: `next: use ${file}`, artifacts: [file] });

describe('a run from start to ready, with its thread', () => {
  it('goes through every stage, and the thread holds every post, handoff, question, answer and decision in order', () => {
    const d = dirs();
    let s = open(d);
    let minute = 0;
    const id = startInput().id;
    const t = () => at(++minute);
    beginRun(s, startRun(startInput(), flow, t()));
    const move = (fn: (r: Parameters<Parameters<typeof moveRun>[2]>[0], when: string) => ReturnType<typeof stageDone>) => moveRun(s, id, (r) => fn(r, t()));

    move((r, w) => ask(r, { by: 'refiner', text: 'Which users does this cover?' }, w));
    expect(s.runs.get(id)).toMatchObject({ status: 'question' });
    move((r, w) => answer(r, flow, 'All signed-in users', w));
    move((r, w) => stageDone(r, flow, done('1_SPEC.md'), w));
    move((r, w) => gateApprove(r, flow, w));
    move((r, w) => stageDone(r, flow, done('2_PLAN.md'), w));
    move((r, w) => gateReject(r, flow, 'the plan has no rollback', w));
    expect(s.runs.get(id)).toMatchObject({ status: 'working', stage: 'plan' });

    // The app is closed and opened again while the planner works: the stage starts over.
    s = open(d);
    moveRun(s, id, (r) => resumeAfterRestart(r, flow, t()));
    expect(s.runs.get(id)!.stages.find((x) => x.stage === 'plan')).toMatchObject({ attempts: 3, status: 'running' });

    move((r, w) => stageDone(r, flow, done('2_PLAN.md'), w));
    move((r, w) => gateApprove(r, flow, w, 'ok now'));
    move((r, w) => stageDone(r, flow, done('3_IMPLEMENTATION.md'), w));
    move((r, w) => reviewReturn(r, flow, { by: 'reviewer', findings: 'F1: the error path is untested', handoff: 'cover the error path' }, w));
    move((r, w) => stageDone(r, flow, done('3_IMPLEMENTATION.md'), w));
    move((r, w) => stageDone(r, flow, done('4_REVIEW.md'), w));
    move((r, w) => stageDone(r, flow, done('5_TEST_PLAN.md'), w));

    const run = s.runs.get(id)!;
    expect(run).toMatchObject({ status: 'done', stage: 'ready', rev: 15 });
    expect(run.stages.map((x) => [x.stage, x.status, x.attempts])).toEqual([
      ['refine', 'done', 1],
      ['gate1', 'done', 1],
      ['plan', 'done', 3],
      ['gate2', 'done', 2],
      ['implement', 'done', 2],
      ['review', 'done', 2],
      ['qa', 'done', 1],
      ['ready', 'done', 1],
    ]);

    const thread = s.forum.read(runThreadId(id))!;
    expect(thread.thread).toMatchObject({ kind: 'run', runId: id, title: 'app#101 Add the thing', openQuestion: false });
    expect(thread.messages.map((m) => m.seq)).toEqual(thread.messages.map((_, i) => i + 1));
    const kinds = thread.messages.map((m) => m.kind);
    for (const kind of ['post', 'handoff', 'question', 'answer', 'decision', 'system'] as const) expect(kinds, kind).toContain(kind);
    const story = thread.messages.filter((m) => m.kind !== 'system').map((m) => [m.kind, m.author.type === 'agent' ? m.author.id : m.author.type, m.code ?? m.text]);
    expect(story).toEqual([
      ['question', 'refiner', 'Which users does this cover?'],
      ['answer', 'person', 'All signed-in users'],
      ['post', 'refiner', '1_SPEC.md written'],
      ['handoff', 'refiner', 'next: use 1_SPEC.md'],
      ['decision', 'person', 'gate.approved'],
      ['post', 'planner', '2_PLAN.md written'],
      ['handoff', 'planner', 'next: use 2_PLAN.md'],
      ['decision', 'person', 'gate.rejected'],
      ['handoff', 'person', 'the plan has no rollback'],
      ['post', 'planner', '2_PLAN.md written'],
      ['handoff', 'planner', 'next: use 2_PLAN.md'],
      ['decision', 'person', 'gate.approved'],
      ['post', 'developer', '3_IMPLEMENTATION.md written'],
      ['handoff', 'developer', 'next: use 3_IMPLEMENTATION.md'],
      ['post', 'reviewer', 'F1: the error path is untested'],
      ['handoff', 'reviewer', 'cover the error path'],
      ['post', 'developer', '3_IMPLEMENTATION.md written'],
      ['handoff', 'developer', 'next: use 3_IMPLEMENTATION.md'],
      ['post', 'reviewer', '4_REVIEW.md written'],
      ['handoff', 'reviewer', 'next: use 4_REVIEW.md'],
      ['post', 'qa', '5_TEST_PLAN.md written'],
      ['handoff', 'qa', 'next: use 5_TEST_PLAN.md'],
    ]);
    // The answer is tied to its question, the thread ends with the run's end, and a reader can word every system line in either language.
    expect(thread.messages.find((m) => m.kind === 'answer')!.replyTo).toBe(thread.messages.find((m) => m.kind === 'question')!.seq);
    expect(thread.messages.at(-1)).toMatchObject({ kind: 'system', code: 'run.completed' });
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      for (const m of thread.messages) expect(messageText(m), `${language} ${m.code}`).not.toMatch(/main\.forum|\{\w+\}|^$/);
    }
    setLanguage('pt-BR');
  });

  it('does not open a thread for a run its issue already has', () => {
    const d = dirs();
    const s = open(d);
    beginRun(s, startRun(startInput(), flow, at(0)));
    expect(() => beginRun(s, startRun(startInput({ id: 'r-abc999-zz99' }), flow, at(1)))).toThrow(expect.objectContaining({ code: 'duplicate' }));
    expect(s.forum.list().map((x) => x.id)).toEqual([runThreadId(startInput().id)]);
  });

  it('opens the thread of a run a crash left without one when the next move is recorded', () => {
    const d = dirs();
    const s = open(d);
    s.runs.create(startRun(startInput(), flow, at(0)).run);
    moveRun(s, startInput().id, (r) => ask(r, { by: 'refiner', text: 'q?' }, at(1)));
    expect(s.forum.read(runThreadId(startInput().id))!.messages.map((m) => m.kind)).toEqual(['question']);
  });
});

describe('the evidence of a scenario', () => {
  it('reads evidence and the commands it cites, and drops what is not a command number', async () => {
    const { readScenario } = await import('../src/shared/runs');
    expect(readScenario({ name: 'a', result: 'pass', detail: '', evidence: 'executed', commands: [1, 'x', 0, 2.5, 3] })).toMatchObject({ evidence: 'executed', commands: [1, 3] });
    expect(readScenario({ name: 'a', result: 'pass', detail: '', evidence: 'ran' })).not.toHaveProperty('evidence');
  });

  it('is checked against the stage\'s commands, and everything is "read" when the agent was not asked', async () => {
    const { backEvidence } = await import('../src/shared/runs');
    const log = [{ n: 1, exitCode: 0, timedOut: false }, { n: 2, exitCode: 1, timedOut: false }, { n: 3, exitCode: null, timedOut: true }];
    const s = (result: 'pass' | 'fail' | 'not-run', commands: number[]) => ({ name: 'x', result, detail: '', evidence: 'executed' as const, commands });
    expect(backEvidence([s('pass', [1])], log, true)[0]).toMatchObject({ evidence: 'executed', commands: [1] });
    expect(backEvidence([s('pass', [2])], log, true)[0]).toMatchObject({ evidence: 'read', unbacked: true });
    expect(backEvidence([s('fail', [2])], log, true)[0]).toMatchObject({ evidence: 'executed' });
    expect(backEvidence([s('fail', [3])], log, true)[0]).toMatchObject({ evidence: 'executed' });
    expect(backEvidence([s('pass', [])], log, true)[0]).toMatchObject({ evidence: 'read', unbacked: true });
    expect(backEvidence([s('pass', [1])], log, false)[0]).toEqual({ name: 'x', result: 'pass', detail: '', evidence: 'read' });
  });
});
