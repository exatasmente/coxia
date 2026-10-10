import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { VcsError } from '../src/main/vcs/errors';
import { GITHUB_MUTATION, checkState, validateGitHubCommand } from '../src/main/vcs/github';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { CliRun } from '../src/main/vcs/transport';
import type { VcsCommand, VcsWriteOp } from '../src/main/vcs/types';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';

const TOKEN = 'TESTTOKEN-github-not-real-0001';
const F = fixture<Record<string, any>>('github');
const API = '/api/v3';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

const settings = (over: Partial<VcsSettings> = {}): VcsSettings => ({ id: 'gh', kind: 'github', host: 'ghe.test', apiUrl: '', user: '', secretRef: 'gh.token', cli: 'gh', preference: 'api', repos: [], ...over });

async function api(routes: Parameters<typeof startFakeHost>[0] = {}): Promise<VcsRuntime> {
  host = await startFakeHost({
    [`GET ${API}/user`]: { json: F.user },
    ...routes,
  });
  return buildRuntime(settings({ apiUrl: `${host.url}${API}` }), { token: () => TOKEN, env: () => ({}), sleep: noSleep });
}

const pullRoutes = {
  [`GET ${API}/search/issues`]: (h: { query: URLSearchParams }) => ({ json: h.query.get('q')?.includes('review-requested:') ? F.search_prs_reviewer : F.search_prs_author }),
  [`GET ${API}/repos/acme/app/pulls/7`]: { json: F.pull_7 },
  [`GET ${API}/repos/acme/uploader/pulls/9`]: { json: F.pull_9 },
  [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/check-runs`]: { json: F.check_runs_failed },
  [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/status`]: { json: F.combined_empty },
  [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/check-runs`]: { json: F.check_runs_running },
  [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/status`]: { json: F.combined_empty },
  [`GET ${API}/repos/acme/app/pulls/7/reviews`]: { json: F.reviews },
  [`GET ${API}/repos/acme/uploader/pulls/9/reviews`]: { json: [] },
};

describe('reads over the API transport', () => {
  it('authenticates with a bearer token and the API version header', async () => {
    const rt = await api();
    expect(await rt.provider.currentUser()).toMatchObject({ id: 1001, username: 'ana-dev', name: 'Ana Dev' });
    const h = host?.hits[0].headers;
    expect(h?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h?.['x-github-api-version']).toBe('2022-11-28');
    expect(h?.accept).toBe('application/vnd.github+json');
  });

  it('lists the issues assigned to me and leaves the pull requests out', async () => {
    const rt = await api({ [`GET ${API}/issues`]: { json: F.issues_assigned } });
    const issues = await rt.provider.listMyIssues();
    expect(host?.log()[0]).toBe(`GET ${API}/issues?filter=assigned&state=open&sort=updated&per_page=100&page=1`);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ project: 'acme/app', iid: 12, labels: ['bug', 'in progress'], milestone: 'v1.2', status: null, state: 'open', assignees: ['ana-dev'] });
  });

  it('lists the issues of one repository assigned to me', async () => {
    const rt = await api({ [`GET ${API}/repos/acme/app/issues`]: { json: F.issues_assigned } });
    const issues = await rt.provider.listMyIssues({ project: 'acme/app' });
    expect(host?.log()[1]).toContain('assignee=ana-dev&state=open');
    expect(issues.map((i) => i.iid)).toEqual([12]);
  });

  it('reads an issue and its comments, newest first', async () => {
    const rt = await api({ [`GET ${API}/repos/acme/app/issues/12`]: { json: F.issue_12 }, [`GET ${API}/repos/acme/app/issues/12/comments`]: { json: F.issue_comments } });
    expect((await rt.provider.getIssue('acme/app', 12)).title).toBe('Export fails with accents');
    expect((await rt.provider.getIssue('acme/app', 12)).body).toBe('Accented names break the export.');
    expect((await rt.provider.listIssueComments('acme/app', 12)).map((c) => [c.id, c.author])).toEqual([[5002, 'bob-qa'], [5001, 'ana-dev']]);
    expect(await rt.provider.issueStatuses('acme/app', [12])).toEqual(new Map());
  });

  it('lists my PRs as author and reviewer, with CI, approvals and the conflict flag from the detail reads', async () => {
    const rt = await api(pullRoutes);
    const mrs = await rt.provider.listMyMrs({ detail: true });
    expect(mrs.map((m) => [m.project, m.iid, m.roles, m.draft, m.ci?.status, m.hasConflicts, m.sourceBranch])).toEqual([
      ['acme/app', 7, ['author'], true, 'failed', true, 'release/bugfix/12'],
      ['acme/uploader', 9, ['reviewer'], false, 'running', false, 'feature/retry'],
    ]);
    // CHANGES_REQUESTED followed by APPROVED by the same person is an approval; a bare comment counts for nothing
    // the recorded review carries no commit and no association: it is an approval, but not one a merge may rely on
    expect(mrs[0].approvals).toEqual({ approved: true, by: ['carol-dev'], changesRequestedBy: [], onHead: false });
    expect(mrs[0].reviewers.map((r) => r.username)).toEqual(['carol-dev']);
    expect(mrs[0].issueRefs).toEqual([12]);
    expect(host?.hits.find((h) => h.path.endsWith('/search/issues'))?.query.get('q')).toBe('is:pr is:open author:ana-dev');
  });

  it('reads one PR with the divergence from the compare endpoint', async () => {
    const rt = await api({ ...pullRoutes, [`GET ${API}/repos/acme/app/compare/main...aaaa1111bbbb2222cccc3333dddd4444eeee5555`]: { json: F.compare } });
    const mr = await rt.provider.getMr('acme/app', 7, { behind: true, approvals: true });
    expect(mr.behind).toBe(4);
    expect(mr.state).toBe('open');
  });

  it('does not say an approval is on the head when there are more reviews than it read: what it did not see is not known', async () => {
    const sha = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
    const review = (n: number) => ({ user: { login: `reviewer-${n}` }, state: 'COMMENTED', submitted_at: '2026-10-03T12:00:00Z', commit_id: sha, author_association: 'MEMBER' });
    const approved = { user: { login: 'ana' }, state: 'APPROVED', submitted_at: '2026-10-03T12:01:00Z', commit_id: sha, author_association: 'MEMBER' };
    const read = async (rows: unknown[]) => {
      const rt = await api({
        ...pullRoutes,
        [`GET ${API}/repos/acme/app/pulls/7/reviews`]: { json: rows },
      });
      return (await rt.provider.getMr('acme/app', 7, { approvals: true })).approvals;
    };
    const page = Array.from({ length: 100 }, (_, i) => review(i));
    // a few reviews: read in full
    expect(await read([approved])).toMatchObject({ approved: true, onHead: true });
    // the host answers the same full page for every page asked: three full pages are read, the fourth is never seen
    expect(await read([approved, ...page.slice(1)])).toMatchObject({ approved: true, onHead: false });
  });

  it('reads review threads with the resolved state through GraphQL', async () => {
    const rt = await api({ 'POST /api/graphql': { json: F.threads_graphql } });
    const threads = await rt.provider.listMrThreads('acme/app', 7);
    expect(threads.map((t) => [t.id, t.resolved, t.path, t.line, t.notes.length])).toEqual([
      ['PRRT_kwDOAbCdEf5Abc1', false, 'src/export.ts', 12, 2],
      ['PRRT_kwDOAbCdEf5Abc2', true, 'src/a.ts', 3, 1],
    ]);
    const gql = JSON.parse(host?.hits.find((h) => h.path === '/api/graphql')?.body ?? '{}').query as string;
    expect(gql).toMatch(/^query \{ repository\(owner: "acme", name: "app"\) \{ pullRequest\(number: 7\)/);
    expect(host?.hits.find((h) => h.path === '/api/graphql')?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect((await rt.provider.getMrThread('acme/app', 7, 'PRRT_kwDOAbCdEf5Abc1')).notes[0].author).toBe('carol-dev');
    await expect(rt.provider.getMrThread('acme/app', 7, 'PRRT_nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reads the MRs that reference an issue from its timeline, only in the same repository', async () => {
    const rt = await api({ ...pullRoutes, [`GET ${API}/repos/acme/app/issues/12/timeline`]: { json: F.timeline } });
    const mrs = await rt.provider.linkedMrs('acme/app', 12);
    expect(mrs.map((m) => [m.project, m.iid, m.issueRefs])).toEqual([['acme/app', 7, [12]]]);
  });

  it('merges issue comments and review comments of a PR', async () => {
    const rt = await api({ [`GET ${API}/repos/acme/app/issues/7/comments`]: { json: F.issue_comments }, [`GET ${API}/repos/acme/app/pulls/7/comments`]: { json: F.review_comments } });
    expect((await rt.provider.listMrComments('acme/app', 7)).map((c) => c.id)).toEqual([7001, 5002, 5001]);
  });

  it('reads files with patches, commits, runs and jobs', async () => {
    const rt = await api({
      ...pullRoutes,
      [`GET ${API}/repos/acme/app/pulls/7/files`]: { json: F.pull_files },
      [`GET ${API}/repos/acme/app/pulls/7/commits`]: { json: F.pull_commits },
      [`GET ${API}/repos/acme/app/actions/runs`]: { json: F.runs },
      [`GET ${API}/repos/acme/app/actions/runs/31/jobs`]: { json: F.run_jobs },
    });
    expect(await rt.provider.listMrChanges('acme/app', 7)).toEqual([{ path: 'src/export.ts', diff: '@@ -10,3 +10,4 @@\n a\n+b\n c\n' }, { path: 'assets/logo.png', diff: '' }]);
    expect(await rt.provider.listMrCommits('acme/app', 7)).toEqual([{ sha: 'cccc3333dddd4444', date: '2026-10-01T09:30:00Z' }]);
    expect((await rt.provider.listMrCi('acme/app', 7)).map((r) => [r.id, r.status])).toEqual([[31, 'failure'], [30, 'in_progress']]);
    expect((await rt.provider.listCiJobs('acme/app', 31)).map((j) => [j.name, j.status, j.stage])).toEqual([['build', 'success', 'CI'], ['e2e', 'failure', 'CI']]);
  });

  it('reads the repository, a branch, and the reviewer candidates with push access', async () => {
    const rt = await api({
      [`GET ${API}/repos/acme/app`]: { json: F.repo },
      [`GET ${API}/repos/acme/app/branches/main`]: { json: F.branch_main },
      [`GET ${API}/repos/acme/app/collaborators`]: { json: F.collaborators },
    });
    expect((await rt.provider.getRepo('acme/app')).defaultBranch).toBe('main');
    expect(await rt.provider.getBranchSha('acme/app', 'main')).toBe('9999aaaa8888bbbb7777cccc6666dddd5555eeee');
    expect((await rt.provider.listReviewerCandidates('acme/app')).map((p) => p.username)).toEqual(['carol-dev']);
  });

  it('checks that a reviewer has write access, resolving the numeric id to a login', async () => {
    const rt = await api({
      [`GET ${API}/user/1002`]: { json: F.collaborators[1] },
      [`GET ${API}/repos/acme/app/collaborators/carol-dev/permission`]: { json: { permission: 'write' } },
      [`GET ${API}/user/1004`]: { json: F.collaborators[3] },
      [`GET ${API}/repos/acme/app/collaborators/reader/permission`]: { json: { permission: 'read' } },
    });
    expect((await rt.provider.getReviewer('acme/app', 1002)).username).toBe('carol-dev');
    await expect(rt.provider.getReviewer('acme/app', 1004)).rejects.toThrow(/reader não tem acesso de revisão/);
  });

  it('refuses a repository that is not owner/name', async () => {
    const rt = await api();
    for (const bad of ['acme', 'a/b/c', '../x', 'a/..', 'a b/c']) await expect(rt.provider.getRepo(bad), bad).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('builds the web links', async () => {
    const rt = await api();
    expect(rt.provider.issueUrl('acme/app', 12)).toBe('https://ghe.test/acme/app/issues/12');
    expect(rt.provider.mrUrl('acme/app', 7)).toBe('https://ghe.test/acme/app/pull/7');
    expect(rt.provider.noteUrl('acme/app', 'issue', 12, 5002)).toBe('https://ghe.test/acme/app/issues/12#issuecomment-5002');
  });

  it('turns check runs and statuses into one CI state, worst first', () => {
    expect(checkState('completed', 'success')).toBe('success');
    expect(checkState('completed', 'neutral')).toBe('success');
    expect(checkState('completed', 'failure')).toBe('failed');
    expect(checkState('completed', 'timed_out')).toBe('failed');
    expect(checkState('completed', 'cancelled')).toBe('canceled');
    expect(checkState('completed', 'action_required')).toBe('manual');
    expect(checkState('in_progress', null)).toBe('running');
    expect(checkState('queued', null)).toBe('pending');
  });
});

describe('reads over the gh transport', () => {
  it('calls `gh api <endpoint>` with GH_HOST for an Enterprise host', async () => {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const run: CliRun = async (_f, args, o) => {
      calls.push({ args, env: o.env });
      return JSON.stringify(args[1] === 'user' ? F.user : []);
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'unused', env: () => ({ PATH: '/bin' }), run });
    await rt.provider.currentUser();
    await rt.provider.listMyIssues({ project: 'acme/app' });
    expect(calls[0]).toMatchObject({ args: ['api', 'user'] });
    expect(calls[0].env.GH_HOST).toBe('ghe.test');
    expect(calls[1].args).toEqual(['api', 'repos/acme/app/issues?assignee=ana-dev&state=open&sort=updated&per_page=100&page=1']);
    const dotcom = buildRuntime(settings({ preference: 'cli', host: 'github.com' }), { token: () => 'x', env: () => ({}), run });
    await dotcom.provider.currentUser();
    expect(calls.at(-1)?.env.GH_HOST).toBeUndefined();
  });
});

describe('planWrite', () => {
  const plan = async (op: VcsWriteOp, routes: Parameters<typeof startFakeHost>[0] = {}) => (await api(routes)).provider.planWrite(op);
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'github', via: 'api', method: 'POST', endpoint: '', fields: {}, ...over });

  it('comments on an issue or a PR through the issues API', async () => {
    expect(await plan({ op: 'commentIssue', project: 'acme/app', iid: 12, body: 'hi' })).toEqual([cmd({ endpoint: 'repos/acme/app/issues/12/comments', json: '{"body":"hi"}' })]);
    expect(await plan({ op: 'commentMr', project: 'acme/app', iid: 7, body: 'hi' })).toEqual([cmd({ endpoint: 'repos/acme/app/issues/7/comments', json: '{"body":"hi"}' })]);
    expect(await plan({ op: 'editIssueNote', project: 'acme/app', iid: 12, noteId: 5002, body: 'x' })).toEqual([cmd({ method: 'PATCH', endpoint: 'repos/acme/app/issues/comments/5002', json: '{"body":"x"}' })]);
  });

  it('deletes a comment: a conversation comment of an issue or a pull request, and a comment of a review on a line or a file', async () => {
    const del = (endpoint: string) => cmd({ method: 'DELETE', endpoint });
    expect(await plan({ op: 'deleteNote', project: 'acme/app', iid: 12, noteId: 5002, target: 'issue' })).toEqual([del('repos/acme/app/issues/comments/5002')]);
    // a pull request's conversation comments are issue comments on GitHub
    expect(await plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: 5002, target: 'mr' })).toEqual([del('repos/acme/app/issues/comments/5002')]);
    expect(await plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: 7001, target: 'review' })).toEqual([del('repos/acme/app/pulls/comments/7001')]);
    for (const c of await plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: 7001, target: 'review' })) expect(() => validateGitHubCommand(c)).not.toThrow();
    await expect(plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: '7001/../..', target: 'review' })).rejects.toThrow();
  });

  it('replies to a thread on its first comment, reading the thread first', async () => {
    const out = await plan({ op: 'replyThread', project: 'acme/app', iid: 7, threadId: 'PRRT_kwDOAbCdEf5Abc1', body: 'done' }, { 'POST /api/graphql': { json: F.threads_graphql } });
    expect(out).toEqual([cmd({ endpoint: 'repos/acme/app/pulls/7/comments/7001/replies', json: '{"body":"done"}' })]);
  });

  it('resolves a thread and toggles draft with the three GraphQL mutations', async () => {
    const [resolve] = await plan({ op: 'resolveThread', project: 'acme/app', iid: 7, threadId: 'PRRT_kwDOAbCdEf5Abc1' });
    expect(resolve).toEqual(cmd({ endpoint: 'graphql', fields: { query: 'mutation { resolveReviewThread(input: { threadId: "PRRT_kwDOAbCdEf5Abc1" }) { thread { isResolved } } }' } }));
    const [ready] = await plan({ op: 'setDraft', project: 'acme/app', iid: 7, draft: false }, { [`GET ${API}/repos/acme/app/pulls/7`]: { json: F.pull_7 } });
    expect(ready.fields.query).toBe('mutation { markPullRequestReadyForReview(input: { pullRequestId: "PR_kwDOAbCdEf4Abcd" }) { pullRequest { isDraft } } }');
    const [back] = await plan({ op: 'setDraft', project: 'acme/app', iid: 7, draft: true }, { [`GET ${API}/repos/acme/app/pulls/7`]: { json: F.pull_7 } });
    expect(back.fields.query).toContain('convertPullRequestToDraft');
    for (const c of [resolve, ready, back]) expect(() => validateGitHubCommand(c)).not.toThrow();
  });

  it('adds labels in one call and removes each one by its own call', async () => {
    const out = await plan({ op: 'setIssueLabels', project: 'acme/app', iid: 12, add: ['ready for qa'], remove: ['in progress', 'needs/review'] });
    expect(out).toEqual([
      cmd({ endpoint: 'repos/acme/app/issues/12/labels', json: '{"labels":["ready for qa"]}' }),
      cmd({ method: 'DELETE', endpoint: 'repos/acme/app/issues/12/labels/in%20progress' }),
      cmd({ method: 'DELETE', endpoint: 'repos/acme/app/issues/12/labels/needs%2Freview' }),
    ]);
    for (const c of out) expect(() => validateGitHubCommand(c)).not.toThrow();
  });

  it('requests a reviewer by login, and opens or closes an issue', async () => {
    expect(await plan({ op: 'addReviewer', project: 'acme/app', iid: 7, userId: 1002, username: 'carol-dev' })).toEqual([cmd({ endpoint: 'repos/acme/app/pulls/7/requested_reviewers', json: '{"reviewers":["carol-dev"]}' })]);
    expect(await plan({ op: 'setIssueStatus', project: 'acme/app', iid: 12, status: 'closed' })).toEqual([cmd({ method: 'PATCH', endpoint: 'repos/acme/app/issues/12', json: '{"state":"closed"}' })]);
    await expect(plan({ op: 'setIssueStatus', project: 'acme/app', iid: 12, status: 'In QA' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(plan({ op: 'playJob', project: 'acme/app', jobId: 1 })).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('plans the upload of a piece of evidence: a file on GitHub\'s uploads host, with its own type', async () => {
    // Only github.com has the uploads host the command names; an Enterprise host plans nothing (see vcs-github-upload.test.ts).
    const dotcom = buildRuntime(settings({ host: 'github.com' }), { token: () => TOKEN, env: () => ({}), sleep: noSleep });
    const out = await dotcom.provider.planWrite({ op: 'uploadAttachment', project: 'acme/app', path: '/tmp/ev-1.png', name: 'ev-1.png', media: 'image/png' });
    expect(out).toEqual([{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'uploads.github.com/?repository_id=acme%2Fapp&name=ev-1.png&content_type=image%2Fpng', fields: {}, headers: { 'Content-Type': 'image/png', 'User-Agent': 'Coxia' }, bodyFile: '/tmp/ev-1.png' }]);
    for (const c of out) expect(() => validateGitHubCommand(c)).not.toThrow();
  });

  it('refuses a thread id that is not a node id', async () => {
    await expect(plan({ op: 'resolveThread', project: 'acme/app', iid: 7, threadId: 'x"}){y' })).rejects.toBeInstanceOf(VcsError);
  });
});

describe('validateCommand: what a GitHub write may look like', () => {
  const ok = (c: Partial<VcsCommand>): VcsCommand => ({ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/1/comments', fields: {}, json: '{"body":"x"}', ...c });
  const MUT = 'mutation { resolveReviewThread(input: { threadId: "PRRT_kwDOAbCdEf5Abc1" }) { thread { isResolved } } }';

  it('accepts the listed calls', () => {
    for (const c of [
      ok({}),
      ok({ via: 'gh' }),
      ok({ endpoint: 'repos/acme/app/pulls/7/comments/7001/replies' }),
      ok({ endpoint: 'repos/acme/app/pulls/7/requested_reviewers', json: '{"reviewers":["a"]}' }),
      ok({ endpoint: 'repos/acme/app/issues/1/labels', json: '{"labels":["a","b"]}' }),
      ok({ method: 'DELETE', endpoint: 'repos/acme/app/issues/1/labels/a%20b', json: undefined }),
      ok({ method: 'DELETE', endpoint: 'repos/acme/app/issues/comments/9', json: undefined }),
      ok({ method: 'DELETE', endpoint: 'repos/acme/app/pulls/comments/9', json: undefined }),
      ok({ method: 'PATCH', endpoint: 'repos/acme/app/issues/comments/9' }),
      ok({ method: 'PATCH', endpoint: 'repos/acme/app/issues/1', json: '{"state":"open"}' }),
      ok({ endpoint: 'graphql', json: undefined, fields: { query: MUT } }),
    ]) expect(() => validateGitHubCommand(c)).not.toThrow();
  });

  const refused: [string, Partial<VcsCommand>][] = [
    ['a read endpoint', { method: 'POST', endpoint: 'user' }],
    ['another method on a write endpoint', { method: 'PUT' }],
    ['deleting an issue', { method: 'DELETE', endpoint: 'repos/acme/app/issues/9', json: undefined }],
    ['deleting a pull request review', { method: 'DELETE', endpoint: 'repos/acme/app/pulls/7/reviews/9', json: undefined }],
    ['deleting a comment with a body', { method: 'DELETE', endpoint: 'repos/acme/app/issues/comments/9', json: '{"body":"x"}' }],
    ['deleting a repository', { method: 'DELETE', endpoint: 'repos/acme/app', json: undefined }],
    ['merging a PR', { method: 'PUT', endpoint: 'repos/acme/app/pulls/7/merge', json: '{}' }],
    ['closing a PR through pulls', { method: 'PATCH', endpoint: 'repos/acme/app/pulls/7', json: '{"state":"closed"}' }],
    ['a body key that is not allowed', { json: '{"body":"x","assignees":["a"]}' }],
    ['a missing body key', { json: '{}' }],
    ['a state that is not open or closed', { method: 'PATCH', endpoint: 'repos/acme/app/issues/1', json: '{"state":"locked"}' }],
    ['labels that are not strings', { endpoint: 'repos/acme/app/issues/1/labels', json: '{"labels":[1]}' }],
    ['a body that is not JSON', { json: 'body=x' }],
    ['a body that is an array', { json: '[1]' }],
    ['form fields next to the body', { fields: { body: 'x' } }],
    ['path traversal', { endpoint: 'repos/acme/app/issues/1/../../../../user/comments' }],
    ['an encoded traversal', { endpoint: 'repos/acme/app/issues/1%2e%2e/comments' }],
    ['an absolute URL', { endpoint: 'https://evil.test/repos/acme/app/issues/1/comments' }],
    ['the glab transport', { via: 'glab' }],
    ['the curl transport', { via: 'curl' }],
    ['a repository with a third segment', { endpoint: 'repos/acme/app/extra/issues/1/comments' }],
    ['a non numeric issue', { endpoint: 'repos/acme/app/issues/x/comments' }],
    ['a different graphql mutation', { endpoint: 'graphql', json: undefined, fields: { query: MUT.replace('resolveReviewThread', 'deleteIssue') } }],
    ['graphql with a second operation', { endpoint: 'graphql', json: undefined, fields: { query: `${MUT} mutation { x }` } }],
    ['graphql with variables', { endpoint: 'graphql', json: undefined, fields: { query: MUT, variables: '{}' } }],
    ['graphql by PUT', { endpoint: 'graphql', method: 'PUT', json: undefined, fields: { query: MUT } }],
    ['graphql with an injected id', { endpoint: 'graphql', json: undefined, fields: { query: MUT.replace('PRRT_kwDOAbCdEf5Abc1', 'x" }) { a } } mutation { b(input: { id: "y') } }],
  ];
  it.each(refused)('refuses %s', (_name, over) => {
    expect(() => validateGitHubCommand(ok(over))).toThrow();
  });

  it('the mutation regex is anchored', () => {
    expect(GITHUB_MUTATION.test(MUT)).toBe(true);
    expect(GITHUB_MUTATION.test(`query { a } ${MUT}`)).toBe(false);
    expect(GITHUB_MUTATION.test(`${MUT}\nmutation { b }`)).toBe(false);
  });
});

describe('the executor', () => {
  it('posts a JSON body with the bearer token over the API', async () => {
    const rt = await api({ [`POST ${API}/repos/acme/app/issues/12/comments`]: { status: 201, json: { id: 9 } } });
    const meta: { code?: number } = {};
    await rt.exec.run({ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/acme/app/issues/12/comments', fields: {}, json: '{"body":"hi"}' }, meta);
    const hit = host?.hits.at(-1);
    expect(JSON.parse(hit?.body ?? '')).toEqual({ body: 'hi' });
    expect(hit?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(hit?.headers['content-type']).toBe('application/json');
    expect(meta.code).toBe(201);
  });

  it('sends a GraphQL mutation to the GraphQL endpoint and fails on an errors body', async () => {
    const rt = await api({ 'POST /api/graphql': { json: { errors: [{ message: 'Resource not accessible' }] } } });
    const c: VcsCommand = { vcs: 'github', via: 'api', method: 'POST', endpoint: 'graphql', fields: { query: 'mutation { resolveReviewThread(input: { threadId: "PRRT_kwDOAbCdEf5Abc1" }) { thread { isResolved } } }' } };
    await expect(rt.exec.run(c)).rejects.toThrow(/Resource not accessible/);
    expect(host?.hits.at(-1)?.path).toBe('/api/graphql');
  });

  it('runs through gh with the body in a file and the host in the environment', async () => {
    const seen: { args: string[]; body: string; env: NodeJS.ProcessEnv }[] = [];
    const run: CliRun = async (_f, args, o) => {
      const at = args.indexOf('--input');
      seen.push({ args, body: at >= 0 ? readFileSync(args[at + 1], 'utf8') : '', env: o.env });
      return '{}';
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'x', env: () => ({}), run });
    await rt.exec.run({ vcs: 'github', via: 'gh', method: 'POST', endpoint: 'repos/acme/app/issues/12/comments', fields: {}, json: '{"body":"hi"}' });
    expect(seen[0].args.slice(0, 4)).toEqual(['api', '--method', 'POST', 'repos/acme/app/issues/12/comments']);
    expect(seen[0].body).toBe('{"body":"hi"}');
    expect(seen[0].env.GH_HOST).toBe('ghe.test');
  });

  it('refuses a command that is not GitHub-shaped', async () => {
    const rt = await api();
    await expect(rt.exec.run({ vcs: 'github', via: 'api', method: 'PUT', endpoint: 'repos/acme/app/pulls/7/merge', fields: {}, json: '{}' })).rejects.toThrow();
    expect(host?.hits).toHaveLength(0);
  });
});

describe('the open issues of a project, whoever they are assigned to', () => {
  const issue = (n: number, over: Record<string, unknown> = {}) => ({
    number: n,
    title: `Issue ${n}`,
    state: 'open',
    labels: [{ name: 'bug' }],
    assignees: [],
    user: { login: 'bob-qa' },
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-30T09:00:00Z',
    closed_at: null,
    html_url: `https://ghe.test/acme/app/issues/${n}`,
    repository_url: 'https://ghe.test/api/v3/repos/acme/app',
    ...over,
  });
  const search = (items: unknown[]) => ({ [`GET ${API}/search/issues`]: { json: { total_count: items.length, items } } });
  const query = () => new URL(`http://x/${host?.log()[0].replace(/^GET /, '')}`).searchParams;

  it('asks the search for the open issues of the repository, newest update first, with no pull request counted', async () => {
    const rt = await api(search([issue(3, { assignees: [{ login: 'cy' }] }), issue(4)]));
    const issues = await rt.provider.listIssues({ project: 'acme/app', scope: 'all' });
    expect(query().get('q')).toBe('is:issue is:open repo:acme/app');
    expect(host?.log()[0]).toContain('&sort=updated&order=desc&per_page=100&page=1');
    expect(issues.map((i) => [i.project, i.iid, i.state, i.assignees])).toEqual([['acme/app', 3, 'open', ['cy']], ['acme/app', 4, 'open', []]]);
  });

  it('keeps a pull request out even when the search lets one through', async () => {
    const rt = await api(search([issue(3), issue(4, { pull_request: { url: 'x' } })]));
    expect((await rt.provider.listIssues({ project: 'acme/app', scope: 'all' })).map((i) => i.iid)).toEqual([3]);
  });

  it('filters by any of the labels with one OR qualifier, quoting each name', async () => {
    const rt = await api(search([issue(5)]));
    await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: [' ready to test ', 'bug', 'READY TO TEST'] });
    expect(query().get('q')).toBe('is:issue is:open repo:acme/app label:"ready to test","bug"');
  });

  it('never lets a quote or a backslash of a label into the query', async () => {
    const rt = await api(search([]));
    await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: ['a" repo:other/x', 'b\\'] });
    expect(query().get('q')).toBe('is:issue is:open repo:acme/app label:"a repo:other/x","b"');
  });

  it('is an empty list, without a request, for a label scope with no label', async () => {
    const rt = await api(search([issue(1)]));
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: [' '] })).toEqual([]);
    expect(host?.log()).toHaveLength(0);
  });

  it('reads at most two pages of a hundred and cuts at the limit', async () => {
    const page = (from: number) => Array.from({ length: 100 }, (_, i) => issue(from + i));
    host = await startFakeHost({
      [`GET ${API}/user`]: { json: F.user },
      [`GET ${API}/search/issues`]: (h: { query: URLSearchParams }) => ({ json: { items: page(h.query.get('page') === '1' ? 1 : 101) } }),
    });
    const rt = buildRuntime(settings({ apiUrl: `${host.url}${API}` }), { token: () => TOKEN, env: () => ({}), sleep: noSleep });
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'all' })).toHaveLength(200);
    expect(host.log().filter((l) => l.includes('/search/issues'))).toHaveLength(2);
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'all', limit: 100 })).toHaveLength(100);
  });

  it('refuses a project that is not owner/repo before any request', async () => {
    const rt = await api(search([]));
    await expect(rt.provider.listIssues({ project: 'acme/app repo:other/x', scope: 'all' })).rejects.toBeInstanceOf(VcsError);
    expect(host?.log()).toHaveLength(0);
  });

  it('asks gh for the same search', async () => {
    const calls: string[][] = [];
    const run: CliRun = async (_f, args) => {
      calls.push(args);
      return JSON.stringify(args[1] === 'user' ? F.user : { items: [] });
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'unused', env: () => ({}), run });
    await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: ['bug'] });
    expect(calls).toEqual([['api', 'search/issues?q=is%3Aissue%20is%3Aopen%20repo%3Aacme%2Fapp%20label%3A%22bug%22&sort=updated&order=desc&per_page=100&page=1']]);
  });
});
