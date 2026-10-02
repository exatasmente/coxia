import { describe, expect, it } from 'vitest';
import { stageOf, stagesFor } from '../src/main/vcs/stages';
import type { VcsIssue, VcsMr } from '../src/main/vcs/types';
import { LEGACY_STAGES, legacyCycle } from '../src/shared/config/legacy';
import { builtInTemplate, cycleOf, isBlockedStage, isReadyForQa, isStageKind, resolveStage, returnedFromQa, stageDisplay, stageKind, stageOfText, stageText, stageUrgency } from '../src/shared/cycles';

const legacy = legacyCycle();
const cycle = (id: string) => cycleOf(builtInTemplate(id)!);

// What the dashboard, the watchers and the feedback job tested before the stages came from the config.
const ORIGINAL = {
  urgency: (stage: string | null) => (/Test Fail/i.test(stage ?? '') ? 2 : /Code Review OK|Ready To Test/i.test(stage ?? '') ? 3 : 4),
  forQa: (stage: string | null) => /Code Review OK|Test Fail|Ready To Test/i.test(stage ?? ''),
  failed: (stage: string | null) => stage === 'Test Fail',
};

const VOCABULARY = ['Test OK', 'Test Fail', 'STAGE:: Test Fail', 'Code Review OK', 'STAGE:: Code Review OK', 'Ready To Test', 'STAGE:: Ready To Test', 'Code Review', 'STAGE:: Code Review', 'Doing', 'STAGE:: Doing', 'Rejected', 'Backlog', 'Blocked-Infra', null, ''];

describe('the stages of the migrated profile behave as the regexes they replaced', () => {
  it.each(VOCABULARY.map((s) => [s]))('urgency of %j', (stage) => {
    expect(stageUrgency(legacy, stage)).toBe(ORIGINAL.urgency(stage));
  });

  it.each(VOCABULARY.map((s) => [s]))('ready for QA, for %j', (stage) => {
    expect(isReadyForQa(legacy, stage, true)).toBe(ORIGINAL.forQa(stage));
    // The legacy profile only hands over activities that have a spec.
    expect(isReadyForQa(legacy, stage, false)).toBe(false);
  });

  it.each(VOCABULARY.map((s) => [s]))('came back from QA, for %j', (stage) => {
    // The original compared the stage name exactly; a scoped label now counts too.
    expect(returnedFromQa(legacy, stage)).toBe(ORIGINAL.failed((stage ?? '').replace(/^STAGE::\s*/, '') || null));
  });

  it('keeps a rejection in code review apart from a failure in QA: both "returned", only one came back from QA', () => {
    expect(stageKind(legacy, 'Rejected')).toBe('returned');
    expect(returnedFromQa(legacy, 'Rejected')).toBe(false);
    expect(returnedFromQa(legacy, 'Failed testing')).toBe(true);
    expect(returnedFromQa(legacy, 'Rejected in code review')).toBe(false);
  });

  it('reads the statuses of the issue tracker the way the stage list always did', () => {
    expect(stageOfText(legacy, 'Approved in code review')?.id).toBe('review-ok');
    expect(stageOfText(legacy, 'Blocked in testing')?.id).toBe('in-testing');
    expect(stageOfText(legacy, 'Blocked in development')?.id).toBe('doing');
    expect(stageOfText(legacy, 'In development')?.id).toBe('doing');
    expect(LEGACY_STAGES.length).toBe(legacy.stages.length);
  });
});

describe('stage text', () => {
  it('drops the scope of a scoped label', () => {
    expect(stageText('STAGE:: Doing')).toBe('Doing');
    expect(stageText('status::in review')).toBe('in review');
    expect(stageText('Doing')).toBe('Doing');
    expect(stageText(null)).toBe('');
  });

  it('displays the stage, or the fallback when the card has none', () => {
    expect(stageDisplay('STAGE:: Ready To Test', 'no stage')).toBe('Ready To Test');
    expect(stageDisplay(null, 'no stage')).toBe('no stage');
    expect(stageDisplay('', 'sem estágio')).toBe('sem estágio');
  });
});

describe('mapping what a provider reports to a stage', () => {
  const sdd = cycle('sdd');

  it('maps GitLab scoped labels and work item statuses', () => {
    expect(resolveStage(sdd, { provider: 'gitlab', labels: ['bug', 'STAGE:: Code Review OK'] })?.id).toBe('review-ok');
    expect(resolveStage(sdd, { provider: 'gitlab', status: 'Failed testing' })?.id).toBe('test-failed');
    expect(resolveStage(sdd, { provider: 'gitlab', status: 'In development', labels: ['STAGE:: Doing'] })?.id).toBe('doing');
    expect(resolveStage(sdd, { provider: 'gitlab', status: 'Ready for testing' })?.id).toBe('in-testing');
  });

  it('maps a GitHub project field by its name, ignoring case, and falls back to labels and state', () => {
    expect(resolveStage(sdd, { provider: 'github', fields: { Status: 'In progress' } })?.id).toBe('doing');
    expect(resolveStage(sdd, { provider: 'github', fields: { status: 'In review' } })?.id).toBe('in-review');
    expect(resolveStage(sdd, { provider: 'github', fields: { Priority: 'In review' } })).toBeNull();
    expect(resolveStage(sdd, { provider: 'github', state: 'closed' })?.id).toBe('done');
  });

  it('maps Bitbucket issue states', () => {
    expect(resolveStage(sdd, { provider: 'bitbucket', state: 'on hold' })?.id).toBe('blocked');
    expect(resolveStage(sdd, { provider: 'bitbucket', state: 'resolved' })?.id).toBe('done');
    expect(resolveStage(sdd, { provider: 'bitbucket', state: 'new' })?.id).toBe('backlog');
  });

  it('applies a rule only to the provider it is for', () => {
    // "In progress" in a GitHub field means doing; the same words as a Bitbucket state mean nothing to the rules (the stage patterns decide).
    expect(resolveStage(cycle('scrum'), { provider: 'bitbucket', fields: { Status: 'Backlog' } })?.id).toBe('backlog');
    expect(resolveStage(cycle('github-flow'), { provider: 'gitlab', status: 'Rejected in code review' })?.id).toBe('changes-requested');
    expect(resolveStage(cycle('github-flow'), { provider: 'github', state: 'merged' })?.id).toBe('merged');
  });

  it('takes the first matching rule, and the later stage when only the patterns match several texts', () => {
    const c = cycle('kanban');
    expect(resolveStage(c, { column: 'Review' })?.id).toBe('review');
    expect(resolveStage(c, { labels: ['In Progress', 'Done'] })?.id).toBe('done');
  });

  it('falls back to the stage patterns on free text, and gives nothing for an unknown state', () => {
    expect(resolveStage(sdd, { text: 'STAGE:: Test OK' })?.id).toBe('test-ok');
    expect(resolveStage(sdd, { text: 'Waiting for the vendor' })).toBeNull();
    expect(resolveStage(sdd, {})).toBeNull();
  });

  it('does not break on a rule with a bad pattern or an unknown stage', () => {
    const broken = { ...sdd, stageMapping: [{ provider: 'any' as const, source: 'state' as const, name: '', pattern: '(', stage: 'doing' }, { provider: 'any' as const, source: 'state' as const, name: '', pattern: '.*', stage: 'ghost' }] };
    expect(resolveStage(broken, { state: 'whatever' })).toBeNull();
  });
});

describe('what each template does with a stage', () => {
  it('counts a stage of a blocked kind as blocked', () => {
    expect(isBlockedStage(cycle('scrum'), 'Blocked')).toBe(true);
    expect(isBlockedStage(cycle('scrum'), 'STAGE:: Impediment: vendor')).toBe(true);
    expect(isBlockedStage(cycle('scrum'), 'In Progress')).toBe(false);
    expect(isBlockedStage(legacy, 'Blocked-Infra')).toBe(false);
  });

  it('only SDD has a ready-for-QA stage; the others hand nothing to QA', () => {
    expect(isReadyForQa(cycle('sdd'), 'Ready To Test', true)).toBe(true);
    expect(isReadyForQa(cycle('sdd'), 'Code Review OK', true)).toBe(true);
    expect(isReadyForQa(cycle('sdd'), 'Code Review OK', false)).toBe(false);
    for (const id of ['scrum', 'kanban', 'github-flow', 'minimal']) expect(isReadyForQa(cycle(id), 'Testing', true), id).toBe(false);
  });

  it('knows a card in review approved or in QA is close to done, and one back from QA is urgent', () => {
    const sdd = cycle('sdd');
    expect(stageUrgency(sdd, 'Test Fail')).toBe(2);
    expect(stageUrgency(sdd, 'Rejected')).toBe(4);
    expect(stageUrgency(sdd, 'Code Review OK')).toBe(3);
    expect(stageUrgency(sdd, 'Doing')).toBe(4);
  });

  it('counts a returned stage as back from QA when the cycle has no QA stage', () => {
    expect(returnedFromQa(cycle('github-flow'), 'Changes requested')).toBe(true);
    expect(isStageKind(cycle('github-flow'), 'Approved', ['reviewApproved'])).toBe(true);
  });
});

// The cards the VCS providers build take their stage from the cycle: its mapping rules first, its stage patterns next, the host's defaults last.
describe('the stage of a card built from a provider', () => {
  const issue = (over: Partial<VcsIssue> = {}): VcsIssue => ({ project: 'g/p', iid: 1, title: 'T', state: 'open', status: null, labels: [], milestone: null, assignees: [], author: null, createdAt: null, updatedAt: null, closedAt: null, webUrl: '', ...over });
  const sdd = cycle('sdd');
  const of = (i: VcsIssue, host: 'gitlab' | 'github' | 'bitbucket', c = sdd) => stageOf(i, [], c.stages, c.stageMapping, host)?.id ?? null;

  it('applies the mapping rules of the cycle for the host of the card', () => {
    expect(of(issue({ labels: ['bug', 'STAGE:: Ready To Test'] }), 'gitlab')).toBe('in-testing');
    expect(of(issue({ status: 'Failed testing' }), 'gitlab')).toBe('test-failed');
    expect(of(issue({ state: 'closed' }), 'github')).toBe('done');
    expect(of(issue({ state: 'on hold' as never }), 'bitbucket')).toBe('blocked');
  });

  it('falls back to the stage patterns, then to what the merge requests say, then to the defaults of the host', () => {
    expect(of(issue({ labels: ['Code Review OK'] }), 'github')).toBe('review-ok');
    const kanban = cycle('kanban');
    // Nothing in the labels: the open merge request being reviewed makes it "review", which Kanban calls Review.
    const review = { state: 'open', draft: false, approvals: null } as unknown as VcsMr;
    expect(stageOf(issue(), [review], kanban.stages, kanban.stageMapping, 'github')?.id).toBe('review');
    // A workspace with no stages of its own gets the host's.
    expect(stageOf(issue({ labels: ['In Progress'] }), [], stagesFor('gitlab', []), [], 'gitlab')?.label).toBe('In development');
  });

  it('does not let a rule meant for one host decide for another', () => {
    const only = { ...sdd, stageMapping: [{ provider: 'github' as const, source: 'label' as const, name: '', pattern: '^urgent$', stage: 'blocked' }] };
    expect(of(issue({ labels: ['urgent'] }), 'github', only)).toBe('blocked');
    expect(of(issue({ labels: ['urgent'] }), 'gitlab', only)).not.toBe('blocked');
  });

  it('keeps the old behavior for a state: an open issue is not "backlog" just because it is open', () => {
    const open = issue({ state: 'open' });
    const review = { state: 'open', draft: false, approvals: null } as unknown as VcsMr;
    expect(stageOf(open, [review], sdd.stages, [], 'gitlab')?.id).toBe('in-review');
  });
});
