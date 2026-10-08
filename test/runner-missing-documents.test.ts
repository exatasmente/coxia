import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Run } from '../src/shared/runs';
import { boot, doc, work } from './helpers/runner';

// A stage whose concluding answer leaves out a document it produces is asked once for it before it fails, and a document named with its folder is still taken.
// No model, no host, no network.

const repairs = (b: Awaited<ReturnType<typeof boot>>, run: Run) => b.thread(run).filter((m) => m.code === 'runner.artifacts.repair');

describe('a document the answer leaves out', () => {
  it('is asked for once, in the same session, and the stage goes on with the rest of the first answer', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Spec written.', { handoff: 'Plan it.' }), () => work('Here it is.', { artifacts: [doc('1_SPEC.md', '# Spec\n\nThe whole spec.\n')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const now = b.runner.get(run.id) as Run;
    expect(now.status).not.toBe('failed');
    expect(readFileSync(join(now.worktree, now.cycleFolder, '1_SPEC.md'), 'utf8')).toContain('The whole spec.');
    const calls = b.engine.calls.filter((c) => c.agent.id === 'refiner');
    expect(calls).toHaveLength(2);
    // The round continues the session of the answer it is about and names the document.
    expect(calls[1].resume?.session).toBeTruthy();
    expect(calls[1].prompt).toContain('1_SPEC.md');
    expect(repairs(b, now)).toHaveLength(1);
    expect(repairs(b, now)[0].params).toMatchObject({ agent: 'refiner', names: '1_SPEC.md' });
    // The first answer stands: its summary and its handoff are what the stage recorded, not the round's.
    expect(b.thread(now).some((m) => m.kind !== 'system' && JSON.stringify(m).includes('Spec written.'))).toBe(true);
    expect(b.thread(now).some((m) => JSON.stringify(m).includes('Here it is.'))).toBe(false);
  });

  it('takes a document named with its folder by its file name, without a round', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('docs/cycles/101-x/1_SPEC.md')] }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const now = b.runner.get(run.id) as Run;
    expect(existsSync(join(now.worktree, now.cycleFolder, '1_SPEC.md'))).toBe(true);
    expect(b.engine.calls.filter((c) => c.agent.id === 'refiner')).toHaveLength(1);
    expect(repairs(b, now)).toHaveLength(0);
  });

  it('says which document it could not take, and fails when the round does not bring the one missing', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('../1_SPEC.md')] }), () => work('Same.'));
    const run = await b.runner.start('app#101');
    await b.settle();
    const now = b.runner.get(run.id) as Run;
    expect(now.status).toBe('failed');
    expect(now.error?.detail).toContain('1_SPEC.md');
    expect(b.thread(now).find((m) => m.code === 'runner.artifactUnnamed')?.params).toMatchObject({ agent: 'refiner', name: '../1_SPEC.md' });
    // One round, not two.
    expect(b.engine.calls.filter((c) => c.agent.id === 'refiner')).toHaveLength(2);
    expect(repairs(b, now)).toHaveLength(1);
  });

  it('does not ask a stage that pauses with a question', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Need to know.', { question: 'Which screen?' }));
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls.filter((c) => c.agent.id === 'refiner')).toHaveLength(1);
    expect(repairs(b, b.runner.get(run.id) as Run)).toHaveLength(0);
  });
});
