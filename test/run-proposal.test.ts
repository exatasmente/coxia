import { describe, expect, it } from 'vitest';
import { labelsOf, proposalPurpose, proposalView } from '../src/shared/runs/proposal';
import { recordCommentProposal, recordCommentPublished, recordReview, type Finding } from '../src/shared/runs';
import type { ReleaseAction, VcsCommand } from '../src/shared/types';
import { at, drive, flowWithAutonomy } from './helpers/runs';

const gh = (method: VcsCommand['method'], endpoint: string, body?: unknown): VcsCommand => ({ vcs: 'github', via: 'api', method, endpoint, fields: {}, ...(body === undefined ? {} : { json: JSON.stringify(body) }) });
const gl = (method: VcsCommand['method'], endpoint: string, fields: Record<string, string>): VcsCommand => ({ vcs: 'gitlab', via: 'glab', method, endpoint, fields });

function action(over: Partial<ReleaseAction>): ReleaseAction {
  return { id: 'a1', key: 'k', kind: 'vcs', issue: 101, issueTitle: 'Add the thing', stage: '', release: null, mrs: [], files: [], retest: false, state: 'pending', createdAt: at(0), finishedAt: null, output: null, noteId: null, currentBody: null, proposedBody: null, sessionId: null, msgs: [], unit: null, summary: null, command: null, ...over };
}

const finding = (body: string, over: Partial<Finding> = {}): Finding => ({ path: 'src/a.ts', line: 12, endLine: null, side: 'new', severity: 'blocking', body, suggestion: null, ...over });

describe('a proposal of the runner, as Actions shows it', () => {
  it('is only an action the runner made: a purpose and a run in its unit, or the push of a run', () => {
    expect(proposalPurpose(action({ unit: { runId: 'r-1', purpose: 'comment', key: 'plan' } }))).toBe('comment');
    expect(proposalPurpose(action({ kind: 'run-push', unit: { runId: 'r-1', branch: 'b' } }))).toBe('push');
    expect(proposalPurpose(action({ unit: { purpose: 'comment' } }))).toBeNull();
    expect(proposalPurpose(action({ unit: { runId: 'r-1', purpose: 'unknown' } }))).toBeNull();
    expect(proposalPurpose(action({}))).toBeNull();
    expect(proposalView(action({}), null)).toBeNull();
  });

  it('shows the comment as the run wrote it, and says when it edits the one already on the tracker', () => {
    const d = drive(flowWithAutonomy({}));
    d.do((r) => recordCommentProposal(r, 'refine', { target: 'issue', bodyHash: 'h', title: 'Spec ready for gate 1', headline: 'Spec ready for gate 1', body: '## Spec ready\n\nWhat is asked.' }, at(5)));
    const a = action({ summary: 'Spec ready for gate 1', unit: { runId: d.run.id, purpose: 'comment', key: 'refine', edit: true }, command: gh('PATCH', 'repos/group/project/issues/comments/7', { body: 'old' }) });
    const v = proposalView(a, d.run);
    expect(v).toMatchObject({ purpose: 'comment', title: 'Spec ready for gate 1', body: '## Spec ready\n\nWhat is asked.', edit: true, target: 'issue' });
  });

  it('falls back to the body of the write when the run does not keep one (an older run)', () => {
    const d = drive(flowWithAutonomy({}));
    const a = action({ unit: { runId: d.run.id, purpose: 'comment', key: 'nothing' }, command: gh('POST', 'repos/group/project/issues/1/comments', { body: 'The text.' }) });
    expect(proposalView(a, d.run)?.body).toBe('The text.');
    expect(proposalView(a, null)?.body).toBe('The text.');
    const gitlab = action({ unit: { runId: d.run.id, purpose: 'comment', key: 'nothing' }, command: gl('POST', 'projects/1/issues/1/notes', { body: 'GitLab text.' }) });
    expect(proposalView(gitlab, null)?.body).toBe('GitLab text.');
  });

  it('shows a review with its verdict and each finding, and what happens to its thread', () => {
    const d = drive(flowWithAutonomy({}));
    d.do((r) => recordReview(r, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: '', findings: [finding('The constant must be 2, not 1.'), finding('Missing test.', { path: 'src/b.ts', line: null, severity: 'suggestion' })], head: null }, at(3)));
    d.do((r) => recordReview(r, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: '', findings: [finding('The constant has to be 2 and not 1.', { line: 30, endLine: 33, suggestion: 'const x = 2;' })], head: null }, at(4)));
    d.do((r) => recordCommentProposal(r, 'review-2', { target: 'mr', bodyHash: 'h', body: '## Review: changes requested (round 2)' }, at(5)));
    const a = action({ summary: 'Review round 2', unit: { runId: d.run.id, purpose: 'review', key: 'review-2', round: 2 }, commands: [gh('POST', 'repos/group/project/pulls/3/reviews', { event: 'REQUEST_CHANGES', body: 'x', comments: [] })], command: null });
    const v = proposalView(a, d.run);
    expect(v?.body).toBe('## Review: changes requested (round 2)');
    expect(v?.review).toMatchObject({ round: 2, verdict: 'changes' });
    expect(v?.review?.lines).toEqual([{ where: 'src/a.ts:30-33', severity: 'blocking', body: 'The constant has to be 2 and not 1.', suggestion: 'const x = 2;', thread: 'open' }]);
    const first = proposalView({ ...a, unit: { ...a.unit, round: 1, key: 'review-1' } }, d.run);
    expect(first?.review?.lines.map((l) => [l.where, l.severity, l.thread])).toEqual([['src/a.ts:12', 'blocking', 'still'], ['src/b.ts', 'suggestion', 'fixed']]);
  });

  it('says a review that only comments does not ask for changes (the person\'s own pull request, or only suggestions)', () => {
    const d = drive(flowWithAutonomy({}));
    const a = action({ unit: { runId: d.run.id, purpose: 'review', key: 'review-1', round: 1 }, commands: [gh('POST', 'repos/group/project/pulls/3/reviews', { event: 'COMMENT', body: 'x', comments: [] })] });
    expect(proposalView(a, d.run)?.review?.verdict).toBe('comment');
  });

  it('shows the pull request with its title and description, and the push with its branch', () => {
    const d = drive(flowWithAutonomy({}));
    d.do((r) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: 3, url: null, bodyHash: 'h', title: 'Add the thing', body: 'Closes #101.' }, at(6)));
    const pr = proposalView(action({ summary: 'Add the thing', unit: { runId: d.run.id, purpose: 'run-pr' }, command: gh('POST', 'repos/group/project/pulls', { title: 'Add the thing', body: 'Closes #101.', head: 'b', base: 'main' }) }), d.run);
    expect(pr).toMatchObject({ purpose: 'run-pr', title: 'Add the thing', body: 'Closes #101.', target: 'mr' });
    const push = proposalView(action({ kind: 'run-push', summary: 'Push', unit: { runId: d.run.id, branch: 'coxia/101-add-the-thing' } }), d.run);
    expect(push).toMatchObject({ purpose: 'push', branch: 'coxia/101-add-the-thing', body: null });
  });

  it('shows what a delete takes back: the comment and where it is, as an edit of what is on the tracker', () => {
    const d = drive(flowWithAutonomy({}));
    d.do((r) => recordCommentPublished(r, 'plan', { target: 'issue', noteId: 9, url: 'https://example.com/n/9', bodyHash: 'h', title: 'Plan approved', body: '## Plan approved' }, at(6)));
    const v = proposalView(action({ summary: 'Delete', unit: { runId: d.run.id, purpose: 'undo', key: 'plan' }, command: gh('DELETE', 'repos/group/project/issues/comments/9') }), d.run);
    expect(v).toMatchObject({ purpose: 'undo', title: 'Plan approved', body: '## Plan approved', edit: true, url: 'https://example.com/n/9' });
  });

  it('reads the labels a write adds and removes on each host', () => {
    expect(labelsOf([gh('POST', 'repos/g/p/issues/1/labels', { labels: ['P1'] }), gh('DELETE', 'repos/g/p/issues/1/labels/P%202')])).toEqual({ add: ['P1'], remove: ['P 2'] });
    expect(labelsOf([gl('PUT', 'projects/1/issues/1', { add_labels: 'priority::1,squad-a', remove_labels: 'priority::2' })])).toEqual({ add: ['priority::1', 'squad-a'], remove: ['priority::2'] });
    expect(labelsOf([])).toEqual({ add: [], remove: [] });
    const d = drive(flowWithAutonomy({}));
    const v = proposalView(action({ unit: { runId: d.run.id, purpose: 'priority', key: 'priority' }, command: gh('POST', 'repos/g/p/issues/1/labels', { labels: ['P1'] }) }), d.run);
    expect(v?.labels).toEqual({ add: ['P1'], remove: [] });
  });

  it('shows the issue another squad is asked for, and how far a group of writes got when it stopped half way', () => {
    const d = drive(flowWithAutonomy({}));
    const issue = proposalView(action({ unit: { runId: d.run.id, purpose: 'request-issue', key: 'k' }, command: gh('POST', 'repos/g/p/issues', { title: 'Expose the endpoint', body: 'We need it.', labels: ['squad-b'] }) }), d.run);
    expect(issue).toMatchObject({ purpose: 'request-issue', title: 'Expose the endpoint', body: 'We need it.' });
    const group = proposalView(action({ unit: { runId: d.run.id, purpose: 'review', key: 'review-1', round: 1 }, commands: [gh('POST', 'a'), gh('POST', 'b'), gh('POST', 'c')], done: 2 }), d.run);
    expect(group?.progress).toEqual({ done: 2, total: 3 });
    expect(proposalView(action({ unit: { runId: d.run.id, purpose: 'review', key: 'review-1', round: 1 }, commands: [gh('POST', 'a')], done: 0 }), d.run)?.progress).toBeNull();
  });
});
