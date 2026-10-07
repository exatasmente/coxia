// What a run leaves on the code host. A run goes through the agent cycle against a fake host with a memory: the real provider and the real list of writes
// stand in front of it, the real door (proposals in Actions, the audit log, the refusal of a test workspace) behind the runner, and a scripted engine for
// the models. Every write the host received is checked, and so is every one it did not.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkComment, type Run } from '../src/shared/runs';
import { messageText } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { commitFallback } from '../src/main/runner/git';
import { git } from './helpers/conflictRepos';
import { type Forge, HEAD, makeForge } from './helpers/fakeForge';
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

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  // the runner's own stores are the workspace's: the push reads its run from there
  rmSync(join(ATAS, 'runs'), { recursive: true, force: true });
  rmSync(join(ATAS, 'forum'), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
});

const section = (heading: string, body: string) => ({ heading, body });
const comment = (sections: [string, string][], technical = 'Touches `src/feature.ts`.') => ({ sections: sections.map(([h, b]) => section(h, b)), technical });
const finding = (over: Record<string, unknown>) => ({ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: null, ...over });

const REFINE = comment([['What is asked', '> The thing must do X and not Y.'], ['What changes for the person using it', 'The thing does X.'], ['Acceptance', 'X happens, Y does not.']]);
const PLAN = comment([['Approach', 'Add the feature in one place.'], ['How it will be tested', 'A test for X.']]);
const BUILT = (extra = '') => comment([['What changed for the person using it', `The feature exists.${extra}`], ['How to verify', 'Use the feature and see X.']]);
const PR = { title: 'Add the thing', ...comment([['What changes for the person using it', 'The thing does X.'], ['How to verify', 'Use it.']]) };

/** Every agent does its stage at once; a test overrides the ones it is about. */
function script(b: Boot): void {
  b.engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md')], comment: REFINE }));
  b.engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: BUILT(), pr: PR });
  });
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Beyond the lines of the code', 'None.']]) }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'The thing does X: passed.']]) }));
}

async function start(b: Boot): Promise<Run> {
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101');
  await b.settle();
  return run;
}

/** Approves the gates until the run is at its end or at something else. */
async function through(b: Boot, run: Run): Promise<Run> {
  for (let i = 0; i < 6; i++) {
    await b.settle();
    const now = b.runner.get(run.id)!;
    if (now.status !== 'gate') return now;
    b.runner.gate(run.id, 'approve', i === 0 ? 'Looks right.' : '');
  }
  return b.runner.get(run.id)!;
}

const issueNotes = () => forge.bodies(101);
const calls = () => forge.writes.map((w) => `${w.method} ${w.endpoint.replace('repos/group/project/', '')}`);
const marker = (run: Run, key: string) => `<!-- coxia:run=${run.id} stage=${key} -->`;

describe('a run whose agents are all autonomous', () => {
  it('leaves one comment per stage on the issue, edits it in place, reviews on the lines and never approves', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script(
      'developer',
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: BUILT(), pr: PR });
      },
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 2;\n');
        return work('Applied.', { commit: 'handle the review', artifacts: [doc('3_IMPLEMENTATION.md')], comment: BUILT(' Applied the review.'), pr: PR });
      },
    );
    b.engine.script(
      'reviewer',
      () =>
        work('Two blocking points.', {
          artifacts: [doc('4_REVIEW.md')],
          verdict: 'changes',
          comment: comment([['Beyond the lines of the code', 'The constant is wrong.']]),
          findings: [
            finding({ suggestion: 'export const feature = 2;' }),
            finding({ path: 'docs/notes.md', line: null, severity: 'suggestion', body: 'The notes need a title.' }),
            finding({ path: 'src/gone.ts', line: 3, severity: 'suggestion', body: 'This file left the change.' }),
            finding({ line: 50, severity: 'suggestion', body: 'The helper is unused.', suggestion: 'remove();' }),
          ],
        }),
      () =>
        work('Only suggestions.', {
          artifacts: [doc('4_REVIEW.md')],
          verdict: 'approved',
          comment: comment([['Beyond the lines of the code', 'Two small ones.']]),
          findings: [finding({ severity: 'suggestion', body: 'The constant must be two.' }), finding({ line: 2, severity: 'suggestion', body: 'Name the second constant.' })],
        }),
    );
    const run = await start(b);
    const end = await through(b, run);
    expect(end).toMatchObject({ status: 'done', stage: 'ready' });

    // what the host received, in order
    const id = (n: number) => issueNotes()[n][0];
    expect(calls()).toEqual([
      'POST issues/101/comments', // refine
      'POST issues/101/comments', // gate 1
      'POST issues/101/comments', // plan
      'POST issues/101/comments', // gate 2
      'POST issues/101/comments', // implement
      'POST pulls/7/reviews', // review, round 1: the line comment and the general comment
      'POST pulls/7/comments', // the file comment about the notes
      'POST pulls/7/comments', // the file comment of the finding whose line is not in the diff
      `PATCH issues/comments/${id(4)}`, // implement again: the same comment, edited
      expect.stringMatching(/^POST pulls\/7\/comments\/\d+\/replies$/), // round 2: the finding that is still there
      expect.stringMatching(/^POST pulls\/7\/comments\/\d+\/replies$/), // the notes finding was fixed: reply
      'POST graphql', // and resolved
      expect.stringMatching(/^POST pulls\/7\/comments\/\d+\/replies$/), // the unused helper was fixed: reply
      'POST graphql', // and resolved
      'POST pulls/7/reviews', // round 2: what is new
      'POST issues/101/comments', // qa
    ]);
    expect(issueNotes()).toHaveLength(6);

    // each stage's comment follows its template: status first, the sections, the technical detail last and collapsed, the marker at the end
    const refine = issueNotes()[0][1];
    expect(refine.startsWith('**Spec ready for gate 1**\n')).toBe(true);
    expect(refine).toContain('### What is asked\n\n> The thing must do X and not Y.');
    expect(refine).not.toContain('Open questions');
    expect(refine.endsWith(`</details>\n\n${marker(end, 'refine')}\n`)).toBe(true);
    expect(refine).toContain('<summary>Technical detail</summary>');
    for (const [key, body] of [['refine', refine], ['plan', issueNotes()[2][1]], ['implement', issueNotes()[4][1]]] as const) {
      expect(body, key).toContain(marker(end, key));
      expect(body, key).not.toMatch(/refiner|planner|developer|reviewer|forum|Bash|\/home\//);
    }
    // the gate's decision carries the reason and points to the comment of the stage it judged
    const decision = issueNotes()[1][1];
    expect(decision.startsWith('**Gate 1: approved**')).toBe(true);
    expect(decision).toContain('### Reason\n\nLooks right.');
    expect(decision).toContain(`Stage comment: https://example.test/group/project/issues/101#issuecomment-${id(0)}`);
    // the implement comment was edited, not posted again
    expect(issueNotes()[4][1]).toContain('Applied the review.');
    expect(end.comments.implement).toMatchObject({ target: 'issue', status: 'published', noteId: id(4) });
    expect(end.comments.refine).toMatchObject({ status: 'published', noteId: id(0), url: expect.stringContaining('#issuecomment-') });

    // the review of round 1: one review that asks for changes, with the line comment (and its suggestion block), and the general comment
    const [r1, r2] = forge.reviews;
    expect(r1).toMatchObject({ event: 'REQUEST_CHANGES', commit_id: HEAD });
    expect(r1.comments).toHaveLength(1);
    expect(r1.comments[0]).toMatchObject({ path: 'src/feature.ts', line: 1, side: 'RIGHT' });
    expect(r1.comments[0].body).toContain('**Blocks the change.** The constant must be 2.');
    expect(r1.comments[0].body).toContain('```suggestion\nexport const feature = 2;\n```');
    expect(r1.comments[0].body).toContain(`<!-- coxia:run=${end.id} stage=review round=1 finding=0 -->`);
    expect(r1.body.startsWith('**Review: changes requested (round 1)**')).toBe(true);
    // the general comment says how many comments went on the code and does not repeat them; the agent's own text stays, since it is about no finding
    expect(r1.body).toContain('3 comments left on the code itself; they are not repeated here.');
    expect(r1.body).toContain('### Beyond the lines of the code\n\nThe constant is wrong.');
    expect(r1.body).not.toContain('The notes need a title');
    expect(r1.body).toContain('Points about files that are no longer in the change');
    expect(r1.body).toContain('`src/gone.ts:3`: This file left the change.');
    expect(r1.body.indexOf('src/gone.ts')).toBeLessThan(r1.body.indexOf('<details>'));
    expect(r1.body.endsWith(`${marker(end, 'review').replace(' -->', ' round=1 -->')}\n`)).toBe(true);
    // the file comments: one about the file, one that could not stay on its line (and so only describes its replacement)
    const files = forge.writes.filter((w) => w.endpoint === 'repos/group/project/pulls/7/comments');
    expect(files[0].json).toMatchObject({ path: 'docs/notes.md', subject_type: 'file', commit_id: HEAD });
    expect(files[0].json.body).toContain('**Suggestion, does not block.** The notes need a title.');
    expect(files[1].json).toMatchObject({ path: 'src/feature.ts', subject_type: 'file' });
    expect(files[1].json.body).toContain('This is about src/feature.ts:50, which is outside the lines the pull request changes.');
    expect(files[1].json.body).toContain('Suggested replacement:');
    expect(files[1].json.body).not.toContain('```suggestion');

    // round 2: the finding still there got a reply in its own thread, the two that were fixed a reply and a resolved thread, only the new one opened a thread
    const [t0, t1, t3, t4] = forge.threads;
    expect(t0.comments.map((c) => c.body)).toEqual([expect.stringContaining('The constant must be 2.'), 'Still open in the latest changes (round 2).']);
    expect(t0.resolved).toBe(false);
    for (const t of [t1, t3]) {
      expect(t.comments[1].body).toBe('Fixed in the latest changes.');
      expect(t.resolved).toBe(true);
    }
    expect(forge.threads).toHaveLength(4);
    expect(t4.comments[0].body).toContain('Name the second constant.');
    expect(r2).toMatchObject({ event: 'COMMENT' });
    expect(r2.comments).toHaveLength(1);
    expect(r2.body.startsWith('**Review: approved (round 2)**')).toBe(true);
    // no duplicate: the finding that stayed open opened nothing new, and the run never approved anything
    expect(r2.comments[0].body).not.toContain('The constant must be two.');
    expect(forge.writes.some((w) => JSON.stringify(w.json).includes('APPROVE'))).toBe(false);
    expect(end.comments['review-1']).toMatchObject({ target: 'mr', status: 'published' });
    expect(end.comments['review-2']).toMatchObject({ target: 'mr', status: 'published' });

    // every write is in the audit log with the agent whose autonomy let it go, the target and the hash of the body
    const audit = listAudit().reverse();
    expect(audit).toHaveLength(forge.writes.length);
    expect(audit.every((a) => a.ok && a.origin.kind === 'auto')).toBe(true);
    expect(audit.map((a) => a.by).slice(0, 5)).toEqual(['refiner', 'refiner', 'planner', 'planner', 'developer']);
    expect(audit[0]).toMatchObject({ kind: 'github', target: 'POST repos/group/project/issues/101/comments', issue: 101, code: 201 });
    expect(audit[0].bodyHash).toBe(sha(refine));
    expect(audit.filter((a) => a.by === 'reviewer')).toHaveLength(forge.writes.filter((w) => /pulls|graphql/.test(w.endpoint)).length);
    expect(audit[5].bodyHash).toBe(sha(r1.body));
    // the comments the thread points at
    const linked = b.thread(end).filter((m) => m.published);
    expect(linked.length).toBeGreaterThanOrEqual(4);
    expect(linked[0].published).toMatchObject({ target: 'issue', noteId: id(0) });
    // the push waits for the person, and a later push of the same branch replaced the earlier one
    const pushes = actions.listActions().filter((a) => a.kind === 'run-push');
    expect(pushes.map((a) => a.state).sort()).toEqual(['pending', 'skipped']);
    expect(pushes[0].unit).toMatchObject({ runId: end.id, branch: end.branch });
  });

  it('asks the person in a comment of its own, and the decision of a rejected gate is a comment of its own too', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('planner', () => work('One thing is missing.', { question: 'Should it also handle Y?' }), () => work('Plan written.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }));
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], comment: REFINE }), () => work('Spec again.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', '> The thing must do X and not Y.'], ['What changes for the person using it', 'The thing does X, and now Y is said.']]) }));
    const run = await start(b);
    b.runner.gate(run.id, 'reject', 'Say what happens with Y.');
    await b.settle();
    b.runner.gate(run.id, 'approve');
    await b.settle();
    const asked = b.runner.get(run.id)!;
    expect(asked.status).toBe('question');
    b.runner.answer(run.id, 'Yes.');
    await b.settle();

    const bodies = issueNotes().map(([, body]) => body.split('\n')[0]);
    expect(bodies).toEqual(['**Spec ready for gate 1**', '**Gate 1: sent back**', '**Gate 1: approved**', '**Waiting for an answer**', '**Plan ready for gate 2**']);
    // the spec after the rejection is the same comment, found by the note the run remembers and edited
    expect(calls().filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
    expect(issueNotes()[0][1]).toContain('and now Y is said');
    expect(issueNotes()[1][1]).toContain('Say what happens with Y.');
    expect(issueNotes()[3][1]).toContain('### The question\n\nShould it also handle Y?');
    const final = b.runner.get(run.id)!;
    expect(Object.keys(final.comments).sort()).toEqual(['decision-gate1-1', 'decision-gate1-2', 'plan', 'question-plan-1', 'refine']);
  });

  it('words the stage in the language of the workspace: the decision comment, the forum and what the agent is sent', async () => {
    setLanguage('pt-BR');
    try {
      forge = makeForge();
      setVcsRuntimeForTests(forge.runtime());
      const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'pt-BR') });
      script(b);
      const run = await start(b);
      const end = await through(b, run);
      expect(end).toMatchObject({ status: 'done', stage: 'ready' });
      const first = issueNotes()[1][1].split('\n')[0];
      expect(first).toBe('**Gate 1: aprovado**');
      expect(b.thread(run).map((m) => messageText(m)).join('\n')).toContain('Etapa Plano');
      expect(b.engine.calls.find((c) => c.agent.id === 'planner')!.system).toContain('na etapa "Plano"');
      expect(b.engine.calls.find((c) => c.agent.id === 'planner')!.prompt).toContain('Etapa "Plano"');
      // the commits of the repository stay in English
      expect(commitFallback(b.runner.get(run.id)!.flow!.stages.find((st) => st.id === 'plan')!.label, false)).toBe('add the plan documents');
    } finally {
      setLanguage('en');
    }
  });

  it('finds a stage comment by its marker when the run lost the note, and edits it instead of posting another', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], comment: REFINE }), () => work('Spec again.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', 'Rewritten.']]) }));
    const run = await start(b);
    const first = issueNotes()[0][0];
    // the run forgets where its comment is
    b.runs.update(run.id, (r) => ({ run: { ...r, comments: { ...r.comments, refine: { ...r.comments.refine, noteId: null, url: null, status: 'draft' as const } } }, messages: [] }));
    b.runner.gate(run.id, 'reject', 'Again.');
    await b.settle();
    expect(issueNotes().filter(([, body]) => body.includes('stage=refine'))).toHaveLength(1);
    expect(calls().filter((c) => c === `PATCH issues/comments/${first}`)).toHaveLength(1);
    expect(issueNotes()[0][1]).toContain('Rewritten.');
    expect(b.runner.get(run.id)!.comments.refine.noteId).toBe(first);
  });

  it('says a stage that now ends differently in a short comment that links to the full one', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script(
      'qa',
      () => work('One failed.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'fail', detail: 'broke' }], comment: comment([['Scenarios verified and their result', 'a: failed.']]) }),
      () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'a: passed.']]) }),
    );
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    const qa = issueNotes().filter(([, body]) => body.includes('stage=qa -->'));
    expect(qa).toHaveLength(1);
    expect(qa[0][1].split('\n')[0]).toBe('**QA: all scenarios passed**');
    const notice = issueNotes().at(-1)?.[1] ?? '';
    expect(notice).toContain('QA: all scenarios passed. The full comment: https://example.test/group/project/issues/101#issuecomment-');
    expect(notice).toContain(`stage=qa-notice`);
    // the first QA comment was a plain post: there was nothing to announce yet
    expect(issueNotes().filter(([, body]) => body.includes('The full comment'))).toHaveLength(1);
  });
});

describe('a QA failure that does not block', () => {
  it('is a section of the QA comment and its headline says nothing blocks, and the work is not sent back', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('qa', () => work('Passes with a remark.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'a', result: 'pass', detail: '' }, { name: 'edge', result: 'fail', severity: 'non-blocking', detail: 'not in the spec' }], comment: comment([['Scenarios verified and their result', 'a: passed.']]) }));
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    expect(b.engine.calls.filter((c) => c.agent.id === 'developer')).toHaveLength(1);
    const qa = issueNotes().filter(([, body]) => body.includes('stage=qa -->'));
    expect(qa).toHaveLength(1);
    expect(qa[0][1].split('\n')[0]).toBe('**QA: nothing blocks; there are notes**');
    expect(qa[0][1]).toContain('Notes that do not block');
    expect(qa[0][1]).toContain('- edge: not in the spec');
  });
});

describe('what waits for the person', () => {
  it('keeps the comments of an agent that waits in Actions, posts them once approved, and edits them in place afterwards', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; c.agents.team.find((a) => a.id === 'planner')!.autonomous = false; } });
    script(b);
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }), () => work('Plan again.', { artifacts: [doc('2_PLAN.md')], comment: comment([['Approach', 'A different way.']]) }));
    const run = await start(b);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'to-start', stage: 'plan' });
    b.runner.startStage(run.id);
    await b.settle();
    // the result waits to be accepted, and the comment waits in Actions: nothing about the plan reached the host
    expect(b.runner.get(run.id)).toMatchObject({ status: 'to-accept' });
    const written = calls().length;
    const proposal = actions.listActions().find((a) => (a.unit as { key?: string } | null)?.key === 'plan')!;
    expect(proposal).toMatchObject({ kind: 'vcs', state: 'pending', summary: 'Plan', command: { method: 'POST', endpoint: 'repos/group/project/issues/101/comments' } });
    expect(JSON.parse(proposal.command!.json!).body).toContain('**Plan ready for gate 2**');
    expect(b.runner.get(run.id)!.comments.plan).toMatchObject({ status: 'proposed', noteId: null, body: expect.stringContaining('Approach') });
    expect(issueNotes().some(([, body]) => body.includes('stage=plan'))).toBe(false);

    // the "yes" posts it, audited as the approved action (no agent as who), and the run learns the note
    const done = await actions.approveAction(proposal.id);
    expect(done.state).toBe('done');
    await b.settle();
    expect(calls().length).toBe(written + 1);
    const posted = b.runner.get(run.id)!.comments.plan;
    expect(posted).toMatchObject({ status: 'published', noteId: issueNotes().at(-1)![0] });
    expect(listAudit()[0]).toMatchObject({ kind: 'github', target: 'POST repos/group/project/issues/101/comments', origin: { actionId: proposal.id, kind: 'vcs' } });
    expect(listAudit()[0].by).toBeUndefined();
    expect(b.thread(run.id).some((m) => m.published?.noteId === posted.noteId)).toBe(true);

    // sent back with a note, the agent writes the stage again: the edit waits as a proposal too, and the "yes" changes the same comment
    b.runner.returnStage(run.id, 'Try another approach.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'to-accept' });
    const edit = actions.listActions().find((a) => a.state === 'pending' && (a.unit as { key?: string } | null)?.key === 'plan')!;
    expect(edit.command).toMatchObject({ method: 'PATCH', endpoint: `repos/group/project/issues/comments/${posted.noteId}` });
    await actions.approveAction(edit.id);
    await b.settle();
    expect(issueNotes().filter(([, body]) => body.includes('stage=plan'))).toHaveLength(1);
    expect(issueNotes().find(([, body]) => body.includes('stage=plan'))?.[1]).toContain('A different way.');
    expect(b.runner.get(run.id)!.comments.plan).toMatchObject({ status: 'published', noteId: posted.noteId });
  });

  it('keeps only the latest text of a comment that waits: a newer one replaces the proposal that was never answered', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; c.agents.team.find((a) => a.id === 'planner')!.autonomous = false; } });
    script(b);
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }), () => work('Plan again.', { artifacts: [doc('2_PLAN.md')], comment: comment([['Approach', 'Another way.']]) }));
    const run = await start(b);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    b.runner.startStage(run.id);
    await b.settle();
    b.runner.returnStage(run.id, 'Think again.');
    await b.settle();
    const plan = actions.listActions().filter((a) => (a.unit as { key?: string } | null)?.key === 'plan');
    expect(plan.map((a) => a.state).sort()).toEqual(['pending', 'skipped']);
    expect(JSON.parse(plan.find((a) => a.state === 'pending')!.command!.json!).body).toContain('Another way.');
    // nothing about the plan reached the host: the spec's comment and gate 1's decision are all it has
    expect(issueNotes().map(([, body]) => body.split('\n')[0])).toEqual(['**Spec ready for gate 1**', '**Gate 1: approved**']);
  });

  it('holds a comment that fails its check for a "yes" even when the agent is autonomous, after masking what it could', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script(
      'refiner',
      () =>
        work('Spec.', {
          artifacts: [doc('1_SPEC.md')],
          comment: comment([['What is asked', 'I asked @planner in the forum. The api_key = sk-live-abcdefgh12345678 is in /home/dev/secret/app.env and run r-abc123-x1y2 saw it.'], ['What changes for the person using it', 'The thing does X.']]),
        }),
    );
    const run = await start(b);
    expect(forge.writes).toHaveLength(0);
    const held = actions.listActions().find((a) => (a.unit as { key?: string } | null)?.key === 'refine')!;
    const body = JSON.parse(held.command!.json!).body as string;
    expect(body).not.toMatch(/sk-live|\/home\/dev|r-abc123-x1y2/);
    expect(body).toContain('app.env');
    expect(body).toContain('`@planner`');
    expect(held.output).toMatch(/Checked before posting and held: .*forum.*firstPerson|Checked before posting and held: .*firstPerson.*forum|Checked before posting and held/);
    expect(b.thread(run.id).some((m) => m.code === 'runner.comment.held')).toBe(true);
    expect(b.runner.get(run.id)!.comments.refine.status).toBe('proposed');
    expect(checkComment(body, { status: 'Spec ready for gate 1', marker: marker(run, 'refine'), technicalDetail: true, worktree: run.worktree, agentIds: ['planner'], redact: (t) => t }).problems.map((p) => p.code)).toEqual(expect.arrayContaining(['agent', 'forum', 'firstPerson']));
    // the stage itself went on: a comment held for a "yes" never stops the run
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
  });

  it('posts nothing for a stage whose cycle has no template for it', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; delete c.devCycle.comments.plan; delete c.devCycle.comments.gate; } });
    script(b);
    const run = await start(b);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate2' });
    expect(issueNotes().map(([, body]) => body.split('\n')[0])).toEqual(['**Spec ready for gate 1**']);
    expect(b.runner.get(run.id)!.comments.plan).toBeUndefined();
    // and the next comment of a stage follows the template as it is now
    b.deps.updateConfig((c) => ({ ...c, devCycle: { ...c.devCycle, comments: { ...c.devCycle.comments, plan: { ...c.devCycle.comments.refine, status: 'The plan is in', technicalDetail: false } } } }));
    b.runner.gate(run.id, 'reject', 'Redo it.');
    await b.settle();
    expect(issueNotes().map(([, body]) => body.split('\n')[0])).toEqual(['**Spec ready for gate 1**', '**The plan is in**']);
  });
});

describe('a test workspace', () => {
  it('refuses every comment and every review, and the push and the pull request it proposes cannot be approved', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    asReal(true);
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', findings: [finding({})] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    expect(forge.writes).toEqual([]);
    expect(listAudit()).toEqual([]);
    expect(Object.values(end.comments).filter((c) => c.target === 'issue').every((c) => c.status === 'refused')).toBe(true);
    expect(end.comments['review-1'].status).toBe('refused');
    expect(b.thread(end).filter((m) => m.code === 'runner.comment.refused').length).toBeGreaterThanOrEqual(5);
    expect(b.thread(end).some((m) => m.code === 'runner.review.refused')).toBe(true);
    // the push waits as in any workspace, and approving it is refused: nothing left the machine
    const push = actions.listActions().find((a) => a.kind === 'run-push')!;
    expect(push.state).toBe('pending');
    const refused = await actions.approveAction(push.id).catch((e: Error) => e);
    expect(String(refused instanceof Error ? refused.message : refused.output)).toMatch(/test workspace|Workspace de testes/i);
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(end.branch);
    expect(listAudit()).toEqual([]);
  });
});

describe('the push and the pull request', () => {
  it('go out by themselves when the autonomy block decides them, audited, and never as proposals', async () => {
    forge = makeForge({ pr: null, linked: false });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; c.runner.autonomy = { ...c.runner.autonomy, cycle: true, push: true, pullRequest: true }; } });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    // nothing waited: no proposal was ever made, and the pull request exists on the host
    expect(actions.listActions().filter((a) => a.kind === 'run-push')).toEqual([]);
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'run-pr')).toEqual([]);
    expect(forge.pr).toMatchObject({ base: 'main' });
    // the branch is on the remote: the push really left the machine
    expect(git(b.repo.clone, 'ls-remote', '--heads', 'origin', end.branch).trim()).not.toBe('');
    expect(end.comments.pr).toMatchObject({ status: 'published', noteId: 7 });
    // both writes are audited, and the push is recorded as the push of this run's branch
    const audit = listAudit();
    expect(audit.some((a) => a.kind === 'push' && a.target === `git push origin HEAD:refs/heads/${end.branch}` && a.ok)).toBe(true);
    expect(audit.some((a) => a.target === 'POST repos/group/project/pulls' && a.origin.kind === 'auto')).toBe(true);
    expect(b.thread(end).some((m) => m.code === 'runner.push.pushed')).toBe(true);
    expect(b.thread(end).some((m) => m.code === 'runner.pr.created')).toBe(true);
  });

  it('still proposes the push when only the pull request choice is on, and the pull request waits for its own yes', async () => {
    forge = makeForge({ pr: null, linked: false });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; c.runner.autonomy = { ...c.runner.autonomy, cycle: true, pullRequest: true }; } });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    expect(actions.listActions().filter((a) => a.kind === 'run-push').map((a) => a.state)).toEqual(['pending']);
    expect(forge.pr).toBeNull();
  });

  it('keeps the push and the pull request of a test workspace refused even with both choices on', async () => {
    forge = makeForge({ pr: null, linked: false });
    setVcsRuntimeForTests(forge.runtime());
    asReal(true);
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; c.runner.autonomy = { ...c.runner.autonomy, cycle: true, push: true, pullRequest: true }; } });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    expect(actions.listActions().filter((a) => a.kind === 'run-push')).toEqual([]);
    expect(forge.pr).toBeNull();
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(end.branch);
    expect(listAudit()).toEqual([]);
    expect(b.thread(end).some((m) => m.code === 'runner.push.refused')).toBe(true);
  });

  it('are proposals only; approving the push pushes the branch and proposes the pull request, approving that opens it and the review that waited goes out', async () => {
    forge = makeForge({ pr: null, linked: false });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Beyond the lines of the code', 'One.']]), findings: [finding({ suggestion: 'export const feature = 2;' })] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', comment: comment([['Beyond the lines of the code', 'None.']]), findings: [] }));
    b.engine.script(
      'developer',
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: BUILT(), pr: PR });
      },
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 2;\n');
        return work('Applied.', { commit: 'handle the review', artifacts: [doc('3_IMPLEMENTATION.md')], comment: BUILT(' Applied.'), pr: PR });
      },
    );
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');

    // no pull request yet: the reviews wait, the comments of the stages are on the issue, and only the push is proposed
    expect(forge.writes.every((w) => /issues\/(101\/)?comments/.test(w.endpoint))).toBe(true);
    expect(end.comments['review-1'].status).toBe('draft');
    expect(end.comments['review-2'].status).toBe('draft');
    expect(b.thread(end).some((m) => m.code === 'runner.review.waiting')).toBe(true);
    const pending = actions.listActions().filter((a) => a.state === 'pending');
    expect(pending.map((a) => a.kind)).toEqual(['run-push']);
    expect(pending[0].output).toContain(`push origin HEAD:refs/heads/${end.branch}`);
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(end.branch);

    // the "sim" pushes the branch from the run's worktree, audited, and the pull request is proposed with its description from the template
    const pushed = await actions.approveAction(pending[0].id);
    expect(pushed.state).toBe('done');
    await b.settle();
    expect(git(b.repo.clone, 'ls-remote', '--heads', 'origin', end.branch)).toContain(git(end.worktree, 'rev-parse', 'HEAD'));
    expect(listAudit()[0]).toMatchObject({ kind: 'push', target: `git push origin HEAD:refs/heads/${end.branch}`, via: 'git', ok: true });
    expect(forge.pr).toBeNull();
    const prProposal = actions.listActions().find((a) => a.state === 'pending')!;
    expect(prProposal.command).toMatchObject({ method: 'POST', endpoint: 'repos/group/project/pulls' });
    const prBody = JSON.parse(prProposal.command!.json!) as { title: string; head: string; base: string; body: string };
    expect(prBody).toMatchObject({ title: 'Add the thing #101', head: end.branch, base: 'main' });
    expect(prBody.body.startsWith('**Ready for review**')).toBe(true);
    expect(prBody.body).toContain('Closes #101');
    expect(prBody.body.indexOf('Closes #101')).toBeLessThan(prBody.body.indexOf('<details>'));
    expect(prBody.body.endsWith(`${marker(end, 'pr')}\n`)).toBe(true);
    expect(b.runner.get(run.id)!.comments.pr).toMatchObject({ status: 'proposed', title: 'Add the thing #101' });

    // the "sim" opens it: the run records it, and the review of the last round (the earlier one was answered by the work that followed it) goes out on it
    await actions.approveAction(prProposal.id);
    await b.settle();
    const after = b.runner.get(run.id)!;
    expect(after.comments.pr).toMatchObject({ status: 'published', noteId: 7, url: 'https://example.test/group/project/pull/7' });
    expect(forge.reviews).toHaveLength(1);
    expect(forge.reviews[0]).toMatchObject({ event: 'COMMENT', commit_id: HEAD });
    expect(forge.reviews[0].body.startsWith('**Review: approved (round 2)**')).toBe(true);
    expect(after.comments['review-2'].status).toBe('published');
    expect(after.comments['review-1'].status).toBe('draft');
    expect(b.thread(end).some((m) => m.code === 'runner.pr.created')).toBe(true);
  });

  it('asks for changes by commenting on a pull request of the person\'s own, which the hosts do not take a request for changes on', async () => {
    forge = makeForge({ author: 'runner-bot' });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Beyond the lines of the code', 'One.']]), findings: [finding({})] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    const run = await start(b);
    await through(b, run);
    expect(forge.reviews[0]).toMatchObject({ event: 'COMMENT' });
    expect(forge.reviews[0].body.startsWith('**Review: changes requested (round 1)**')).toBe(true);
  });

  it('builds the proposal title from the issue when a stored pull request record has no title', async () => {
    forge = makeForge({ pr: null, linked: false });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    // a record from a run that predates the title field: the draft carries no title at all
    b.runs.update(run.id, (r) => ({ run: { ...r, comments: { ...r.comments, pr: { ...r.comments.pr!, title: null } } }, messages: [] }));
    const push = actions.listActions().find((a) => a.kind === 'run-push')!;
    await actions.approveAction(push.id);
    await b.settle();
    const prProposal = actions.listActions().find((a) => a.state === 'pending')!;
    const prBody = JSON.parse(prProposal.command!.json!) as { title: string };
    expect(prBody.title).toBe('Add the thing 101 #101');
  });

  it('finds a pull request the person opened by hand, and reviews on it without proposing another', async () => {
    forge = makeForge({ pr: { branch: 'cycle/101-add-the-thing-101' }, linked: true });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', comment: comment([['Beyond the lines of the code', 'None.']]), findings: [finding({ severity: 'suggestion', body: 'Name it better.' })] }));
    const run = await start(b);
    const end = await through(b, run);
    expect(forge.reviews).toHaveLength(1);
    expect(end.comments.pr).toMatchObject({ status: 'published', noteId: 7 });
    // the push is proposed; approving it finds the pull request there and proposes nothing more
    const push = actions.listActions().find((a) => a.kind === 'run-push')!;
    await actions.approveAction(push.id);
    await b.settle();
    expect(actions.listActions().filter((a) => a.state === 'pending')).toEqual([]);
    expect(forge.writes.some((w) => w.endpoint === 'repos/group/project/pulls')).toBe(false);
  });

  it('refuses a push whose run is gone or whose worktree is on another branch, and never pushes what is not committed', async () => {
    forge = makeForge({ pr: null });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    const push = actions.listActions().find((a) => a.kind === 'run-push')!;
    // a file the app has not committed
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(end.worktree, 'src/loose.ts'), 'x');
    git(end.worktree, 'add', 'src/loose.ts');
    const dirty = await actions.approveAction(push.id);
    expect(dirty.state).toBe('failed');
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(end.branch);
    // an action that names a run this workspace does not have
    const lost = actions.proposeRunPush({ key: 'push:r-gone-0000:1', issue: 101, summary: 'Push', runId: 'r-gone-0000', branch: 'cycle/x' })!;
    expect((await actions.approveAction(lost.id)).output).toMatch(/not in this workspace any more/);
    expect(existsSync(end.worktree)).toBe(true);
    expect(readFileSync(join(end.worktree, 'src/feature.ts'), 'utf8')).toBe('export const feature = 1;\n');
  });
});

describe('the push asked for while the next stage works', () => {
  it('sends what is committed and leaves the cycle memory the next stage wrote for that stage to commit', async () => {
    forge = makeForge({ pr: null });
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    const run = await start(b);
    const end = await through(b, run);
    const push = actions.listActions().find((a) => a.kind === 'run-push')!;
    // the app wrote a handover into the memory as the next stage started; that stage has not committed yet
    const { appendFileSync } = await import('node:fs');
    const memory = join(end.worktree, end.cycleFolder, 'MEMORY.md');
    appendFileSync(memory, '- Handover: next.\n');
    const head = git(end.worktree, 'rev-parse', 'HEAD').trim();
    const pushed = await actions.approveAction(push.id);
    expect(pushed.state).toBe('done');
    expect(git(b.repo.clone, 'rev-parse', `refs/heads/${end.branch}`).trim()).toBe(head);
    // the memory is still there, uncommitted, for the stage's own commit
    expect(readFileSync(memory, 'utf8')).toContain('- Handover: next.');
    expect(git(end.worktree, 'status', '--porcelain')).toContain('MEMORY.md');
  });
});

describe('an agent whose autonomy is switched in the middle of its stage', () => {
  it('still posts that stage by itself, and waits from the next stage on', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => (c.language = 'en') });
    script(b);
    b.engine.script(
      'planner',
      () => {
        b.runner.setAutonomous('planner', false);
        return work('Plan.', { artifacts: [doc('2_PLAN.md')], comment: PLAN });
      },
      () => work('Plan again.', { artifacts: [doc('2_PLAN.md')], comment: comment([['Approach', 'Changed.']]) }),
    );
    const run = await start(b);
    b.runner.gate(run.id, 'approve');
    await b.settle();
    // the stage was entered autonomous: its comment went out by itself
    expect(issueNotes().some(([, body]) => body.includes('stage=plan'))).toBe(true);
    expect(actions.listActions().filter((a) => a.state === 'pending')).toEqual([]);
    expect(b.runner.get(run.id)!.stages.find((s) => s.stage === 'plan')!.autonomous).toBe(true);
    // sent back by gate 2, the stage starts at once (the person said so), but this time its agent is the one that waits: its result and its comment do
    b.runner.gate(run.id, 'reject', 'Again.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'to-accept', stage: 'plan' });
    expect(b.runner.get(run.id)!.stages.find((s) => s.stage === 'plan')!.autonomous).toBe(false);
    const waiting = actions.listActions().filter((a) => a.state === 'pending');
    expect(waiting).toHaveLength(1);
    expect(waiting[0].command).toMatchObject({ method: 'PATCH' });
    // the person's decision at gate 2 was made while that agent was autonomous: its comment went out by itself
    expect(issueNotes().some(([, body]) => body.startsWith('**Gate 2: sent back**'))).toBe(true);
  });
});
