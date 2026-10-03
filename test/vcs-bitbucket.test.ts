import { afterEach, describe, expect, it } from 'vitest';
import { VcsError } from '../src/main/vcs/errors';
import { validateBitbucketCommand } from '../src/main/vcs/bitbucket';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { VcsCommand, VcsWriteOp } from '../src/main/vcs/types';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';

const SECRET = 'ana-dev:APPPASSWORD-not-real-0001';
const F = fixture<Record<string, any>>('bitbucket');
const API = '/2.0';
const ME = '%7B11111111-2222-3333-4444-555555555555%7D';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

const settings = (over: Partial<VcsSettings> = {}): VcsSettings => ({ id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', apiUrl: '', user: 'ana-dev', secretRef: 'bb.token', cli: null, preference: 'api', repos: ['acme/app', 'acme/uploader'], ...over });

async function api(routes: Parameters<typeof startFakeHost>[0] = {}, secret = SECRET, over: Partial<VcsSettings> = {}): Promise<VcsRuntime> {
  host = await startFakeHost({ [`GET ${API}/user`]: { json: F.user }, ...routes });
  return buildRuntime(settings({ apiUrl: `${host.url}${API}`, ...over }), { token: () => secret, env: () => ({}), sleep: noSleep });
}

describe('reads', () => {
  it('authenticates with Basic for user:app-password and Bearer for a bare access token', async () => {
    const basic = await api();
    await basic.provider.currentUser();
    expect(host?.hits[0].headers.authorization).toBe(`Basic ${Buffer.from(SECRET).toString('base64')}`);
    await host?.close();
    const bearer = await api({}, 'ATBBtoken-not-real-0001');
    await bearer.provider.currentUser();
    expect(host?.hits[0].headers.authorization).toBe('Bearer ATBBtoken-not-real-0001');
  });

  it('knows me by nickname and uuid', async () => {
    const rt = await api();
    expect(await rt.provider.currentUser()).toMatchObject({ id: '{11111111-2222-3333-4444-555555555555}', username: 'ana-dev', name: 'Ana Dev' });
    expect(rt.provider.transport).toBe('api');
    expect(rt.provider.caps.manualJobs).toBe(false);
  });

  it('lists my open issues per repository, with the state as status, and skips a repository that has no tracker', async () => {
    const rt = await api({
      [`GET ${API}/repositories/acme/app/issues`]: { json: F.issues },
      [`GET ${API}/repositories/acme/uploader/issues`]: { status: 404, json: { type: 'error', error: { message: 'Repository has no issue tracker.' } } },
    });
    const issues = await rt.provider.listMyIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ project: 'acme/app', iid: 12, status: 'open', state: 'open', labels: ['bug', 'major'], milestone: 'v1.2', assignees: ['ana-dev'] });
    const q = host?.hits.find((h) => h.path.endsWith('/acme/app/issues'))?.query.get('q');
    expect(q).toBe('assignee.uuid="{11111111-2222-3333-4444-555555555555}" AND (state="new" OR state="open" OR state="on hold")');
  });

  it('maps resolved and closed issue states to closed', async () => {
    const rt = await api({ [`GET ${API}/repositories/acme/app/issues/12`]: { json: { ...F.issue_12, state: 'resolved' } } });
    expect(await rt.provider.getIssue('acme/app', 12)).toMatchObject({ state: 'closed', status: 'resolved', body: 'Accented names break the export.' });
  });

  it('reads issue comments without the deleted ones, newest first', async () => {
    const rt = await api({ [`GET ${API}/repositories/acme/app/issues/12/comments`]: { json: F.issue_comments } });
    expect((await rt.provider.listIssueComments('acme/app', 12)).map((c) => [c.id, c.author])).toEqual([[32, 'bob-qa'], [31, 'ana-dev']]);
  });

  it('lists my PRs as author (all workspaces) and reviewer (configured repositories), with CI from the commit statuses', async () => {
    const rt = await api({
      [`GET ${API}/pullrequests/${ME}`]: { json: F.prs_author },
      [`GET ${API}/repositories/acme/app/pullrequests`]: { json: { values: [] } },
      [`GET ${API}/repositories/acme/uploader/pullrequests`]: { json: F.prs_reviewer },
      [`GET ${API}/repositories/acme/app/pullrequests/7/statuses`]: { json: F.pr_statuses },
      [`GET ${API}/repositories/acme/uploader/pullrequests/9/statuses`]: { json: { values: [] } },
    });
    const mrs = await rt.provider.listMyMrs({ detail: true });
    expect(mrs.map((m) => [m.project, m.iid, m.roles, m.draft, m.ci?.status, m.sourceBranch, m.state])).toEqual([
      ['acme/app', 7, ['author'], true, 'failed', 'release/bugfix/12', 'open'],
      ['acme/uploader', 9, ['reviewer'], false, undefined, 'feature/retry', 'open'],
    ]);
    expect(mrs[0].approvals).toEqual({ approved: false, by: ['carol-dev'], changesRequestedBy: ['dave-ops'] });
    expect(mrs[0].issueRefs).toEqual([12]);
    expect(mrs[0].hasConflicts).toBeNull();
    const reviewerQuery = host?.hits.find((h) => h.path.endsWith('/uploader/pullrequests'))?.query.get('q');
    expect(reviewerQuery).toBe('reviewers.uuid="{11111111-2222-3333-4444-555555555555}" AND state="OPEN"');
  });

  it('reads threads: replies join their root, resolved roots are resolved, deleted comments are dropped', async () => {
    const rt = await api({ [`GET ${API}/repositories/acme/app/pullrequests/7/comments`]: { json: F.pr_comments } });
    const threads = await rt.provider.listMrThreads('acme/app', 7);
    expect(threads.map((t) => [t.id, t.resolved, t.path, t.line, t.notes.map((n) => n.id)])).toEqual([
      ['101', false, 'src/export.ts', 12, [101, 102]],
      ['103', true, null, null, [103]],
    ]);
    expect((await rt.provider.getMrThread('acme/app', 7, '101')).notes).toHaveLength(2);
  });

  it('splits the raw diff of a PR into files', async () => {
    const rt = await api({ [`GET ${API}/repositories/acme/app/pullrequests/7/diff`]: { text: F.pr_diff } });
    expect(await rt.provider.listMrChanges('acme/app', 7)).toEqual([
      { path: 'src/export.ts', diff: '@@ -10,3 +10,4 @@\n a\n+b\n c\n' },
      { path: 'assets/logo.png', diff: '' },
    ]);
  });

  it('finds the PRs of an issue by title or branch, and keeps only those that really name it', async () => {
    const rt = await api({
      [`GET ${API}/repositories/acme/app/pullrequests`]: { json: { values: [...F.prs_author.values, { ...F.prs_author.values[0], id: 99, title: 'Unrelated 120 things', description: '', source: { branch: { name: 'x/120' } } }] } },
      [`GET ${API}/repositories/acme/app/pullrequests/7/statuses`]: { json: F.pr_statuses },
    });
    expect((await rt.provider.linkedMrs('acme/app', 12)).map((m) => m.iid)).toEqual([7]);
  });

  it('reads the repository, a branch and the workspace members as reviewer candidates', async () => {
    const rt = await api({
      [`GET ${API}/repositories/acme/app`]: { json: F.repo },
      [`GET ${API}/repositories/acme/app/refs/branches/main`]: { json: F.branch },
      [`GET ${API}/workspaces/acme/members`]: { json: F.members },
    });
    expect(await rt.provider.getRepo('acme/app')).toEqual({ project: 'acme/app', defaultBranch: 'main', webUrl: 'https://bitbucket.org/acme/app' });
    expect(await rt.provider.getBranchSha('acme/app', 'main')).toBe('9999aaaa8888bbbb');
    expect((await rt.provider.listReviewerCandidates('acme/app')).map((m) => m.username)).toEqual(['carol-dev']);
    expect((await rt.provider.getReviewer('acme/app', '{22222222-2222-3333-4444-555555555555}')).username).toBe('carol-dev');
    await expect(rt.provider.getReviewer('acme/app', '{99999999-2222-3333-4444-555555555555}')).rejects.toThrow(/não tem acesso de revisão/);
  });

  it('follows next links and pages the comment list', async () => {
    host = await startFakeHost({ [`GET ${API}/user`]: { json: F.user } });
    const base = host.url;
    host.route(`GET ${API}/repositories/acme/app/issues/12/comments`, (h) =>
      h.query.get('page') === '2' ? { json: { values: [F.issue_comments.values[1]] } } : { json: { values: [F.issue_comments.values[0]], next: `${base}${API}/repositories/acme/app/issues/12/comments?page=2` } },
    );
    const rt = buildRuntime(settings({ apiUrl: `${base}${API}` }), { token: () => SECRET, env: () => ({}) });
    expect((await rt.provider.listIssueComments('acme/app', 12)).map((c) => c.id)).toEqual([32, 31]);
  });

  it('refuses a malformed uuid or repository before any request', async () => {
    const rt = await api();
    await expect(rt.provider.getRepo('acme')).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.getMrThread('acme/app', 0, '1')).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
    await expect(rt.provider.getReviewer('acme/app', 'x')).rejects.toThrow();
  });
});

describe('planWrite', () => {
  const plan = async (op: VcsWriteOp, routes: Parameters<typeof startFakeHost>[0] = {}) => (await api(routes)).provider.planWrite(op);
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: '', fields: {}, ...over });

  it('comments on issues and PRs, and replies by parent', async () => {
    expect(await plan({ op: 'commentIssue', project: 'acme/app', iid: 12, body: 'hi' })).toEqual([cmd({ endpoint: 'repositories/acme/app/issues/12/comments', json: '{"content":{"raw":"hi"}}' })]);
    expect(await plan({ op: 'deleteNote', project: 'acme/app', iid: 12, noteId: 5, target: 'issue' })).toEqual([cmd({ method: 'DELETE', endpoint: 'repositories/acme/app/issues/12/comments/5' })]);
    for (const target of ['mr', 'review'] as const) expect(await plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: 5, target })).toEqual([cmd({ method: 'DELETE', endpoint: 'repositories/acme/app/pullrequests/7/comments/5' })]);
    await expect(plan({ op: 'deleteNote', project: 'acme/app', iid: 7, noteId: 'x', target: 'mr' })).rejects.toThrow();
    expect(await plan({ op: 'commentMr', project: 'acme/app', iid: 7, body: 'hi' })).toEqual([cmd({ endpoint: 'repositories/acme/app/pullrequests/7/comments', json: '{"content":{"raw":"hi"}}' })]);
    expect(await plan({ op: 'replyThread', project: 'acme/app', iid: 7, threadId: '101', body: 'ok' })).toEqual([cmd({ endpoint: 'repositories/acme/app/pullrequests/7/comments', json: '{"content":{"raw":"ok"},"parent":{"id":101}}' })]);
    expect(await plan({ op: 'resolveThread', project: 'acme/app', iid: 7, threadId: '101' })).toEqual([cmd({ endpoint: 'repositories/acme/app/pullrequests/7/comments/101/resolve' })]);
  });

  it('adds a reviewer keeping the existing ones, and toggles draft keeping the title', async () => {
    const routes = { [`GET ${API}/repositories/acme/app/pullrequests/7`]: { json: F.pr_7 }, [`GET ${API}/repositories/acme/app/pullrequests/7/statuses`]: { json: { values: [] } } };
    const [add] = await plan({ op: 'addReviewer', project: 'acme/app', iid: 7, userId: '{33333333-2222-3333-4444-555555555555}', username: 'dave-ops' }, routes);
    expect(add).toEqual(cmd({ method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"title":"Fix accents in export","reviewers":[{"uuid":"{22222222-2222-3333-4444-555555555555}"},{"uuid":"{33333333-2222-3333-4444-555555555555}"}]}' }));
    const [ready] = await plan({ op: 'setDraft', project: 'acme/app', iid: 7, draft: false }, routes);
    expect(ready).toEqual(cmd({ method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"title":"Fix accents in export","draft":false}' }));
    for (const c of [add, ready]) expect(() => validateBitbucketCommand(c)).not.toThrow();
  });

  it('changes the issue state, and says what Bitbucket cannot do', async () => {
    expect(await plan({ op: 'setIssueStatus', project: 'acme/app', iid: 12, status: 'resolved' })).toEqual([cmd({ method: 'PUT', endpoint: 'repositories/acme/app/issues/12', json: '{"state":"resolved"}' })]);
    await expect(plan({ op: 'setIssueStatus', project: 'acme/app', iid: 12, status: 'In QA' })).rejects.toBeInstanceOf(VcsError);
    await expect(plan({ op: 'setIssueLabels', project: 'acme/app', iid: 12, add: ['a'], remove: [] })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(plan({ op: 'playJob', project: 'acme/app', jobId: 1 })).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('validateCommand: what a Bitbucket write may look like', () => {
  const ok = (c: Partial<VcsCommand>): VcsCommand => ({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/pullrequests/7/comments', fields: {}, json: '{"content":{"raw":"x"}}', ...c });

  it('accepts the listed calls', () => {
    for (const c of [
      ok({}),
      ok({ json: '{"content":{"raw":"x"},"parent":{"id":3}}' }),
      ok({ endpoint: 'repositories/acme/app/issues/1/comments' }),
      ok({ endpoint: 'repositories/acme/app/pullrequests/7/comments/3/resolve', json: undefined }),
      ok({ method: 'PUT', endpoint: 'repositories/acme/app/issues/1/comments/3' }),
      ok({ method: 'DELETE', endpoint: 'repositories/acme/app/pullrequests/7/comments/3', json: undefined }),
      ok({ method: 'DELETE', endpoint: 'repositories/acme/app/issues/1/comments/3', json: undefined }),
      ok({ method: 'PUT', endpoint: 'repositories/acme/app/issues/1', json: '{"state":"closed"}' }),
      ok({ method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"title":"t","draft":true}' }),
    ]) expect(() => validateBitbucketCommand(c)).not.toThrow();
  });

  const refused: [string, Partial<VcsCommand>][] = [
    ['merging', { endpoint: 'repositories/acme/app/pullrequests/7/merge', json: '{}' }],
    ['declining', { endpoint: 'repositories/acme/app/pullrequests/7/decline', json: '{}' }],
    ['deleting a pull request', { method: 'DELETE', endpoint: 'repositories/acme/app/pullrequests/7', json: undefined }],
    ['deleting a repository', { method: 'DELETE', endpoint: 'repositories/acme/app', json: undefined }],
    ['deleting a comment with a body', { method: 'DELETE', endpoint: 'repositories/acme/app/pullrequests/7/comments/3', json: '{"content":{"raw":"x"}}' }],
    ['a body key that is not allowed', { json: '{"content":{"raw":"x"},"assignee":{}}' }],
    ['a missing required key', { json: '{"parent":{"id":3}}' }],
    ['content that is not raw text', { json: '{"content":{"raw":3}}' }],
    ['a state that is not an issue state', { method: 'PUT', endpoint: 'repositories/acme/app/issues/1', json: '{"state":"deleted"}' }],
    ['reviewers that are not uuids', { method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"title":"t","reviewers":[{"uuid":"x"}]}' }],
    ['a PR update without a title', { method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"draft":true}' }],
    ['changing the branches of a PR', { method: 'PUT', endpoint: 'repositories/acme/app/pullrequests/7', json: '{"title":"t","destination":{"branch":{"name":"x"}}}' }],
    ['a parent that is not a number', { json: '{"content":{"raw":"x"},"parent":{"id":"3"}}' }],
    ['a body that is not JSON', { json: 'x' }],
    ['form fields', { fields: { a: 'b' } }],
    ['the glab transport', { via: 'glab' }],
    ['path traversal', { endpoint: 'repositories/acme/app/pullrequests/7/../../../../user/comments' }],
    ['an absolute URL', { endpoint: 'https://evil.test/2.0/repositories/acme/app/pullrequests/7/comments' }],
    ['a workspace write', { endpoint: 'workspaces/acme/members', json: '{}' }],
  ];
  it.each(refused)('refuses %s', (_name, over) => {
    expect(() => validateBitbucketCommand(ok(over))).toThrow();
  });
});

describe('the executor', () => {
  it('sends the JSON body with the credential and reports the status', async () => {
    const rt = await api({ [`POST ${API}/repositories/acme/app/pullrequests/7/comments`]: { status: 201, json: { id: 201 } } });
    const meta: { code?: number } = {};
    await rt.exec.run({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/pullrequests/7/comments', fields: {}, json: '{"content":{"raw":"hi"}}' }, meta);
    const hit = host?.hits.at(-1);
    expect(JSON.parse(hit?.body ?? '')).toEqual({ content: { raw: 'hi' } });
    expect(hit?.headers.authorization).toMatch(/^Basic /);
    expect(meta.code).toBe(201);
  });

  it('refuses a command that is not Bitbucket-shaped, and never retries a failing write', async () => {
    const rt = await api({ [`POST ${API}/repositories/acme/app/pullrequests/7/comments`]: { status: 503, json: {} } });
    await expect(rt.exec.run({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/pullrequests/7/merge', fields: {}, json: '{}' })).rejects.toThrow();
    expect(host?.hits).toHaveLength(0);
    await expect(rt.exec.run({ vcs: 'bitbucket', via: 'api', method: 'POST', endpoint: 'repositories/acme/app/pullrequests/7/comments', fields: {}, json: '{"content":{"raw":"x"}}' })).rejects.toMatchObject({ code: 'server' });
    expect(host?.hits).toHaveLength(1);
  });
});
