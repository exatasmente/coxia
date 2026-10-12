// QA: the boundary of the conversation commit. When a stage that writes calls a called agent with `permission: worktree` after changing a file of its own, the
// conversation's commit at its close uses the same `git add -A` the runner uses for a stage, so any work the calling stage already left in the worktree is swept
// into the conversation's commit. This pins what the review observed: the commit is not scoped to what the called agent changed.
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { ATAS, DATA_ROOT, WORKSPACE_ID } from '../src/main/env';
import { installLegacyConfig } from './helpers/config';
import { writeRegistry } from '../src/main/workspaces-core';
import { type Boot, boot, doc, fakeSandbox, work } from './helpers/runner';
import { git } from './helpers/conflictRepos';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await installLegacyConfig();
  setLanguage('en');
});
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
});

/** Approves gates until the run is waiting at the stage `id`. Expects the run object of `start`. */
async function until(b: Boot, run: { id: string }, id: string) {
  for (let i = 0; i < 10; i++) {
    await b.settle();
    const now = b.runner.get(run.id)!;
    if (!now || now.stage === id || now.status !== 'gate') return now;
    b.runner.gate(run.id, 'approve');
  }
  return b.runner.get(run.id)!;
}

describe('the boundary of a conversation commit (QA)', () => {
  it('sweeps the calling stage pending work into the conversation commit', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({
      sandbox,
      configure: (c) => {
        const qa = c.agents.team.find((a) => a.id === 'qa')!;
        qa.permission = 'worktree';
        qa.shell = 'sandbox';
      },
    });
    // The earlier read-only stages finish by writing their document; the run reaches the implement stage.
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
    // The developer writes its own file, then calls the QA (which writes another file); both land before the stage's own commit.
    b.engine.script('developer', async (call, tools) => {
      await tools.write('src/caller.ts', 'export const caller = 1;\n');
      const open = call.runnerTools?.find((x) => x.name === 'CallAgent');
      if (!open) throw new Error('no CallAgent tool');
      await open.run({ to: 'qa', topic: 'Change the fixture?', place: 'run' }, {} as never);
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    b.engine.script('qa', async (_call, tools) => {
      await tools.write('src/called.ts', 'export const called = 1;\n');
      return { texto: 'changed it' };
    });
    const run = await b.runner.start('app#101');
    await until(b, run, 'implement');
    await b.settle();
    const after = b.runner.get(run.id)!;
    // The implement stage ran (it moved on or finished).
    expect(after.stage).toBeDefined();
    // The branch's commits: the conversation's commit runs before the stage's own, so the first commit that touches the code (excluding docs) carries both the
    // called agent's file and the calling stage's own file (the `git add -A` was not scoped to what the conversation changed).
    const worktree = run.worktree;
    const log = git(worktree, 'log', '--pretty=format:%H %s', '--', '.', ':(exclude)docs').split('\n');
    const firstCodeCommit = log[0]?.split(' ')[0];
    expect(firstCodeCommit).toBeTruthy();
    const callerInFirst = git(worktree, 'show', `${firstCodeCommit}:src/caller.ts`);
    const calledInFirst = git(worktree, 'show', `${firstCodeCommit}:src/called.ts`);
    // The conversation's commit carried the calling stage's own file as well as the called agent's.
    expect(callerInFirst).toContain('caller');
    expect(calledInFirst).toContain('called');
    expect(readFileSync(join(worktree, 'src/caller.ts'), 'utf8')).toContain('caller');
    expect(readFileSync(join(worktree, 'src/called.ts'), 'utf8')).toContain('called');
  });
});
