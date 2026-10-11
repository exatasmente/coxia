import { describe, expect, it } from 'vitest';
import { type Boot, boot, doc, fakeIssues, issue, work } from './helpers/runner';

// The runs screen lists the open issues of the project that carry the trigger label and have no assignee, with a manual start for each. The automatic scan
// must stay out of them: nothing starts by itself from that list, and a run starts only by the person's explicit `runs:start`. The fake host tells the two
// apart the way the real one does: `triggered` (what the scan reads) is only this person's own issues, and an unassigned issue of another author never gets there.

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
}

describe('the unassigned list of the runs screen', () => {
  it('returns only the open issues that carry the label and have no assignee', async () => {
    const issues = fakeIssues();
    issues.add(issue(1, { labels: ['coxia'] }));
    issues.add(issue(2, { labels: ['coxia'], assignees: ['ana'] }));
    issues.add(issue(3, { labels: ['other'] }));
    issues.add(issue(4, { labels: ['coxia'], state: 'closed' }));
    expect((await issues.unassigned('coxia')).map((i) => i.iid)).toEqual([1]);
  });

  it('keeps the label match and the open filter independent of the assignee filter', async () => {
    const issues = fakeIssues();
    issues.add(issue(1, { labels: ['COXIA'] }));
    issues.add(issue(2, { labels: ['coxia', 'other'], state: 'closed' }));
    const found = await issues.unassigned('coxia');
    expect(found.map((i) => i.iid)).toEqual([1]);
  });

  it('never lets the automatic scan start an issue that has no assignee, even when it is on the list', async () => {
    const issues = fakeIssues();
    // The label and no assignee, opened by someone else: it is the manual list's, never the scan's.
    issues.add(issue(50, { author: 'bob', labels: ['coxia'] }));
    const b = await boot({ issues });
    b.deps.updateConfig((c) => ({ ...c, runner: { ...c.runner, enabled: true } }));
    expect((await issues.unassigned('coxia')).map((i) => i.iid)).toEqual([50]);
    expect(await b.runner.scan()).toEqual([]);
    expect(b.runs.list()).toHaveLength(0);
  });

  it('starts a run for the issue only by hand, and refuses a second without the person saying so', async () => {
    const issues = fakeIssues();
    issues.add(issue(60, { author: 'bob', labels: ['coxia'] }));
    const b = await boot({ issues });
    easy(b);
    const run = await b.runner.start('app#60');
    expect(run.issue.ref).toBe('app#60');
    await expect(b.runner.start('app#60')).rejects.toMatchObject({ code: 'duplicate' });
    await b.settle();
    expect(b.runs.list()).toHaveLength(1);
  });
});
