// The record of the activities through the runner itself: a start leaves a front, a move keeps it up to date, and the section a stage reads carries it. No
// model is called (the engine is a script) and no code host is touched.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { messageText, runThreadId, type ForumMessage } from '../src/shared/forum';
import { boot, doc, fakeSandbox, work, type Boot } from './helpers/runner';
import { activitiesPath, readIndex } from '../src/main/runner/activities';
import { inboxOf } from '../src/main/runner/inbox';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const dataDir = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-shared-'));

describe('the record of the activities in a run', () => {
  it('a start leaves a front, and a move keeps it up to date', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const written = readIndex(dir);
    expect(written).not.toBeNull();
    const front = written?.fronts['app#101'];
    expect(front).toBeDefined();
    expect(front?.runId).toBe(run.id);
    expect(front?.stage?.label).toBeTruthy();
    // The file is in the workspace's own folder, outside the run's worktree.
    expect(activitiesPath(dir)).toBe(join(dir, 'memory', 'activities.json'));
    expect(activitiesPath(dir).startsWith(run.worktree)).toBe(false);
  });

  it('the section a stage reads carries its own activity whole', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    let seen = '';
    b.engine.script('refiner', (call) => {
      seen = call.prompt;
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] });
    });
    await b.runner.start('app#101');
    await b.settle();
    expect(seen).toContain('app#101');
  });

  it('the person corrects a front, and the correction is kept until the activity moves again', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const corrected = b.runner.correctActivity('app#101', 'Waiting on the fixtures, per the person.');
    expect(corrected?.source).toBe('person');
    const read = b.runner.activities().find((f) => f.ref === 'app#101');
    expect(read?.correction).toEqual(['Waiting on the fixtures, per the person.']);
    expect(readFileSync(activitiesPath(dir), 'utf8')).toContain('Waiting on the fixtures, per the person.');
    expect(b.runner.correctActivity('app#404', 'nope')).toBeNull();
    void run;
  });

  it('the activities are listed without a model call, one entry per activity', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    await b.runner.start('app#101');
    await b.settle();
    const calls = b.engine.calls.length;
    const list = b.runner.activities();
    expect(list.some((f) => f.ref === 'app#101')).toBe(true);
    // The list says what the record holds for the same activity, not a fabricated one.
    const front = readIndex(dir)?.fronts['app#101'];
    expect(list.find((f) => f.ref === 'app#101')?.stage?.label).toBe(front?.stage?.label);
    // Reading the record is not a call to a model.
    expect(b.engine.calls.length).toBe(calls);
  });

  it('a message arriving while the stage is finishing comes back with the person words whole', async () => {
    const dir = dataDir();
    // A post that does not end in "?" comes back with its own text in the closing line (`runner.message.afterClose`).
    const question = 'the fixture is not real yet';
    let booted: Boot | null = null;
    let posted: ForumMessage[] = [];
    const b = await boot({ dir, sandbox: fakeSandbox(), configure: (c) => { c.agents.team.find((a) => a.id === 'developer')!.shell = 'sandbox'; } });
    booted = b;
    // The Electron module routes every forum message to the runner; the test harness wires it here, as the app does.
    b.forum.subscribe((m) => b.runner.onMessage(m));
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    // The developer's stage holds the mailbox in its closing window: the person's message lands after `closing()`, so `post` refuses it.
    b.engine.script('developer', () => {
      const run = booted!.runner.get(booted!.runner.list()[0]!.id);
      const inbox = run ? inboxOf(run.id) : null;
      if (!run || !inbox) throw new Error('no mailbox for the working stage');
      inbox.closing();
      posted = booted!.forum.append(runThreadId(run.id), { kind: 'post', author: { type: 'person' }, text: question, mentions: ['developer'], waitsForAnswer: false });
      return work('Done.', { commit: 'add it', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await b.runner.start('app#101');
    // Reach the developer's stage: the gates of the cycle are approved by the person here (the mailbox is put in its closing window there).
    for (let i = 0; i < 20; i++) {
      await b.settle();
      const now = b.runner.get(run.id)!;
      if (now.stage === 'implement' && now.status !== 'working') break;
      if (now.status === 'gate') b.runner.gate(now.id, 'approve');
      else break;
    }
    await b.settle();
    expect(posted).toHaveLength(1);
    const closing = b.thread(run).filter((m) => m.code === 'runner.message.afterClose');
    expect(closing).toHaveLength(1);
    // The closing line carries the person's own words whole at its end, with nothing of the app glued after them (the "record moved" sentence).
    expect(messageText(closing[0])).toContain(question);
    expect(messageText(closing[0]).trimEnd().endsWith(question)).toBe(true);
  });
});
