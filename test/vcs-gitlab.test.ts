import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { VcsError } from '../src/main/vcs/errors';
import { STATUS_MUTATION, validateGitLabCommand } from '../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import type { CliRun } from '../src/main/vcs/transport';
import type { VcsCommand, VcsWriteOp } from '../src/main/vcs/types';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';

const TOKEN = 'TESTTOKEN-gitlab-not-real-0001';
const F = fixture<Record<string, any>>('gitlab');
const P = 'acme%2Fapp';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

const settings = (over: Partial<VcsSettings> = {}): VcsSettings => ({ id: 'gl', kind: 'gitlab', host: 'gitlab.test', apiUrl: '', user: '', secretRef: 'gl.token', cli: 'glab', preference: 'api', repos: [], ...over });

async function api(routes: Parameters<typeof startFakeHost>[0]): Promise<VcsRuntime> {
  host = await startFakeHost({ 'GET /api/v4/user': { json: F.user }, ...routes });
  return buildRuntime(settings({ apiUrl: `${host.url}/api/v4` }), { token: () => TOKEN, env: () => ({}), sleep: noSleep });
}

describe('reads over the API transport', () => {
  it('knows who I am once, and authenticates with the token header', async () => {
    const rt = await api({});
    expect(rt.provider.transport).toBe('api');
    expect(await rt.provider.currentUser()).toMatchObject({ id: 42, username: 'ana.dev', name: 'Ana Dev' });
    await rt.provider.currentUser();
    expect(host?.hits).toHaveLength(1);
    expect(host?.hits[0].headers['private-token']).toBe(TOKEN);
  });

  it('lists my open issues with status, labels and milestone', async () => {
    const rt = await api({
      'GET /api/v4/projects/acme%2Fapp/issues': { json: F.issues_assigned },
      'POST /api/graphql': { json: F.workitem_status },
    });
    const issues = await rt.provider.listMyIssues({ project: 'acme/app' });
    expect(host?.log()[0]).toBe('GET /api/v4/projects/acme%2Fapp/issues?scope=assigned_to_me&state=opened&order_by=updated_at&per_page=100&page=1');
    expect(issues.map((i) => [i.project, i.iid, i.status, i.labels[0], i.milestone])).toEqual([
      ['acme/app', 101, 'In development', 'STAGE:: Doing', 'v1.2'],
      ['acme/app', 102, null, 'STAGE:: Code Review OK', null],
    ]);
    expect(issues[0]).toMatchObject({ state: 'open', assignees: ['ana.dev'], webUrl: 'https://gitlab.test/acme/app/-/issues/101', updatedAt: '2026-09-30T09:00:00Z' });
    const gql = host?.hits.find((h) => h.path === '/api/graphql');
    expect(gql?.method).toBe('POST');
    expect(JSON.parse(gql?.body ?? '{}').query).toMatch(/^\{ project\(fullPath:"acme\/app"\)/);
  });

  it('lists across projects when no project is given, and takes the project from the reference', async () => {
    const rt = await api({ 'GET /api/v4/issues': { json: F.issues_assigned }, 'POST /api/graphql': { status: 500, json: {} } });
    const issues = await rt.provider.listMyIssues();
    expect(issues.map((i) => i.project)).toEqual(['acme/app', 'acme/app']);
    // a failing status read leaves the statuses empty, never the list
    expect(issues.every((i) => i.status === null)).toBe(true);
  });

  it('reads one issue with its status and work item id, or just the issue', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/issues/101': { json: F.issue_101 }, 'POST /api/graphql': { json: F.workitem_status } });
    expect((await rt.provider.getIssue('acme/app', 101)).status).toBeNull();
    const full = await rt.provider.getIssue('acme/app', 101, { status: true });
    expect(full).toMatchObject({ status: 'In development', nodeId: 'gid://gitlab/WorkItem/5001', labels: ['STAGE:: Doing', 'bug'] });
  });

  it('accepts the numeric project id the legacy config carries', async () => {
    const rt = await api({ 'GET /api/v4/projects/1/issues/101': { json: F.issue_101 } });
    expect((await rt.provider.getIssue('1', 101)).project).toBe('acme/app');
  });

  it('refuses a project or number that is not one', async () => {
    const rt = await api({});
    await expect(rt.provider.getIssue('../etc', 1)).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.getIssue('a/b', 0)).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.getIssue('a/b?x=1', 1)).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('reads the comments of an issue, newest first, with the system notes marked', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/issues/101/notes': { json: F.issue_notes } });
    const notes = await rt.provider.listIssueComments('acme/app', 101);
    expect(notes.map((n) => [n.id, n.system, n.author])).toEqual([[903, false, 'bob.qa'], [902, true, 'ana.dev'], [901, false, 'ana.dev']]);
    expect(host?.log()[0]).toContain('sort=desc&order_by=created_at&per_page=100&page=1');
    expect(notes[0].webUrl).toBe('https://gitlab.test/acme/app/-/work_items/101#note_903');
  });

  it('lists my MRs as author and reviewer, merged by MR, with the pipeline from the detail read', async () => {
    const rt = await api({
      'GET /api/v4/merge_requests': (h) => ({ json: h.query.get('scope') === 'created_by_me' ? F.mr_list_author : F.mr_list_reviewer }),
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7': { json: F.mr_7 },
      'GET /api/v4/projects/acme%2Fuploader/merge_requests/9': { json: { ...F.mr_list_reviewer[0], head_pipeline: { id: 5, status: 'failed' } } },
    });
    const mrs = await rt.provider.listMyMrs({ detail: true });
    expect(mrs.map((m) => [m.project, m.iid, m.roles, m.draft, m.ci?.status, m.ci?.raw])).toEqual([
      ['acme/app', 7, ['author'], true, 'manual', 'manual'],
      ['acme/uploader', 9, ['reviewer'], false, 'failed', 'failed'],
    ]);
    const reviewer = host?.hits.find((h) => h.query.get('reviewer_username'));
    expect(reviewer?.query.get('reviewer_username')).toBe('ana.dev');
    expect(reviewer?.query.get('state')).toBe('opened');
  });

  it('reads one MR with divergence and approvals when asked', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/merge_requests/7': { json: F.mr_7 }, 'GET /api/v4/projects/acme%2Fapp/merge_requests/7/approvals': { json: F.mr_approvals } });
    const mr = await rt.provider.getMr('acme/app', 7, { behind: true, approvals: true });
    expect(mr).toMatchObject({ state: 'open', draft: true, hasConflicts: false, behind: 3, sha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', author: 'ana.dev' });
    expect(mr.reviewers.map((r) => r.username)).toEqual(['carol.dev']);
    expect(mr.approvals).toEqual({ approved: true, by: ['carol.dev'], changesRequestedBy: [] });
    expect(host?.log()[0]).toContain('include_diverged_commits_count=true');
  });

  it('reads threads with the resolvable state, the position and the system notes', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/merge_requests/7/discussions': { json: F.mr_discussions } });
    const threads = await rt.provider.listMrThreads('acme/app', 7);
    expect(threads.map((t) => [t.resolvable, t.resolved, t.path, t.line, t.notes.length])).toEqual([
      [true, false, 'src/export.ts', 12, 2],
      [true, true, null, null, 1],
      [false, true, null, null, 1],
    ]);
    expect(threads[0].notes[0].webUrl).toBe('https://gitlab.test/acme/app/-/merge_requests/7#note_11');
    expect(threads.filter((t) => !t.resolved)).toHaveLength(1);
  });

  it('reads one thread by id and refuses an id that is not a discussion id', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/merge_requests/7/discussions/3f1c9a0e5b7d2a4c8e6f1b3d5a7c9e0f2b4d6a8c': { json: F.mr_discussions[0] } });
    expect((await rt.provider.getMrThread('acme/app', 7, '3f1c9a0e5b7d2a4c8e6f1b3d5a7c9e0f2b4d6a8c')).notes).toHaveLength(2);
    await expect(rt.provider.getMrThread('acme/app', 7, '../x')).rejects.toBeInstanceOf(VcsError);
  });

  it('reads CI runs, jobs, commits and changes', async () => {
    const rt = await api({
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7/pipelines': { json: F.mr_pipelines },
      'GET /api/v4/projects/acme%2Fapp/pipelines/900/jobs': { json: F.pipeline_jobs },
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7/commits': { json: F.mr_commits },
      'GET /api/v4/projects/acme%2Fapp/merge_requests/7/changes': { json: F.mr_changes },
      'GET /api/v4/projects/acme%2Fapp/jobs/2': { json: F.pipeline_jobs[1] },
    });
    expect((await rt.provider.listMrCi('acme/app', 7)).map((r) => [r.id, r.status])).toEqual([[900, 'manual'], [880, 'success']]);
    expect((await rt.provider.listCiJobs('acme/app', 900)).filter((j) => j.status === 'manual').map((j) => j.name)).toEqual(['deploy_beta', 'e2e']);
    expect(await rt.provider.listMrCommits('acme/app', 7)).toEqual([{ sha: 'cccc3333dddd4444', date: '2026-10-01T09:30:00Z' }, { sha: 'aaaa1111bbbb2222', date: '2026-09-30T09:30:00Z' }]);
    expect(await rt.provider.listMrChanges('acme/app', 7)).toEqual([{ path: 'src/export.ts', diff: '@@ -10,3 +10,4 @@\n a\n+b\n c\n' }, { path: 'src/big.ts', diff: '' }]);
    expect(await rt.provider.getCiJob('acme/app', 2)).toMatchObject({ id: 2, name: 'deploy_beta', runId: 900 });
  });

  it('lists the MRs that reference an issue, with their project', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/issues/101/related_merge_requests': { json: F.related_mrs } });
    const mrs = await rt.provider.linkedMrs('acme/app', 101);
    expect(mrs.map((m) => [m.project, m.iid, m.state, m.targetBranch, m.mergedAt])).toEqual([
      ['acme/app', 7, 'merged', 'main', '2026-10-01T12:00:00Z'],
      ['acme/playbook', 3, 'merged', 'main', '2026-10-02T12:00:00Z'],
    ]);
  });

  it('reads the repository, a branch sha and the reviewer candidates without bots, guests and myself', async () => {
    const rt = await api({
      'GET /api/v4/projects/acme%2Fapp': { json: F.project },
      'GET /api/v4/projects/acme%2Fapp/repository/branches/main': { json: F.branch_main },
      'GET /api/v4/projects/acme%2Fapp/members/all': { json: F.members },
      'GET /api/v4/projects/acme%2Fapp/merge_requests': { json: F.recent_mrs },
    });
    expect(await rt.provider.getRepo('acme/app')).toEqual({ project: 'acme/app', defaultBranch: 'main', webUrl: 'https://gitlab.test/acme/app' });
    expect(await rt.provider.getBranchSha('acme/app', 'main')).toBe('9999aaaa8888bbbb7777cccc6666dddd5555eeee');
    const people = await rt.provider.listReviewerCandidates('acme/app');
    expect(people.map((p) => [p.username, p.usual])).toEqual([['carol.dev', 2], ['dave.ops', 0]]);
  });

  it('checks that a reviewer may review', async () => {
    const rt = await api({
      'GET /api/v4/projects/acme%2Fapp/members/all/77': { json: F.members[1] },
      'GET /api/v4/projects/acme%2Fapp/members/all/80': { json: F.members[4] },
    });
    expect((await rt.provider.getReviewer('acme/app', 77)).username).toBe('carol.dev');
    await expect(rt.provider.getReviewer('acme/app', 80)).rejects.toThrow(/erin\.guest não tem acesso de revisão/);
  });

  it('searches issues and MRs created after a date', async () => {
    const rt = await api({ 'GET /api/v4/projects/acme%2Fapp/issues': { json: F.issues_assigned }, 'GET /api/v4/projects/acme%2Fapp/merge_requests': { json: F.mr_list_author } });
    expect(await rt.provider.searchIssues('acme/app', { text: 'accents', createdAfter: '2026-09-01T00:00:00Z' })).toHaveLength(2);
    expect(host?.log()[0]).toBe('GET /api/v4/projects/acme%2Fapp/issues?search=accents&in=title&scope=all&created_after=2026-09-01T00%3A00%3A00Z&per_page=20');
    expect(await rt.provider.searchMrs('acme/app', { text: 'x', createdAfter: '2026-09-01T00:00:00Z' })).toHaveLength(1);
  });

  it('builds the web links', async () => {
    const rt = await api({});
    expect(rt.provider.issueUrl('acme/app', 101)).toBe('https://gitlab.test/acme/app/-/work_items/101');
    expect(rt.provider.mrUrl('acme/app', 7)).toBe('https://gitlab.test/acme/app/-/merge_requests/7');
    expect(rt.provider.noteUrl('acme/app', 'mr', 7, 11)).toBe('https://gitlab.test/acme/app/-/merge_requests/7#note_11');
  });

  it('says what is missing when the integration has no token', async () => {
    host = await startFakeHost();
    const rt = buildRuntime(settings({ apiUrl: `${host.url}/api/v4` }), {
      token: () => {
        throw new VcsError('no_token', { id: 'gl', ref: 'gl.token' });
      },
      env: () => ({}),
    });
    await expect(rt.provider.currentUser()).rejects.toMatchObject({ code: 'no_token' });
    expect(host.hits).toHaveLength(0);
  });
});

describe('reads over the glab transport (the migrated user)', () => {
  function cli(answer: (args: string[]) => unknown) {
    const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const run: CliRun = async (_file, args, o) => {
      calls.push({ args, env: o.env });
      return JSON.stringify(answer(args));
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'unused', env: () => ({ PATH: '/bin' }), run, sleep: noSleep });
    return { rt, calls };
  }

  it('calls `glab api <endpoint>` with the host in the environment, like the app always did', async () => {
    const { rt, calls } = cli((args) => (args[1] === 'user' ? F.user : args[1].includes('/issues/101') ? F.issue_101 : []));
    expect(rt.provider.transport).toBe('cli');
    await rt.provider.currentUser();
    await rt.provider.getIssue('acme/app', 101);
    expect(calls.map((c) => c.args)).toEqual([['api', 'user'], ['api', 'projects/acme%2Fapp/issues/101']]);
    expect(calls[0].env.GITLAB_HOST).toBe('gitlab.test');
  });

  it('reads the work item status with a GraphQL query through `glab api graphql`', async () => {
    const { rt, calls } = cli((args) => (args[1] === 'graphql' ? F.workitem_status : F.issue_101));
    const issue = await rt.provider.getIssue('acme/app', 101, { status: true });
    expect(issue.status).toBe('In development');
    const gql = calls.find((c) => c.args[1] === 'graphql');
    expect(gql?.args.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
    expect(gql?.args[3]).toMatch(/^query=query \{ project\(fullPath: "acme\/app"\) \{ workItems\(iid: "101"\)/);
  });

  it('turns a failing CLI into the same translated errors as HTTP', async () => {
    const run: CliRun = async () => {
      throw Object.assign(new Error('Command failed: glab api user\nglab: 401 Unauthorized (HTTP 401)'), { stderr: 'glab: 401 Unauthorized (HTTP 401)\n', code: 1 });
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'x', env: () => ({}), run });
    await expect(rt.provider.currentUser()).rejects.toMatchObject({ code: 'auth', status: 401 });
    const missing: CliRun = async () => {
      throw Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' });
    };
    const rt2 = buildRuntime(settings({ preference: 'cli' }), { token: () => 'x', env: () => ({}), run: missing });
    await expect(rt2.provider.currentUser()).rejects.toMatchObject({ code: 'cli_missing' });
  });

  it('picks the CLI only when the preference says so, or auto and installed', () => {
    const deps = { token: () => 't', env: () => ({}), run: (async () => '{}') as CliRun };
    expect(buildRuntime(settings({ preference: 'cli' }), deps).provider.transport).toBe('cli');
    expect(buildRuntime(settings({ preference: 'api' }), deps).provider.transport).toBe('api');
    expect(buildRuntime(settings({ preference: 'auto', secretRef: null }), { ...deps, cliInstalled: () => true }).provider.transport).toBe('cli');
    expect(buildRuntime(settings({ preference: 'auto', secretRef: null }), { ...deps, cliInstalled: () => false }).provider.transport).toBe('api');
    expect(buildRuntime(settings({ preference: 'auto', cli: null }), deps).provider.transport).toBe('api');
  });

  it('auto follows the token: with one the API is used even when the CLI is installed', () => {
    const deps = { token: () => 't', env: () => ({}), run: (async () => '{}') as CliRun, cliInstalled: () => true };
    expect(buildRuntime(settings({ preference: 'auto' }), deps).provider.transport).toBe('api');
    expect(buildRuntime(settings({ preference: 'auto' }), { ...deps, hasToken: () => false }).provider.transport).toBe('cli');
    expect(buildRuntime(settings({ preference: 'cli' }), deps).provider.transport).toBe('cli');
  });
});

describe('planWrite: the commands are the ones the app always proposed', () => {
  const plan = async (cli: boolean, op: Parameters<VcsRuntime['provider']['planWrite']>[0], routes: Parameters<typeof startFakeHost>[0] = {}) => {
    if (cli) {
      const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 't', env: () => ({}), run: (async (_f, args) => JSON.stringify(args[1] === 'graphql' ? F.workitem_status : F.mr_7)) as CliRun });
      return rt.provider.planWrite(op);
    }
    return (await api(routes)).provider.planWrite(op);
  };
  const cmd = (over: Partial<VcsCommand>): VcsCommand => ({ vcs: 'gitlab', via: 'glab', method: 'POST', endpoint: '', fields: {}, ...over });

  it('replies to and resolves a thread', async () => {
    expect(await plan(true, { op: 'replyThread', project: 'acme/app', iid: 7, threadId: 'abcdef12', body: 'ok' })).toEqual([cmd({ endpoint: `projects/${P}/merge_requests/7/discussions/abcdef12/notes`, fields: { body: 'ok' } })]);
    expect(await plan(true, { op: 'resolveThread', project: 'acme/app', iid: 7, threadId: 'abcdef12' })).toEqual([cmd({ method: 'PUT', endpoint: `projects/${P}/merge_requests/7/discussions/abcdef12`, fields: { resolved: 'true' } })]);
  });

  it('changes labels with add_labels and remove_labels, and nothing when there is nothing to change', async () => {
    expect(await plan(true, { op: 'setIssueLabels', project: '1', iid: 101, add: ['STAGE:: Code Review'], remove: ['STAGE:: Doing'] })).toEqual([
      cmd({ method: 'PUT', endpoint: 'projects/1/issues/101', fields: { add_labels: 'STAGE:: Code Review', remove_labels: 'STAGE:: Doing' } }),
    ]);
    expect(await plan(true, { op: 'setIssueLabels', project: '1', iid: 101, add: [], remove: [] })).toEqual([]);
  });

  it('changes the work item status with the one mutation the app may send', async () => {
    const [c] = await plan(true, { op: 'setIssueStatus', project: '1', iid: 101, status: '77', nodeId: 'gid://gitlab/WorkItem/5001' });
    expect(c).toEqual(cmd({ endpoint: 'graphql', fields: { query: 'mutation { workItemUpdate(input: { id: "gid://gitlab/WorkItem/5001", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/77" } }) { errors } }' } }));
    expect(STATUS_MUTATION.test(c.fields.query)).toBe(true);
    expect(() => validateGitLabCommand(c)).not.toThrow();
  });

  it('reads the work item id when the caller has none, and refuses a status that is not an id', async () => {
    const [c] = await plan(true, { op: 'setIssueStatus', project: 'acme/app', iid: 101, status: '6' });
    expect(c.fields.query).toContain('WorkItem/5001');
    await expect(plan(true, { op: 'setIssueStatus', project: '1', iid: 101, status: '6" } }) { x', nodeId: 'gid://gitlab/WorkItem/5001' })).rejects.toBeInstanceOf(VcsError);
  });

  it('adds a reviewer by curl with the CLI token (glab refuses array fields) and by API otherwise', async () => {
    expect(await plan(true, { op: 'addReviewer', project: 'acme/app', iid: 7, userId: 77, username: 'carol.dev' })).toEqual([cmd({ via: 'curl', method: 'PUT', endpoint: `projects/${P}/merge_requests/7`, fields: { 'reviewer_ids[]': '77' } })]);
    expect(await plan(false, { op: 'addReviewer', project: 'acme/app', iid: 7, userId: 77, username: 'carol.dev' })).toEqual([cmd({ via: 'api', method: 'PUT', endpoint: `projects/${P}/merge_requests/7`, fields: { 'reviewer_ids[]': '77' } })]);
  });

  it('takes the Draft prefix off the title, with the title the caller gives or the one it reads', async () => {
    expect(await plan(true, { op: 'setDraft', project: '7', iid: 7, draft: false, title: 'fix accents' })).toEqual([cmd({ method: 'PUT', endpoint: 'projects/7/merge_requests/7', fields: { title: 'fix accents' } })]);
    expect(await plan(true, { op: 'setDraft', project: 'acme/app', iid: 7, draft: false })).toEqual([cmd({ method: 'PUT', endpoint: `projects/${P}/merge_requests/7`, fields: { title: 'fix accents in export' } })]);
    expect(await plan(true, { op: 'setDraft', project: 'acme/app', iid: 7, draft: true })).toEqual([cmd({ method: 'PUT', endpoint: `projects/${P}/merge_requests/7`, fields: { title: 'Draft: fix accents in export' } })]);
  });

  it('plays a manual job and comments on an issue or an MR', async () => {
    expect(await plan(true, { op: 'playJob', project: '7', jobId: 2 })).toEqual([cmd({ endpoint: 'projects/7/jobs/2/play' })]);
    expect(await plan(true, { op: 'commentIssue', project: 'acme/app', iid: 101, body: 'hi' })).toEqual([cmd({ endpoint: `projects/${P}/issues/101/notes`, fields: { body: 'hi' } })]);
    expect(await plan(true, { op: 'commentMr', project: 'acme/app', iid: 7, body: 'hi' })).toEqual([cmd({ endpoint: `projects/${P}/merge_requests/7/notes`, fields: { body: 'hi' } })]);
    expect(await plan(true, { op: 'editIssueNote', project: '1', iid: 101, noteId: 903, body: 'new' })).toEqual([cmd({ method: 'PUT', endpoint: 'projects/1/issues/101/notes/903', fields: { body: 'new' } })]);
  });

  it('every planned command passes its own validator', async () => {
    const ops: VcsWriteOp[] = [
      { op: 'commentIssue', project: 'acme/app', iid: 1, body: 'x' },
      { op: 'replyThread', project: 'acme/app', iid: 1, threadId: 'abcdef12', body: 'x' },
      { op: 'resolveThread', project: 'acme/app', iid: 1, threadId: 'abcdef12' },
      { op: 'setIssueLabels', project: '1', iid: 1, add: ['a'], remove: ['b'] },
      { op: 'playJob', project: '1', jobId: 3 },
    ];
    for (const op of ops) {
      for (const c of await plan(true, op)) expect(() => validateGitLabCommand(c), op.op).not.toThrow();
    }
  });
});

describe('the executor', () => {
  it('runs a REST write through glab with -f fields, and long or multi-line values through a file', async () => {
    const calls: string[][] = [];
    const files: string[] = [];
    const run: CliRun = async (_f, args) => {
      calls.push(args);
      const at = args.findIndex((a) => a.startsWith('body=@'));
      if (at >= 0) files.push(readFileSync(args[at].slice(6), 'utf8'));
      return '{"id":1}';
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 't', env: () => ({}), run });
    await rt.exec.run({ via: 'glab', method: 'POST', endpoint: `projects/${P}/issues/101/notes`, fields: { body: 'short' } });
    await rt.exec.run({ via: 'glab', method: 'PUT', endpoint: 'projects/1/issues/101/notes/9', fields: { body: 'line one\nline two' } });
    expect(calls[0]).toEqual(['api', '--method', 'POST', `projects/${P}/issues/101/notes`, '-f', 'body=short']);
    expect(calls[1].slice(0, 4)).toEqual(['api', '--method', 'PUT', 'projects/1/issues/101/notes/9']);
    expect(calls[1][4]).toBe('-F');
    expect(files).toEqual(['line one\nline two']);
  });

  it('turns a GraphQL error body into a failure even though the HTTP call succeeded', async () => {
    const run: CliRun = async () => JSON.stringify({ data: { workItemUpdate: { errors: ['Status not allowed'] } } });
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 't', env: () => ({}), run });
    const mutation = 'mutation { workItemUpdate(input: { id: "gid://gitlab/WorkItem/5001", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/77" } }) { errors } }';
    await expect(rt.exec.run({ via: 'glab', method: 'POST', endpoint: 'graphql', fields: { query: mutation } })).rejects.toThrow(/Status not allowed/);
  });

  it('refuses a command its validator refuses, before anything runs', async () => {
    const run: CliRun = async () => {
      throw new Error('must not run');
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 't', env: () => ({}), run });
    await expect(rt.exec.run({ via: 'glab', method: 'POST', endpoint: 'user', fields: {} })).rejects.toThrow(/endpoint inválido/);
    await expect(rt.exec.run({ via: 'glab', method: 'POST', endpoint: 'graphql', fields: { query: 'mutation { x }' } })).rejects.toThrow(/GraphQL/);
    await expect(rt.exec.run({ via: 'gh', method: 'POST', endpoint: `projects/${P}/issues/1/notes`, fields: {} })).rejects.toThrow(/inválido|invalid/);
  });

  it('runs a write over the API transport as a form post with the token header', async () => {
    const rt = await api({ 'PUT /api/v4/projects/acme%2Fapp/merge_requests/7': { json: { iid: 7 } } });
    const meta: { code?: number } = {};
    await rt.exec.run({ vcs: 'gitlab', via: 'api', method: 'PUT', endpoint: `projects/${P}/merge_requests/7`, fields: { 'reviewer_ids[]': '77' } }, meta);
    const hit = host?.hits.at(-1);
    expect(hit?.headers['private-token']).toBe(TOKEN);
    expect(decodeURIComponent(hit?.body ?? '')).toBe('reviewer_ids[]=77');
    expect(meta.code).toBe(200);
  });

  it('does not retry a write that failed, and reports the status', async () => {
    const rt = await api({ 'POST /api/v4/projects/acme%2Fapp/issues/101/notes': { status: 503, json: {} } });
    await expect(rt.exec.run({ vcs: 'gitlab', via: 'api', method: 'POST', endpoint: `projects/${P}/issues/101/notes`, fields: { body: 'x' } })).rejects.toMatchObject({ code: 'server', status: 503 });
    expect(host?.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
  });
});

describe('the open issues of a project, whoever they are assigned to', () => {
  const issue = (iid: number, updated: string, labels: string[] = []) => ({ ...F.issues_assigned[0], id: 9000 + iid, iid, title: `Issue ${iid}`, labels, updated_at: updated });
  const route = `GET /api/v4/projects/${P}/issues`;
  const gql = { 'POST /api/graphql': { json: F.workitem_status } };

  it('reads the open issues of the project with an explicit scope, and fills the status', async () => {
    const rt = await api({ [route]: { json: F.issues_assigned }, ...gql });
    const issues = await rt.provider.listIssues({ project: 'acme/app', scope: 'all' });
    expect(host?.log()[0]).toBe(`GET /api/v4/projects/${P}/issues?scope=all&state=opened&order_by=updated_at&per_page=100&page=1`);
    expect(issues.map((i) => [i.project, i.iid, i.status])).toEqual([['acme/app', 102, null], ['acme/app', 101, 'In development']]);
  });

  it('asks one read per label, merges by issue number and orders by the last update', async () => {
    const byLabel: Record<string, unknown[]> = {
      bug: [issue(1, '2026-10-01T10:00:00Z', ['bug']), issue(2, '2026-09-01T10:00:00Z', ['bug', 'ready'])],
      ready: [issue(2, '2026-09-01T10:00:00Z', ['bug', 'ready']), issue(3, '2026-10-02T10:00:00Z', ['ready'])],
    };
    const rt = await api({ [route]: (h: { query: URLSearchParams }) => ({ json: byLabel[h.query.get('labels') ?? ''] ?? [] }), ...gql });
    const issues = await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: ['bug', 'ready', 'Bug'] });
    const reads = host?.log().filter((l) => l.includes('/issues?')) ?? [];
    expect(reads.map((l) => /labels=([^&]*)/.exec(l)?.[1]).sort()).toEqual(['bug', 'ready']);
    expect(issues.map((i) => i.iid)).toEqual([3, 1, 2]);
  });

  it('encodes a scoped label with spaces and colons', async () => {
    const rt = await api({ [route]: { json: [] }, ...gql });
    await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: ['STAGE:: Doing'] });
    expect(host?.hits[0].query.get('labels')).toBe('STAGE:: Doing');
  });

  it('is an empty list for a label nothing carries, and for a label scope with no label (no request)', async () => {
    const rt = await api({ [route]: { json: [] }, ...gql });
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: ['nothing'] })).toEqual([]);
    const before = host?.log().length;
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'labels', labels: [] })).toEqual([]);
    expect(host?.log().length).toBe(before);
  });

  it('cuts at the limit and reads the pages the limit needs', async () => {
    const many = (from: number) => Array.from({ length: 100 }, (_, i) => issue(from + i, `2026-10-01T10:${String(59 - ((from + i) % 60)).padStart(2, '0')}:00Z`));
    const rt = await api({ [route]: (h: { query: URLSearchParams }) => ({ json: many(h.query.get('page') === '1' ? 1 : 101) }), ...gql });
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'all', limit: 100 })).toHaveLength(100);
    expect(host?.log().filter((l) => l.includes('/issues?'))).toHaveLength(1);
    expect(await rt.provider.listIssues({ project: 'acme/app', scope: 'all' })).toHaveLength(200);
  });

  it('accepts the numeric project id and refuses a path that is not a project', async () => {
    const rt = await api({ 'GET /api/v4/projects/7/issues': { json: [issue(5, '2026-10-01T10:00:00Z')] } });
    expect((await rt.provider.listIssues({ project: '7', scope: 'all' })).map((i) => i.iid)).toEqual([5]);
    await expect(rt.provider.listIssues({ project: '../x', scope: 'all' })).rejects.toBeInstanceOf(VcsError);
  });

  it('asks glab for the same endpoint', async () => {
    const calls: string[][] = [];
    const run: CliRun = async (_f, args) => {
      calls.push(args);
      return JSON.stringify([]);
    };
    const rt = buildRuntime(settings({ preference: 'cli' }), { token: () => 'unused', env: () => ({}), run });
    await rt.provider.listIssues({ project: 'acme/app', scope: 'all' });
    expect(calls).toEqual([['api', `projects/${P}/issues?scope=all&state=opened&order_by=updated_at&per_page=100&page=1`]]);
  });
});
