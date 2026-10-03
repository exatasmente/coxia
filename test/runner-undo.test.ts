// Undoing an automatic post: "delete" is proposed as an action that waits for a "yes", runs through the same audit as every write, and the run keeps the record
// of what was posted and removed. A test workspace refuses it, and what is not a note of the run (its pull request's description) is not offered.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { onRunnerActionDone } = await import('../src/main/runner/door');

let forge: Forge;
let stop: (() => void) | null = null;
const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
});

const comment = (sections: [string, string][]) => ({ sections: sections.map(([heading, body]) => ({ heading, body })), technical: 'Touches `src/feature.ts`.' });
const finding = (over: Record<string, unknown> = {}) => ({ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: null, ...over });

function script(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', 'X.']]) }), () => work('Spec again.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', 'X, and Y.']]) }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')], comment: comment([['Approach', 'One place.']]) }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: comment([['What changed for the person using it', 'It exists.']]), pr: { title: 'Add the thing', ...comment([['What changes for the person using it', 'X.']]) } });
  });
  b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Beyond the lines of the code', 'Wrong.']]), findings: [finding({ suggestion: 'export const feature = 2;' }), finding({ path: 'docs/notes.md', line: null, severity: 'suggestion', body: 'A title is missing.' })] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Beyond the lines of the code', 'None.']]) }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'Passed.']]) }));
}

async function ran(configure?: (c: import('../src/shared/config/types').WorkspaceConfig) => void): Promise<{ b: Boot; run: Run }> {
  forge = makeForge();
  setVcsRuntimeForTests(forge.runtime());
  const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; configure?.(c); } });
  script(b);
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const started = await b.runner.start('app#101');
  for (let i = 0; i < 8; i++) {
    await b.settle();
    if (b.runner.get(started.id)!.status !== 'gate') break;
    b.runner.gate(started.id, 'approve');
  }
  return { b, run: b.runner.get(started.id)! };
}

const undoProposal = (key: string) => actions.listActions().find((a) => (a.unit as { purpose?: string; key?: string } | null)?.purpose === 'undo' && (a.unit as { key?: string }).key === key);

describe('undoing a post of the run', () => {
  it('proposes the delete and waits: nothing is removed until the "yes", then the note is gone, audited, and the run keeps the record', async () => {
    const { b, run } = await ran();
    const noteId = run.comments.refine.noteId as number;
    expect(forge.bodies(101).some(([id]) => id === noteId)).toBe(true);

    expect(await b.runner.undoPost(run.id, 'refine')).toEqual({ proposed: true });
    await b.settle();
    const proposal = undoProposal('refine')!;
    expect(proposal).toMatchObject({ state: 'pending', kind: 'vcs', summary: expect.stringContaining('Delete the comment'), command: { method: 'DELETE', endpoint: `repos/group/project/issues/comments/${noteId}` } });
    expect(proposal.unit).toMatchObject({ runId: run.id, purpose: 'undo', key: 'refine' });
    expect(forge.bodies(101).some(([id]) => id === noteId)).toBe(true);
    expect(b.thread(run).some((m) => m.code === 'runner.undo.proposed')).toBe(true);

    await actions.approveAction(proposal.id);
    await b.settle();
    expect(forge.bodies(101).some(([id]) => id === noteId)).toBe(false);
    const after = b.runner.get(run.id)!;
    expect(after.comments.refine).toMatchObject({ status: 'removed', noteId: null, target: 'issue', body: expect.stringContaining('What is asked') });
    expect(b.thread(after).some((m) => m.code === 'runner.undo.removed')).toBe(true);
    // the delete is in the audit log like any write
    expect(listAudit().find((a) => a.target === `DELETE repos/group/project/issues/comments/${noteId}`)).toMatchObject({ ok: true, kind: 'github', issue: 101 });
  });

  it('a stage that runs again after its comment was removed posts a new one instead of editing a note that is gone', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => void (c.language = 'en') });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    await b.runner.undoPost(run.id, 'refine');
    await actions.approveAction(undoProposal('refine')!.id);
    await b.settle();
    forge.writes.length = 0;
    b.runner.gate(run.id, 'reject', 'Again.');
    await b.settle();
    const writes = forge.writes.map((w) => `${w.method} ${w.endpoint.replace('repos/group/project/', '')}`);
    // the spec again is a new comment (and the decision of the gate is another): no edit of a note that is gone
    expect(writes.some((w) => w.startsWith('PATCH'))).toBe(false);
    expect(writes.filter((w) => w === 'POST issues/101/comments')).toHaveLength(2);
    expect(b.runner.get(run.id)!.comments.refine).toMatchObject({ status: 'published' });
    expect(b.runner.get(run.id)!.comments.refine.noteId).not.toBeNull();
  });

  it('takes back the comments of a review round on their lines and files', async () => {
    const { b, run } = await ran();
    expect(run.comments['review-1']).toMatchObject({ status: 'published', target: 'mr' });
    const before = forge.threads.length;
    expect(before).toBeGreaterThanOrEqual(2);
    expect(await b.runner.undoPost(run.id, 'review-1')).toEqual({ proposed: true });
    const proposal = undoProposal('review-1')!;
    expect(proposal.commands?.map((c) => `${c.method} ${c.endpoint.replace('repos/group/project/', '')}`)).toEqual(expect.arrayContaining([expect.stringMatching(/^DELETE pulls\/comments\/\d+$/)]));
    expect(proposal.commands).toHaveLength(2);
    await actions.approveAction(proposal.id);
    await b.settle();
    // what the round opened is gone; the replies of round 2 were to threads that no longer exist, and what is left is not this round's
    expect(forge.threads.filter((t) => /coxia:run=.* stage=review round=1/.test(t.comments[0]?.body ?? ''))).toEqual([]);
    expect(b.runner.get(run.id)!.comments['review-1']).toMatchObject({ status: 'removed', noteId: null });
  });

  it('is refused in a test workspace, and says so, with nothing proposed', async () => {
    const { b, run } = await ran();
    asReal(true);
    expect(await b.runner.undoPost(run.id, 'plan')).toEqual({ proposed: false, reason: 'refused' });
    expect(undoProposal('plan')).toBeUndefined();
    expect(b.thread(run).some((m) => m.code === 'runner.undo.refused')).toBe(true);
    expect(b.runner.get(run.id)!.comments.plan.status).toBe('published');
  });

  it('is not offered for what the run did not post, for the pull request description, or twice', async () => {
    const { b, run } = await ran();
    await expect(b.runner.undoPost(run.id, 'qa-not-there')).rejects.toMatchObject({ code: 'nothing-to-undo' });
    await expect(b.runner.undoPost(run.id, 'pr')).rejects.toMatchObject({ code: 'nothing-to-undo' });
    await b.runner.undoPost(run.id, 'plan');
    await actions.approveAction(undoProposal('plan')!.id);
    await b.settle();
    await expect(b.runner.undoPost(run.id, 'plan')).rejects.toMatchObject({ code: 'nothing-to-undo' });
  });

  it('asking again while the delete still waits does not make a second proposal', async () => {
    const { b, run } = await ran();
    await b.runner.undoPost(run.id, 'implement');
    await b.runner.undoPost(run.id, 'implement');
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string; key?: string } | null)?.purpose === 'undo' && (a.unit as { key?: string }).key === 'implement')).toHaveLength(1);
  });
});
