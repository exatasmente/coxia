import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { TEST_STAGES, hostConfig } from './helpers/config';
import { matchStage } from '../src/shared/config/stages';
import { termsFor } from '../src/shared/cycles';
import { resetTerms, setLanguage, setTerms } from '../src/shared/i18n';
import { buildCardReport } from '../src/main/vcs/cards';
import { DEFAULT_STAGES, kindFromWork, stageOf, stagesFor } from '../src/main/vcs/stages';
import { buildRuntime } from '../src/main/vcs/runtime';
import { VCS_CAPS as VCS_CAPS_OF } from '../src/shared/vcsCaps';
import type { StageDef, StageMappingRule } from '../src/shared/config/types';
import type { VcsIssue, VcsMr } from '../src/main/vcs/types';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';
import { fakeGitlabRuntime } from './helpers/vcs';

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-vcs-cards-'));
process.env.CERIMONIAS_DATA_DIR = DATA;
const GL = fixture<Record<string, any>>('gitlab');
const GH = fixture<Record<string, any>>('github');

const NOW = new Date('2026-10-02T12:00:00');
let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
  setLanguage('pt-BR');
  resetTerms();
});
afterAll(() => rmSync(DATA, { recursive: true, force: true }));

const issue = (over: Partial<VcsIssue> = {}): VcsIssue => ({ project: 'acme/app', iid: 1, title: 't', state: 'open', status: null, labels: [], milestone: null, assignees: [], author: null, createdAt: null, updatedAt: null, closedAt: null, webUrl: 'u', ...over });
const mr = (over: Partial<VcsMr> = {}): VcsMr => ({
  project: 'acme/app', iid: 1, title: 't', state: 'open', draft: false, sourceBranch: 'b', targetBranch: 'main', sha: 's', webUrl: 'u', author: 'me', reviewers: [], approvals: null, ci: null, hasConflicts: null, behind: null,
  createdAt: null, updatedAt: null, mergedAt: null, description: '', roles: ['author'], issueRefs: [], ...over,
});

describe('the default stage vocabulary', () => {
  it('every default stage matches its own label, so the card shows what the config matches', () => {
    for (const [kind, list] of Object.entries(DEFAULT_STAGES)) {
      for (const s of list) expect(matchStage(list, s.label)?.id, `${kind}: ${s.label}`).toBe(s.id);
    }
  });

  it.each([
    ['gitlab', 'Failed testing', 'returned'],
    ['gitlab', 'Approved in testing', 'qaApproved'],
    ['gitlab', 'Ready for testing', 'qa'],
    ['gitlab', 'In testing', 'qa'],
    ['gitlab', 'Approved in code review', 'reviewApproved'],
    ['gitlab', 'In code review', 'review'],
    ['gitlab', 'Ready for code review', 'review'],
    ['gitlab', 'In development', 'development'],
    ['gitlab', 'Ready for planning', 'backlog'],
    ['gitlab', 'Open', 'backlog'],
    ['gitlab', 'Done', 'done'],
    ['github', 'in progress', 'development'],
    ['github', 'needs review', 'review'],
    ['github', 'lgtm', 'reviewApproved'],
    ['github', 'ready to test', 'qa'],
    ['github', 'backlog', 'backlog'],
    ['bitbucket', 'new', 'backlog'],
    ['bitbucket', 'open', 'backlog'],
    ['bitbucket', 'on hold', 'backlog'],
    ['bitbucket', 'resolved', 'done'],
    ['bitbucket', 'wontfix', 'done'],
  ] as const)('%s: "%s" is %s', (kind, text, expected) => {
    expect(matchStage(DEFAULT_STAGES[kind], text)?.kind).toBe(expected);
  });

  it('the workspace mapping wins over the defaults, and the defaults only fill an empty one', () => {
    expect(stagesFor('github', TEST_STAGES)).toBe(TEST_STAGES);
    expect(stagesFor('github', [])).toBe(DEFAULT_STAGES.github);
  });

  it('takes the most advanced stage a status or label says, and reads scoped labels', () => {
    const stages = DEFAULT_STAGES.gitlab;
    expect(stageOf(issue({ status: 'In development', labels: ['STAGE:: Code Review OK'] }), [], stages)?.kind).toBe('reviewApproved');
    expect(stageOf(issue({ labels: ['STAGE:: Doing', 'bug'] }), [], stages)?.kind).toBe('development');
    expect(stageOf(issue({ labels: ['stage/ready to test'] }), [], stages)?.kind).toBe('qa');
  });

  it('falls back to what the merge requests are doing when nothing in the issue says', () => {
    expect(kindFromWork(issue(), [])).toBe('backlog');
    expect(kindFromWork(issue({ state: 'closed' }), [])).toBe('done');
    expect(kindFromWork(issue(), [mr({ draft: true })])).toBe('development');
    expect(kindFromWork(issue(), [mr()])).toBe('review');
    expect(kindFromWork(issue(), [mr({ approvals: { approved: true, by: ['x'], changesRequestedBy: [] } })])).toBe('reviewApproved');
    expect(kindFromWork(issue(), [mr({ approvals: { approved: false, by: [], changesRequestedBy: ['y'] } })])).toBe('returned');
    expect(kindFromWork(issue(), [mr({ state: 'merged' })])).toBe('qa');
  });

  it('uses the configured stage of that kind, and none when the config has no such kind', () => {
    expect(stageOf(issue(), [mr({ draft: true })], TEST_STAGES)?.label).toBe('Doing');
    expect(stageOf(issue(), [], TEST_STAGES)).toBeNull();
  });

  it('reads a board:<id> label as that stage: after a matching rule and before a match pattern, and a workspace without one reads as before', () => {
    const stages: StageDef[] = [
      { id: 'todo', label: 'To do', match: ['^todo$'], kind: 'backlog', rank: 1 },
      { id: 'review', label: 'Review', match: ['review'], kind: 'review', rank: 4 },
      { id: 'doing', label: 'Doing', match: ['doing'], kind: 'development', rank: 2 },
    ];
    // the label carries the word "review" for the free-text pattern, but names the todo column
    expect(stageOf(issue({ labels: ['board:todo', 'bug'] }), [], stages)?.id).toBe('todo');
    expect(stageOf(issue({ labels: ['Board:Doing'] }), [], stages)?.id).toBe('doing');
    expect(stageOf(issue({ labels: ['board:review'] }), [], stages)?.id).toBe('review');
    // a rule that matches wins over the board's own label
    const mapping: StageMappingRule[] = [{ provider: 'github', source: 'label', name: '', pattern: '^urgent$', stage: 'doing' }];
    expect(stageOf(issue({ labels: ['board:todo', 'urgent'] }), [], stages, mapping, 'github')?.id).toBe('doing');
    // a rule of another host does not
    expect(stageOf(issue({ labels: ['board:todo', 'urgent'] }), [], stages, mapping, 'gitlab')?.id).toBe('todo');
    // an id nobody has names nothing, and the patterns decide as they always did
    expect(stageOf(issue({ labels: ['board:gone', 'doing'] }), [], stages)?.id).toBe('doing');
    // an issue with no such label reads exactly as before
    expect(stageOf(issue({ labels: ['review'] }), [], stages)?.id).toBe('review');
    expect(stageOf(issue({ labels: ['bug'] }), [], stages)?.id).toBe('todo');
  });
});

describe('the card report from a provider', () => {
  const glRuntime = (extra: Record<string, unknown> = {}) =>
    fakeGitlabRuntime(
      async (endpoint) => {
        if (endpoint === 'user') return GL.user;
        if (endpoint.startsWith('projects/acme%2Fapp/issues?') || endpoint.startsWith('issues?')) return GL.issues_assigned;
        if (endpoint.endsWith('/related_merge_requests')) return [];
        if (endpoint.startsWith('merge_requests?scope=created_by_me')) return GL.mr_list_author;
        if (endpoint.startsWith('merge_requests?scope=all&reviewer_username')) return GL.mr_list_reviewer;
        if (endpoint === 'projects/acme%2Fapp/merge_requests/7') return GL.mr_7;
        if (endpoint === 'projects/acme%2Fuploader/merge_requests/9') return GL.mr_list_reviewer[0];
        if (endpoint in extra) return extra[endpoint];
        throw new Error(`unexpected ${endpoint}`);
      },
      async () => GL.workitem_status,
    );

  const opts = { issueProject: 'acme/app', refPrefix: 'app#', stages: TEST_STAGES, kind: 'gitlab' as const, state: null, now: () => NOW };

  it('builds issue and MR items the cards screens read, linking the MR to its issue by the number in its text', async () => {
    const { report } = await buildCardReport(glRuntime().provider, opts);
    const issues = report.items.filter((i) => i.kind === 'issue');
    const mrs = report.items.filter((i) => i.kind === 'mr');
    expect(issues.map((i) => [i.ref, i.iid, i.stage, i.project])).toEqual([['app#101', 101, 'Doing', 'acme/app'], ['app#102', 102, 'Code Review OK', 'acme/app']]);
    expect(mrs.map((m) => [m.ref, m.iid, m.project, m.issue_refs, m.roles, m.state, m.draft, m.pipeline])).toEqual([
      ['app!7', 7, 'acme/app', ['101'], ['author'], 'opened', true, 'manual'],
      ['uploader!9', 9, 'acme/uploader', [], ['reviewer'], 'opened', false, null],
    ]);
    expect(issues[0].web_url).toBe('https://gitlab.test/acme/app/-/issues/101');
    expect(report.generated_at).toBe(NOW.toISOString());
  });

  it('carries the labels, the milestone and the update time of each issue, which is what a priority is read from', async () => {
    const { report } = await buildCardReport(glRuntime().provider, opts);
    const issues = report.items.filter((i) => i.kind === 'issue');
    expect(issues.map((i) => [i.labels, i.milestone, i.updated_at])).toEqual([
      [['STAGE:: Doing', 'bug'], 'v1.2', '2026-09-30T09:00:00Z'],
      [['STAGE:: Code Review OK'], null, '2026-10-01T09:00:00Z'],
    ]);
    expect(report.items.filter((i) => i.kind === 'mr').every((m) => m.milestone === undefined)).toBe(true);
  });

  it('keeps only the merge requests of the workspace projects when it knows them', async () => {
    const { report } = await buildCardReport(glRuntime().provider, { ...opts, projects: ['ACME/app'] });
    expect(report.items.filter((i) => i.kind === 'mr').map((m) => m.ref)).toEqual(['app!7']);
    const all = await buildCardReport(glRuntime().provider, { ...opts, projects: [] });
    expect(all.report.items.filter((i) => i.kind === 'mr').map((m) => m.ref)).toEqual(['app!7', 'uploader!9']);
  });

  it('says what blocks and what waits, in the workspace language', async () => {
    const { report } = await buildCardReport(glRuntime().provider, opts);
    const mr7 = report.items.find((i) => i.ref === 'app!7');
    const mr9 = report.items.find((i) => i.ref === 'uploader!9');
    expect(mr7?.pending).toEqual(['Ainda em rascunho', 'Pipeline esperando um job manual']);
    expect(mr9?.pending).toEqual(['Revisão pedida a você']);
    setLanguage('en');
    const en = await buildCardReport(glRuntime().provider, opts);
    expect(en.report.items.find((i) => i.ref === 'app!7')?.pending).toEqual(['Still a draft', 'CI waiting for a manual job']);
  });

  it('refs of issues outside the issue project carry the repository, and the prefix applies only to the configured one', async () => {
    const { report } = await buildCardReport(glRuntime().provider, { ...opts, issueProject: null });
    expect(report.items.filter((i) => i.kind === 'issue').map((i) => i.ref)).toEqual(['app#101', 'app#102']);
  });

  it('maps stages with the host defaults when the workspace has none', async () => {
    const { report } = await buildCardReport(glRuntime().provider, { ...opts, stages: [] });
    expect(report.items.filter((i) => i.kind === 'issue').map((i) => i.stage)).toEqual(['In development', 'Review approved']);
  });

  it('reports what changed since the day started, and keeps the baseline for the whole day', async () => {
    const first = await buildCardReport(glRuntime().provider, { ...opts, now: () => new Date('2026-10-01T09:00:00') });
    const next = await buildCardReport(
      fakeGitlabRuntime(
        async (endpoint) => {
          if (endpoint === 'user') return GL.user;
          if (endpoint.startsWith('projects/acme%2Fapp/issues?')) return [{ ...GL.issues_assigned[0], labels: ['STAGE:: Code Review'] }, GL.issues_assigned[1]];
          if (endpoint.startsWith('merge_requests?scope=created_by_me')) return GL.mr_list_author;
          if (endpoint.startsWith('merge_requests?scope=all&reviewer_username')) return [];
          if (endpoint === 'projects/acme%2Fapp/merge_requests/7') return { ...GL.mr_7, draft: false, head_pipeline: { id: 901, status: 'success', web_url: 'x/pipelines/901' } };
          throw new Error(`unexpected ${endpoint}`);
        },
        async () => ({ data: null }),
      ).provider,
      { ...opts, state: first.state, now: () => new Date('2026-10-02T09:00:00') },
    );
    const i101 = next.report.items.find((i) => i.ref === 'app#101');
    expect(i101?.changes).toEqual([{ field: 'stage', from: 'Doing', to: 'Code Review' }]);
    const m7 = next.report.items.find((i) => i.ref === 'app!7');
    expect(m7?.changes).toEqual(expect.arrayContaining([{ field: 'pipeline', from: 'manual', to: 'success' }, { field: 'draft', from: true, to: false }]));
    // the same day again: the baseline is still yesterday's
    const again = await buildCardReport(glRuntime().provider, { ...opts, state: next.state, now: () => new Date('2026-10-02T15:00:00') });
    expect(again.state.baseline).toEqual(first.state.current);
    expect(again.report.items.find((i) => i.ref === 'app#101')?.changes).toEqual([]);
  });

  it('asks the host which MRs belong to an issue no MR text names', async () => {
    const asked: string[] = [];
    const rt = fakeGitlabRuntime(
      async (endpoint) => {
        if (endpoint === 'user') return GL.user;
        if (endpoint.startsWith('projects/acme%2Fapp/issues?')) return [GL.issues_assigned[1]];
        if (endpoint.startsWith('merge_requests?')) return [];
        if (endpoint === 'projects/acme%2Fapp/issues/102/related_merge_requests') {
          asked.push(endpoint);
          return [GL.related_mrs[0]];
        }
        throw new Error(`unexpected ${endpoint}`);
      },
      async () => ({ data: null }),
    );
    const { report } = await buildCardReport(rt.provider, opts);
    expect(asked).toHaveLength(1);
    expect(report.items.find((i) => i.ref === 'app#102')?.stage).toBe('Code Review OK');
  });

  it('works against GitHub: assigned issues, PRs with CI and review state, stage from labels and the PR', async () => {
    const API = '/api/v3';
    host = await startFakeHost({
      [`GET ${API}/user`]: { json: GH.user },
      [`GET ${API}/issues`]: { json: GH.issues_assigned },
      [`GET ${API}/search/issues`]: (h) => ({ json: h.query.get('q')?.includes('review-requested:') ? GH.search_prs_reviewer : GH.search_prs_author }),
      [`GET ${API}/repos/acme/app/pulls/7`]: { json: GH.pull_7 },
      [`GET ${API}/repos/acme/uploader/pulls/9`]: { json: GH.pull_9 },
      [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/check-runs`]: { json: GH.check_runs_failed },
      [`GET ${API}/repos/acme/app/commits/aaaa1111bbbb2222cccc3333dddd4444eeee5555/status`]: { json: GH.combined_empty },
      [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/check-runs`]: { json: GH.check_runs_running },
      [`GET ${API}/repos/acme/uploader/commits/ffff6666ffff6666/status`]: { json: GH.combined_empty },
      [`GET ${API}/repos/acme/app/pulls/7/reviews`]: { json: GH.reviews },
      [`GET ${API}/repos/acme/uploader/pulls/9/reviews`]: { json: [] },
    });
    // The workspace is on GitHub: a pull request is app#7 and the CI of a card is "checks".
    setTerms(termsFor(hostConfig('github', { language: 'pt-BR' }), 'pt-BR'));
    const rt = buildRuntime({ id: 'gh', kind: 'github', host: 'ghe.test', apiUrl: `${host.url}${API}`, user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] }, { token: () => 't', env: () => ({}), sleep: noSleep });
    const { report } = await buildCardReport(rt.provider, { issueProject: null, refPrefix: '', stages: [], kind: 'github', state: null, now: () => NOW });
    const issues = report.items.filter((i) => i.kind === 'issue');
    expect(issues.map((i) => [i.ref, i.stage])).toEqual([['app#12', 'In development']]);
    const pr7 = report.items.find((i) => i.ref === 'app#7');
    expect(pr7).toMatchObject({ issue_refs: ['12'], blockers: ['Checks falharam', 'Conflito com a branch de destino'], pending: ['Ainda em rascunho'], pipeline: 'failed', has_conflicts: true });
    expect(report.items.find((i) => i.ref === 'uploader#9')).toMatchObject({ roles: ['reviewer'], pending: ['Revisão pedida a você', 'Checks em andamento'] });
  });
});

describe('which issues become cards', () => {
  type Call = { fn: 'mine' | 'list'; args: unknown };
  const stub = (kind: 'github' | 'gitlab' | 'bitbucket', issues: VcsIssue[], mrs: VcsMr[] = []) => {
    const calls: Call[] = [];
    const provider = {
      caps: VCS_CAPS_OF[kind],
      listMyIssues: async (args: unknown) => (calls.push({ fn: 'mine', args }), issues.filter((i) => i.assignees.includes('me'))),
      listIssues: async (args: unknown) => (calls.push({ fn: 'list', args }), issues),
      listMyMrs: async () => mrs,
      linkedMrs: async () => [],
    } as unknown as import('../src/main/vcs/types').VcsProvider;
    return { provider, calls };
  };
  const base = (kind: 'github' | 'gitlab' | 'bitbucket') => ({ issueProject: 'acme/app', refPrefix: 'app#', stages: [], kind, state: null, now: () => NOW });
  const issues = [issue({ iid: 1, assignees: ['me'], labels: ['bug'] }), issue({ iid: 2, assignees: ['cy'], labels: ['ready'] }), issue({ iid: 3, labels: [] })];
  const refs = (r: { items: { kind: string; ref: string }[] }) => r.items.filter((i) => i.kind === 'issue').map((i) => i.ref);

  it('asks for the issues assigned to me, exactly as before, when no scope is given or the scope is assigned', async () => {
    for (const extra of [{}, { scope: 'assigned' as const }, { scope: 'assigned' as const, labels: ['bug'] }]) {
      const { provider, calls } = stub('github', issues);
      const { report } = await buildCardReport(provider, { ...base('github'), ...extra });
      expect(calls).toEqual([{ fn: 'mine', args: { project: 'acme/app', limit: 100 } }]);
      expect(refs(report)).toEqual(['app#1']);
    }
  });

  it('asks for every open issue of the issue project, and the refs use the prefix', async () => {
    const { provider, calls } = stub('gitlab', issues);
    const { report } = await buildCardReport(provider, { ...base('gitlab'), scope: 'all' });
    expect(calls).toEqual([{ fn: 'list', args: { project: 'acme/app', scope: 'all', labels: [], limit: 100 } }]);
    expect(refs(report)).toEqual(['app#1', 'app#2', 'app#3']);
  });

  it('asks for the issues with any of the labels, trimmed', async () => {
    const { provider, calls } = stub('github', [issues[1]]);
    const { report } = await buildCardReport(provider, { ...base('github'), scope: 'labels', labels: [' ready ', 'bug', 'Ready'] });
    expect(calls).toEqual([{ fn: 'list', args: { project: 'acme/app', scope: 'labels', labels: ['ready', 'bug'], limit: 100 } }]);
    expect(refs(report)).toEqual(['app#2']);
  });

  it.each([
    ['no issue project', { issueProject: null, scope: 'all' as const }, 'github' as const],
    ['no label', { scope: 'labels' as const, labels: [] }, 'github' as const],
    ['labels on a host whose issues have none', { scope: 'labels' as const, labels: ['bug'] }, 'bitbucket' as const],
  ])('falls back to the assigned issues with %s, never to every issue', async (_why, extra, kind) => {
    const { provider, calls } = stub(kind, issues);
    const { report } = await buildCardReport(provider, { ...base(kind), ...extra });
    expect(calls.map((c) => c.fn)).toEqual(['mine']);
    expect(refs(report)).toEqual(['app#1']);
  });

  it('does not touch the merge requests: they stay the ones I wrote or review, linked by the number in their text', async () => {
    const mine = mr({ iid: 9, issueRefs: [2], roles: ['author'] });
    const { provider } = stub('github', issues, [mine]);
    const assigned = await buildCardReport(provider, base('github'));
    const all = await buildCardReport(provider, { ...base('github'), scope: 'all' });
    expect(assigned.report.items.filter((i) => i.kind === 'mr')).toHaveLength(1);
    expect(all.report.items.filter((i) => i.kind === 'mr').map((m) => [m.ref, m.issue_refs])).toEqual([['app#9', ['2']]]);
  });

  it('gives the cards of the default scope the same fields as before: nothing about the scope or the assignee', async () => {
    const { provider } = stub('github', issues);
    const mine = (await buildCardReport(provider, base('github'))).report.items[0];
    const all = (await buildCardReport(provider, { ...base('github'), scope: 'all' })).report.items.find((i) => i.ref === 'app#1');
    expect(Object.keys(all ?? {}).sort()).toEqual(Object.keys(mine).sort());
  });

  it('a card that appears because the scope widened has no change to report', async () => {
    const first = await buildCardReport(stub('github', issues).provider, base('github'));
    const wider = await buildCardReport(stub('github', issues).provider, { ...base('github'), scope: 'all', state: first.state });
    expect(wider.report.items.filter((i) => i.kind === 'issue').map((i) => i.changes)).toEqual([[], [], []]);
  });

  it('reads the open issues of a GitHub project through the search, over the real provider and a fake host', async () => {
    const API = '/api/v3';
    host = await startFakeHost({
      [`GET ${API}/user`]: { json: GH.user },
      [`GET ${API}/search/issues`]: (h) => ({ json: h.query.get('q')?.startsWith('is:issue') ? { items: GH.issues_assigned.filter((i: { pull_request?: unknown }) => !i.pull_request) } : { items: [] } }),
    });
    const rt = buildRuntime({ id: 'gh', kind: 'github', host: 'ghe.test', apiUrl: `${host.url}${API}`, user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] }, { token: () => 't', env: () => ({}), sleep: noSleep });
    const { report } = await buildCardReport(rt.provider, { issueProject: 'acme/app', refPrefix: 'app#', stages: [], kind: 'github', state: null, now: () => NOW, scope: 'labels', labels: ['bug'] });
    expect(refs(report)).toEqual(['app#12']);
    expect(host.log().some((l) => l.includes('label%3A%22bug%22'))).toBe(true);
  });
});
