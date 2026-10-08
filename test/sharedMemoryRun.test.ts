// The record of the activities through the runner itself: a start leaves a front, a move keeps it up to date, and the section a stage reads carries it. No
// model is called (the engine is a script) and no code host is touched.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { boot, work, doc } from './helpers/runner';
import { activitiesPath, readIndex } from '../src/main/runner/activities';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const dataDir = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-shared-'));

describe('the record of the activities in a run', () => {
  it('a start leaves a front, and a move keeps it up to date', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
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
      return work('Spec.', { artifacts: [doc('1_SPEC.md')] });
    });
    await b.runner.start('app#101');
    await b.settle();
    expect(seen).toContain('app#101');
  });

  it('the person corrects a front, and the correction is kept until the activity moves again', async () => {
    const dir = dataDir();
    const b = await boot({ dir });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
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
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
    await b.runner.start('app#101');
    await b.settle();
    const calls = b.engine.calls.length;
    const list = b.runner.activities();
    expect(list.some((f) => f.ref === 'app#101')).toBe(true);
    // Reading the record is not a call to a model.
    expect(b.engine.calls.length).toBe(calls);
  });
});
