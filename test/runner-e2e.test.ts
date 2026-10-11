// An issue goes through the whole agent cycle: a temporary git repository, a code host that can only be read and a scripted engine that stands
// for the models. Everything else is real: the worktree, the guard in front of the developer's tools, the commits, the run store and the thread.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MEMORY_MAX, MEMORY_SECTIONS } from '../src/main/runner/memory';
import { runThreadId } from '../src/shared/forum';
import { t } from '../src/shared/i18n';
import { MEMORY_FILE, type Run } from '../src/shared/runs';
import { git } from './helpers/conflictRepos';
import { boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

describe('a run from refine to ready', () => {
  it('goes through both gates, a question, a review sent back once and a stage that waits for the person', async () => {
    const b = await boot();
    const { engine, runner } = b;
    const seen: Record<string, unknown> = {};

    engine.script('refiner', () => work('Spec written.', { commit: 'write the spec.', artifacts: [doc('1_SPEC.md', '# Spec\nDo X, not Y.\n'), doc('REQUIREMENTS.md')], handoff: 'Plan X and leave Z out.' }));
    engine.script(
      'planner',
      () => work('One decision is missing.', { question: 'Should the thing also handle Y?' }),
      () => work('Plan written.', { artifacts: [doc('2_PLAN.md', '# Plan\nStep 1.\n'), doc('PROTOTYPE.md')], handoff: 'Start with step 1.' }),
    );
    engine.script(
      'developer',
      async (call, tools) => {
        seen.inside = await tools.write('src/feature.ts', 'export const feature = 1;\n');
        seen.outside = await tools.write(join(b.repo.root, 'outside.txt'), 'x');
        seen.hook = await tools.write('.git/hooks/pre-commit', '#!/bin/sh\ntouch hook-ran\n');
        seen.curl = await tools.bash('curl https://example.com');
        seen.push = await tools.bash('git push origin HEAD');
        seen.npmTest = await tools.bash('npm test');
        return work('Implemented the feature.', { commit: 'Add the feature', artifacts: [doc('3_IMPLEMENTATION.md', '# Implementation\n')], handoff: 'Review src/feature.ts.' });
      },
      async (call, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 2;\n');
        return work('Applied the review.', { commit: 'handle the review finding', artifacts: [doc('3_IMPLEMENTATION.md', '# Implementation (2)\n')] });
      },
    );
    engine.script(
      'reviewer',
      () =>
        work('One problem.', {
          artifacts: [doc('4_REVIEW.md', '# Review 1\n')],
          verdict: 'changes',
          findings: [{ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: 'export const feature = 2;' }],
        }),
      () => work('Looks good.', { artifacts: [doc('4_REVIEW.md', '# Review 2\n')], verdict: 'approved', findings: [] }),
    );
    engine.script('qa', () => work('Every scenario passes.', { artifacts: [doc('5_TEST_PLAN.md', '# Test plan\n')], scenarios: [{ name: 'the thing works', result: 'pass', detail: 'seen working' }] }));

    // start: the issue is read, a branch and a worktree are made, the folder has the issue in it, and the refiner works
    let run = await runner.start('app#101');
    await b.settle();
    run = runner.get(run.id)!;
    expect(b.issues.reads).toEqual([101]);
    expect(run).toMatchObject({ status: 'gate', stage: 'gate1', branch: 'cycle/101-add-the-thing-101', cycleFolder: 'docs/cycles/101-add-the-thing-101', repo: 'app' });
    const wt = run.worktree;
    expect(wt).toBe(join(b.repo.worktrees, 'app', '101-add-the-thing-101'));
    const folder = join(wt, run.cycleFolder);
    const issueText = readFileSync(join(folder, '0_ISSUE.md'), 'utf8');
    expect(issueText).toContain('The thing must do X and not Y.');
    expect(issueText).toContain('Please keep it small.');
    expect(issueText).not.toContain('changed the label');
    expect(readFileSync(join(folder, '1_SPEC.md'), 'utf8')).toBe('# Spec\nDo X, not Y.\n');
    expect(git(wt, 'log', '--format=%s', 'main..HEAD').split('\n')).toEqual(['feat: add the refine documents #101', 'feat: add the issue record #101']);
    expect(run.base).toBe(git(b.repo.clone, 'rev-parse', 'main'));
    // what the refiner was given: the issue as data, the rules of a reader, no way to write
    const refine = engine.calls[0];
    expect(refine.prompt).toContain('<data>');
    expect(refine.prompt).toContain('The thing must do X and not Y.');
    expect(refine.prompt).toContain('1_SPEC.md');
    expect(refine.confine).toBeUndefined();
    expect(refine.system).toContain('Nunca anuncie na conversa uma pergunta');
    expect(refine.cwd).toBe(wt);

    // gate 1 approved; the planner asks, the run waits, and a post in the thread answers it
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'question', stage: 'plan' });
    expect(run.question).toMatchObject({ by: 'planner', text: 'Should the thing also handle Y?' });
    expect(engine.calls[1].prompt).toContain('Plan X and leave Z out.');
    const answered = runner.answerPost(`run-${run.id}`, 'Yes, handle Y as well.');
    expect(answered).toMatchObject({ kind: 'answer', text: 'Yes, handle Y as well.' });
    await b.settle();
    run = runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'gate', stage: 'gate2' });
    expect(engine.calls[2].prompt).toContain('Should the thing also handle Y?');
    expect(engine.calls[2].prompt).toContain('Yes, handle Y as well.');
    // a resumed stage is told to update its documents with the answer, not to read the repository again
    expect(engine.calls[2].prompt).toContain('sem explorar o repositório do zero');
    expect(engine.calls[1].prompt).not.toContain('sem explorar o repositório do zero');
    expect(run.stages.find((s) => s.stage === 'plan')?.attempts).toBe(1);

    // QA stops being autonomous before it is reached; gate 2 approved; implement, review, back to implement, review again
    runner.setAutonomous('qa', false);
    runner.gate(run.id, 'approve', 'go');
    await b.settle();
    run = runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'to-start', stage: 'qa' });
    expect(engine.calls.map((c) => c.agent.id)).toEqual(['refiner', 'planner', 'planner', 'developer', 'reviewer', 'developer', 'reviewer']);
    expect(run.reviews.map((r) => [r.round, r.verdict, r.findings.length])).toEqual([[1, 'changes', 1], [2, 'approved', 0]]);
    expect(run.reviews[0].findings[0]).toMatchObject({ path: 'src/feature.ts', line: 1, severity: 'blocking', suggestion: 'export const feature = 2;' });
    expect(run.returns).toEqual({ review: 1 });

    // what the developer could and could not do
    expect(seen).toMatchObject({ inside: null, npmTest: null });
    expect(seen.outside).toMatch(/fora da pasta de trabalho/);
    expect(seen.hook).toMatch(/\.git/);
    expect(String(seen.curl)).toMatch(/npm test/);
    expect(String(seen.push)).toMatch(/npm test/);
    expect(existsSync(join(b.repo.root, 'outside.txt'))).toBe(false);
    expect(existsSync(join(wt, '.git'))).toBe(true);
    expect(existsSync(join(wt, 'hook-ran'))).toBe(false);
    const dev = engine.calls[3];
    expect(dev.cwd).toBe(wt);
    expect(dev.confine?.root).toBe(wt);
    expect(dev.system).toContain('npm test, npm run typecheck');
    // the second round of the developer received the review as its handoff, with the place and the suggestion
    expect(engine.calls[5].prompt).toContain('src/feature.ts:1');
    expect(engine.calls[5].prompt).toContain('The constant must be 2.');
    expect(engine.calls[5].prompt).toContain('export const feature = 2;');
    // and the reviewer read the diff of the branch, not the cycle folder
    expect(engine.calls[4].prompt).toContain('+export const feature = 1;');
    expect(engine.calls[4].prompt).not.toContain('+# Spec');
    expect(engine.calls[6].prompt).toContain('+export const feature = 2;');
    expect(engine.calls[4].confine).toBeUndefined();

    // the stage that waits: it starts when the person says so, and its result waits to be accepted
    expect(engine.calls.some((c) => c.agent.id === 'qa')).toBe(false);
    runner.startStage(run.id);
    await b.settle();
    run = runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'to-accept', stage: 'qa' });
    expect(run.pending).toMatchObject({ kind: 'done', by: 'qa' });
    expect(run.qa).toHaveLength(1);
    runner.accept(run.id);
    await b.settle();
    run = runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'done', stage: 'ready', error: null });

    // the commits: made by the app, as the configured identity, with the repository's convention and nothing about a tool
    const subjects = git(wt, 'log', '--format=%s', 'main..HEAD').split('\n').reverse();
    expect(subjects).toEqual([
      'feat: add the issue record #101',
      'feat: add the refine documents #101',
      'feat: add the plan documents #101',
      'feat: add the feature #101',
      'feat: add the review documents #101',
      'feat: handle the review finding #101',
      'feat: add the review documents #101',
      'feat: add the qa documents #101',
    ]);
    const messages = git(wt, 'log', '--format=%B', 'main..HEAD');
    expect(messages).not.toMatch(/co-authored-by|generated with|claude/i);
    expect(new Set(git(wt, 'log', '--format=%an <%ae>|%cn <%ce>', 'main..HEAD').split('\n'))).toEqual(new Set(['Runner Test <runner@example.test>|Runner Test <runner@example.test>']));
    expect(git(wt, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(wt, 'src/feature.ts'), 'utf8')).toBe('export const feature = 2;\n');
    for (const f of ['0_ISSUE.md', '1_SPEC.md', '2_PLAN.md', '3_IMPLEMENTATION.md', '4_REVIEW.md', '5_TEST_PLAN.md']) expect(existsSync(join(folder, f)), f).toBe(true);
    // the user's own checkout is where it was
    expect(git(b.repo.clone, 'status', '--porcelain')).toBe('');
    expect(git(b.repo.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');

    // the thread: everything an agent said, asked, was answered and decided, in order, and every refusal
    const thread = b.thread(run);
    const kinds = thread.filter((m) => m.kind !== 'system').map((m) => `${m.kind}:${m.author.type === 'agent' ? m.author.id : m.author.type}`);
    expect(kinds).toEqual([
      'post:refiner',
      'handoff:refiner',
      'decision:person',
      'post:planner',
      'question:planner',
      'answer:person',
      'post:planner',
      'handoff:planner',
      'decision:person',
      'post:developer',
      'handoff:developer',
      'post:reviewer',
      'handoff:reviewer',
      'post:developer',
      'post:reviewer',
      'post:qa',
      'decision:person',
    ]);
    expect(thread.map((m) => m.seq)).toEqual(thread.map((_, i) => i + 1));
    const refusals = thread.filter((m) => m.code === 'runner.denied');
    expect(refusals.map((m) => m.params.tool)).toEqual(['Write', 'Write', 'Bash', 'Bash']);
    expect(refusals.every((m) => m.stage === 'implement')).toBe(true);
    expect(b.notices.map((n) => n.title.replace(/app#101/, 'REF'))).toEqual([
      'REF espera você no gate',
      'REF: um agente tem uma pergunta',
      'REF espera você no gate',
      'REF: etapa esperando para começar',
      'REF: resultado esperando você',
      'REF: execução concluída',
    ]);
    // every call of an agent ran under the run's activity, so the live view follows it
    expect(new Set(engine.jobs)).toEqual(new Set([`run:${run.id}`]));
  });
});

// The cycle memory: one file in the cycle folder that the stage reads whole, the stage that concludes rewrites, and the person may correct on the run screen. It is
// what a long run keeps after the folder budget and the 40-message window of the thread have cut everything else. Scripted agents only; nothing reaches a model.
describe('the cycle memory of a run', () => {
  const memoryOf = (run: Run): string => readFileSync(join(run.worktree, run.cycleFolder, MEMORY_FILE), 'utf8');
  const headingsOf = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('## '));

  it('is born with the run, takes what the conversation decided, and the stage that concludes commits it', async () => {
    const b = await boot();
    const { engine, runner } = b;
    engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan X and leave Z out.' }));
    engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Implemented.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    engine.script('reviewer', () => work('Approved.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'the thing works', result: 'pass', detail: 'seen working' }] }));

    let run = await runner.start('app#101');
    await b.settle();
    run = runner.get(run.id)!;
    // the skeleton is in the folder from the first stage, that stage's commit carries it like a document, and the run screen lists it
    expect(memoryOf(run)).toContain(`# ${t('main.runner.memory.title')}`);
    expect(git(run.worktree, 'show', '--name-only', '--format=', 'HEAD')).toContain(MEMORY_FILE);
    expect(run.stages.find((s) => s.stage === 'refine')?.artifacts).toContain(MEMORY_FILE);

    // gate 1: the refiner's handoff enters the memory at the next stage, marked with the number of the message it came from
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    const afterPlan = memoryOf(run);
    expect(afterPlan).toContain('Plan X and leave Z out.');
    expect(afterPlan).toMatch(/<!-- handoff:\d+ -->/);
    expect(headingsOf(afterPlan)).toEqual(MEMORY_SECTIONS.map((id) => `## ${t(`main.runner.memory.section.${id}`)}`));

    // a run whose folder predates the memory (no MEMORY.md in it) gains the skeleton again at its next stage
    rmSync(join(run.worktree, run.cycleFolder, MEMORY_FILE));
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    expect(run.status).toBe('done');
    expect(existsSync(join(run.worktree, run.cycleFolder, MEMORY_FILE))).toBe(true);
    expect(memoryOf(run)).toContain('Plan X and leave Z out.');
    // the memory is tracked like the documents, and the app left nothing of the run behind
    expect(git(run.worktree, 'log', '--format=', '--name-only', 'main..HEAD')).toContain(MEMORY_FILE);
    expect(git(run.worktree, 'status', '--porcelain')).toBe('');
  });

  it('records what a review sent back, and a stage reads it even after the conversation passes the window it is given', async () => {
    const b = await boot();
    const { engine, runner } = b;
    engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
    engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    engine.script(
      'developer',
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Implemented.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
      },
      async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 2;\n');
        return work('Applied the review.', { commit: 'handle the review finding', artifacts: [doc('3_IMPLEMENTATION.md')] });
      },
    );
    engine.script(
      'reviewer',
      () => work('One problem.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', findings: [{ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: 'export const feature = 2;' }] }),
      () => work('Looks good.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }),
    );
    engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'the thing works', result: 'pass', detail: 'seen working' }] }));

    let run = await runner.start('app#101');
    await b.settle();
    run = runner.get(run.id)!;
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;

    // the person's answer and a handoff, then enough traffic to push them out of the 40 messages a stage receives
    const thread = runThreadId(run.id);
    b.forum.append(thread, [
      { kind: 'answer', author: { type: 'person' }, text: 'Ship it behind a flag.' },
      { kind: 'handoff', author: { type: 'agent', id: 'planner' }, to: 'reviewer', text: 'The plan is settled.' },
      ...Array.from({ length: 45 }, (_, i) => ({ kind: 'post' as const, author: { type: 'agent' as const, id: 'planner' }, text: `filler ${i}` })),
    ]);

    // gate 2: the review sends the work back and the developer runs again with what the reviewer left
    const before = engine.calls.length;
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    const calls = engine.calls.slice(before);
    const firstDev = calls.find((c) => c.agent.id === 'developer')!;
    // the person's answer is out of the window the stage was handed — and the stage reads it all the same: it came from the memory
    const messages = b.thread(run);
    const at = messages.findIndex((m) => m.text === 'Ship it behind a flag.');
    expect(messages.length - at).toBeGreaterThan(40);
    expect(firstDev.prompt).not.toContain('filler 0');
    expect(firstDev.prompt).toContain('Ship it behind a flag.');
    expect(memoryOf(run)).toContain('Ship it behind a flag.');
    expect(memoryOf(run)).toContain('The plan is settled.');
    // the review's send-back is in the memory as the handoff the developer was given
    expect(calls.filter((c) => c.agent.id === 'developer')).toHaveLength(2);
    expect(memoryOf(run)).toContain('The constant must be 2.');
    expect(memoryOf(run)).toMatch(/<!-- handoff:\d+ -->/);
  });

  it('lets the person correct it on the run screen: the next stage reads their version, recorded as theirs', async () => {
    const b = await boot();
    const { engine, runner } = b;
    engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
    engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Implemented.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    engine.script('reviewer', () => work('Approved.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'the thing works', result: 'pass', detail: 'seen working' }] }));

    let run = await runner.start('app#101');
    await b.settle();
    run = runner.get(run.id)!;
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    expect(run.status).toBe('gate');

    const written = await runner.editMemory(run.id, `# ${t('main.runner.memory.title')}\n\n## ${t('main.runner.memory.section.decisions')}\n\n- Ship it behind a flag.\n`);
    expect(written?.text).toContain('Ship it behind a flag.');
    expect(engine.calls.some((c) => c.agent.id === 'developer')).toBe(false);
    const edited = runner.get(run.id)!;
    expect(edited.history.at(-1)).toMatchObject({ type: 'memory-edited', by: 'person' });
    expect(git(run.worktree, 'log', '-1', '--format=%s')).toContain('update the cycle memory');

    // the next stage reads the person's version and it is still there when the run moves on
    runner.gate(run.id, 'approve');
    await b.settle();
    run = runner.get(run.id)!;
    const dev = engine.calls.find((c) => c.agent.id === 'developer')!;
    expect(dev.prompt).toContain('Ship it behind a flag.');
    expect(memoryOf(run)).toContain('Ship it behind a flag.');
  });

  it('hands the memory to the stage first and whole, and says so when it passed its cap', async () => {
    const b = await boot();
    const { engine, runner } = b;
    engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
    engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Implemented.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    engine.script('reviewer', () => work('Approved.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'the thing works', result: 'pass', detail: 'seen working' }] }));

    const run = await runner.start('app#101');
    await b.settle();
    // a memory past its cap, with a marker of its own: it is read whole, warned about, and placed before the other documents
    writeFileSync(join(run.worktree, run.cycleFolder, MEMORY_FILE), `# ${t('main.runner.memory.title')}\n\n## ${t('main.runner.memory.section.decisions')}\n\nMARKER-IN-THE-MEMORY\n${'x'.repeat(MEMORY_MAX)}\n`);
    const before = engine.calls.length;
    runner.gate(run.id, 'approve');
    await b.settle();
    const plan = engine.calls.slice(before).find((c) => c.agent.id === 'planner')!;
    expect(plan.prompt).toContain(t('prompt.sdd.runner.section.memoryOver', { max: MEMORY_MAX }));
    expect(plan.prompt).toContain('MARKER-IN-THE-MEMORY');
    expect(plan.prompt.indexOf('MARKER-IN-THE-MEMORY')).toBeLessThan(plan.prompt.indexOf('0_ISSUE.md'));
  });
});
