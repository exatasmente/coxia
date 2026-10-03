// What a release run reads from the code host that nothing else did: the pull requests aimed at one branch, and the release published for a tag; and the one
// new write, closing an issue. On the three hosts, over a fake host on localhost.
import { afterEach, describe, expect, it } from 'vitest';
import { validateBitbucketCommand } from '../src/main/vcs/bitbucket';
import { VcsError } from '../src/main/vcs/errors';
import { validateGitHubCommand } from '../src/main/vcs/github';
import { validateGitLabCommand } from '../src/main/vcs/gitlab';
import { type VcsRuntime, type VcsSettings, buildRuntime } from '../src/main/vcs/runtime';
import { type FakeHost, noSleep, startFakeHost } from './helpers/fakeHost';

let host: FakeHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

async function make(settings: Omit<VcsSettings, 'apiUrl'>, path: string, routes: Parameters<typeof startFakeHost>[0], token = 't'): Promise<VcsRuntime> {
  host = await startFakeHost(routes);
  return buildRuntime({ ...settings, apiUrl: `${host.url}${path}` }, { token: () => token, env: () => ({}), sleep: noSleep });
}

const GH: Omit<VcsSettings, 'apiUrl'> = { id: 'gh', kind: 'github', host: 'ghe.test', user: '', secretRef: 'x', cli: 'gh', preference: 'api', repos: [] };
const GL: Omit<VcsSettings, 'apiUrl'> = { id: 'gl', kind: 'gitlab', host: 'gitlab.test', user: '', secretRef: 'x', cli: 'glab', preference: 'api', repos: [] };
const BB: Omit<VcsSettings, 'apiUrl'> = { id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', user: 'ana', secretRef: 'x', cli: null, preference: 'api', repos: ['acme/app'] };

const ghPull = (number: number, over: Record<string, unknown> = {}) => ({ number, title: `Thing ${number}`, state: 'open', merged_at: null, draft: false, head: { ref: `feat/${number}`, sha: `${String(number).repeat(8)}aaaa` }, base: { ref: 'release/0.6.0' }, html_url: `https://ghe.test/acme/app/pull/${number}`, user: { login: 'ana' }, body: `Closes #${number + 100}`, ...over });

describe('GitHub', () => {
  it('lists the pull requests aimed at a branch, open and merged, and leaves the ones closed without a merge out', async () => {
    const rt = await make(GH, '/api/v3', {
      'GET /api/v3/repos/acme/app/pulls': (h) => ({ json: h.query.get('state') === 'open' ? [ghPull(3)] : [ghPull(2, { state: 'closed', merged_at: '2026-10-02T10:00:00Z' }), ghPull(1, { state: 'closed' })] }),
    });
    const mrs = await rt.provider.listMrsByTarget('acme/app', 'release/0.6.0');
    // the open ones are asked for on their own, so merged ones cannot push them off the list
    expect(host?.hits.map((h) => [h.query.get('base'), h.query.get('state')]).sort()).toEqual([['release/0.6.0', 'closed'], ['release/0.6.0', 'open']]);
    expect(mrs.map((m) => [m.iid, m.state, m.targetBranch, m.issueRefs])).toEqual([[3, 'open', 'release/0.6.0', [103]], [2, 'merged', 'release/0.6.0', [102]]]);
    expect(mrs[0].sha).toBe('33333333aaaa');
    expect(mrs[0].webUrl).toBe('https://ghe.test/acme/app/pull/3');
  });

  it('keeps every open pull request however many merged ones the branch has', async () => {
    const merged = Array.from({ length: 130 }, (_, i) => ghPull(1000 - i, { state: 'closed', merged_at: '2026-10-02T10:00:00Z' }));
    const rt = await make(GH, '/api/v3', { 'GET /api/v3/repos/acme/app/pulls': (h) => ({ json: h.query.get('state') === 'open' ? [ghPull(7)] : merged.slice((Number(h.query.get('page')) - 1) * 100, Number(h.query.get('page')) * 100) }) });
    const mrs = await rt.provider.listMrsByTarget('acme/app', 'release/0.6.0');
    expect(mrs.filter((m) => m.state === 'open').map((m) => m.iid)).toEqual([7]);
    expect(mrs.filter((m) => m.state === 'merged')).toHaveLength(100);
  });

  it('says whether a pull request comes from a fork, when the list says', async () => {
    const rt = await make(GH, '/api/v3', {
      'GET /api/v3/repos/acme/app/pulls': (h) => ({
        json: h.query.get('state') === 'open' ? [ghPull(3, { head: { ref: 'feat/3', sha: '3'.repeat(40), repo: { full_name: 'someone/app' } }, base: { ref: 'release/0.6.0', repo: { full_name: 'acme/app' } } }), ghPull(4, { head: { ref: 'feat/4', sha: '4'.repeat(40), repo: { full_name: 'acme/app' } }, base: { ref: 'release/0.6.0', repo: { full_name: 'acme/app' } } }), ghPull(5, { head: { ref: 'gone', sha: '5'.repeat(40), repo: null }, base: { ref: 'release/0.6.0', repo: { full_name: 'acme/app' } } })] : [],
      }),
    });
    expect((await rt.provider.listMrsByTarget('acme/app', 'release/0.6.0')).map((m) => [m.iid, m.fromFork])).toEqual([[3, true], [4, false], [5, true]]);
  });

  it('counts an approval for a merge only when a member of the project gave it on the commit the pull request is at, and nobody of them asks for changes', async () => {
    const sha = 'a'.repeat(40);
    const reviews = (list: Record<string, unknown>[]) => ({
      [`GET /api/v3/repos/acme/app/pulls/9`]: { json: ghPull(9, { head: { ref: 'f', sha, repo: { full_name: 'acme/app' } }, base: { ref: 'main', repo: { full_name: 'acme/app' } } }) },
      [`GET /api/v3/repos/acme/app/pulls/9/reviews`]: { json: list },
      [`GET /api/v3/repos/acme/app/commits/${sha}/check-runs`]: { json: { check_runs: [] } },
      [`GET /api/v3/repos/acme/app/commits/${sha}/status`]: { json: { state: 'success', statuses: [] } },
    });
    const r = (user: string, state: string, commit_id: string, author_association: string, at: string) => ({ user: { login: user }, state, commit_id, author_association, submitted_at: at });
    const approvals = async (list: Record<string, unknown>[]) => {
      const rt = await make(GH, '/api/v3', reviews(list));
      const mr = await rt.provider.getMr('acme/app', 9, { approvals: true });
      await host?.close();
      return mr.approvals;
    };
    // a member, on the head
    expect(await approvals([r('ana', 'APPROVED', sha, 'MEMBER', '2026-10-03T10:00:00Z')])).toMatchObject({ approved: true, onHead: true });
    // approved on an older commit: it is an approval, but not of this head
    expect(await approvals([r('ana', 'APPROVED', 'b'.repeat(40), 'OWNER', '2026-10-03T10:00:00Z')])).toMatchObject({ approved: true, onHead: false });
    // a stranger's approval does not count for a merge
    expect(await approvals([r('eve', 'APPROVED', sha, 'NONE', '2026-10-03T10:00:00Z')])).toMatchObject({ approved: true, onHead: false });
    expect(await approvals([r('eve', 'APPROVED', sha, 'CONTRIBUTOR', '2026-10-03T10:00:00Z')])).toMatchObject({ onHead: false });
    // a member who asks for changes after approving blocks it; a stranger who asks for changes does not
    expect(await approvals([r('ana', 'APPROVED', sha, 'COLLABORATOR', '2026-10-03T10:00:00Z'), r('bob', 'CHANGES_REQUESTED', sha, 'MEMBER', '2026-10-03T11:00:00Z')])).toMatchObject({ onHead: false });
    expect(await approvals([r('ana', 'APPROVED', sha, 'COLLABORATOR', '2026-10-03T10:00:00Z'), r('eve', 'CHANGES_REQUESTED', sha, 'NONE', '2026-10-03T11:00:00Z')])).toMatchObject({ onHead: true });
    // dismissed
    expect(await approvals([r('ana', 'APPROVED', sha, 'MEMBER', '2026-10-03T10:00:00Z'), r('ana', 'DISMISSED', sha, 'MEMBER', '2026-10-03T11:00:00Z')])).toMatchObject({ approved: false, onHead: false });
  });

  it('treats checks nobody could read as still running, never as none', async () => {
    const sha = 'c'.repeat(40);
    const base = { [`GET /api/v3/repos/acme/app/pulls/9`]: { json: ghPull(9, { head: { ref: 'f', sha }, base: { ref: 'main' } }) } };
    const ok = await make(GH, '/api/v3', { ...base, [`GET /api/v3/repos/acme/app/commits/${sha}/check-runs`]: { json: { check_runs: [] } }, [`GET /api/v3/repos/acme/app/commits/${sha}/status`]: { json: { state: 'pending', statuses: [] } } });
    expect((await ok.provider.getMr('acme/app', 9)).ci).toBeNull();
    await host?.close();
    const broken = await make(GH, '/api/v3', { ...base, [`GET /api/v3/repos/acme/app/commits/${sha}/check-runs`]: { status: 500, json: { message: 'boom' } }, [`GET /api/v3/repos/acme/app/commits/${sha}/status`]: { json: { state: 'success', statuses: [{}] } } });
    expect((await broken.provider.getMr('acme/app', 9)).ci).toMatchObject({ status: 'pending', raw: 'unreadable' });
  });

  it('refuses a branch name that is not one, and a project that is not one, without asking the host', async () => {
    const rt = await make(GH, '/api/v3', {});
    await expect(rt.provider.listMrsByTarget('acme/app', '../x')).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.listMrsByTarget('../x/y', 'main')).rejects.toBeInstanceOf(VcsError);
    await expect(rt.provider.getRelease('acme/app', 'v1 --x')).rejects.toBeInstanceOf(VcsError);
    expect(host?.hits).toHaveLength(0);
  });

  it('reads the release of a tag, and says there is none for a tag the host does not know or only has as a draft', async () => {
    const rt = await make(GH, '/api/v3', {
      'GET /api/v3/repos/acme/app/releases/tags/v0.6.0-beta.1': { json: { tag_name: 'v0.6.0-beta.1', name: 'v0.6.0-beta.1', draft: false, prerelease: true, published_at: '2026-10-03T12:00:00Z', html_url: 'https://ghe.test/acme/app/releases/tag/v0.6.0-beta.1' } },
    });
    expect(await rt.provider.getRelease('acme/app', 'v0.6.0-beta.1')).toEqual({ tag: 'v0.6.0-beta.1', name: 'v0.6.0-beta.1', draft: false, prerelease: true, publishedAt: '2026-10-03T12:00:00Z', webUrl: 'https://ghe.test/acme/app/releases/tag/v0.6.0-beta.1' });
    expect(await rt.provider.getRelease('acme/app', 'v0.6.0-beta.2')).toBeNull();
  });

  it('plans closing an issue as one PATCH that sets the state, and the list of writes takes it and nothing else on that address', async () => {
    const rt = await make(GH, '/api/v3', {});
    const [close] = await rt.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 });
    expect(close).toEqual({ vcs: 'github', via: 'api', method: 'PATCH', endpoint: 'repos/acme/app/issues/12', fields: {}, json: '{"state":"closed"}' });
    expect(() => validateGitHubCommand(close)).not.toThrow();
    expect(() => validateGitHubCommand({ ...close, json: '{"state":"closed","title":"x"}' })).toThrow();
    await expect(rt.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 0 })).rejects.toBeInstanceOf(VcsError);
  });
});

describe('GitLab', () => {
  const glMr = (iid: number, state: string, over: Record<string, unknown> = {}) => ({ iid, title: `Thing ${iid}`, state, source_branch: `feat/${iid}`, target_branch: 'release/0.6.0', sha: `${String(iid).repeat(8)}bbbb`, web_url: `https://gitlab.test/acme/app/-/merge_requests/${iid}`, author: { username: 'ana' }, description: `Closes #${iid + 100}`, references: { full: `acme/app!${iid}` }, ...over });

  it('lists the merge requests aimed at a branch, open and merged, and leaves the closed ones out', async () => {
    const rt = await make(GL, '/api/v4', { 'GET /api/v4/projects/acme%2Fapp/merge_requests': (h) => ({ json: h.query.get('state') === 'opened' ? [glMr(5, 'opened', { source_project_id: 1, target_project_id: 2 })] : [glMr(4, 'merged', { merged_at: '2026-10-02T10:00:00Z', source_project_id: 2, target_project_id: 2 })] }) });
    const mrs = await rt.provider.listMrsByTarget('acme/app', 'release/0.6.0');
    expect(host?.hits.map((h) => [h.query.get('target_branch'), h.query.get('state')]).sort()).toEqual([['release/0.6.0', 'merged'], ['release/0.6.0', 'opened']]);
    expect(mrs.map((m) => m.fromFork)).toEqual([true, false]);
    expect(mrs.map((m) => [m.project, m.iid, m.state])).toEqual([['acme/app', 5, 'open'], ['acme/app', 4, 'merged']]);
  });

  it('reads the release of a tag: published, upcoming (not yet) or unknown', async () => {
    const rt = await make(GL, '/api/v4', {
      'GET /api/v4/projects/acme%2Fapp/releases/v0.6.0': { json: { tag_name: 'v0.6.0', name: 'Version 0.6.0', released_at: '2026-10-03T12:00:00Z', upcoming_release: false, _links: { self: 'https://gitlab.test/acme/app/-/releases/v0.6.0' } } },
      'GET /api/v4/projects/acme%2Fapp/releases/v0.7.0': { json: { tag_name: 'v0.7.0', released_at: '2026-12-01T00:00:00Z', upcoming_release: true } },
    });
    expect(await rt.provider.getRelease('acme/app', 'v0.6.0')).toMatchObject({ draft: false, prerelease: false, publishedAt: '2026-10-03T12:00:00Z', name: 'Version 0.6.0', webUrl: 'https://gitlab.test/acme/app/-/releases/v0.6.0' });
    expect(await rt.provider.getRelease('acme/app', 'v0.7.0')).toMatchObject({ draft: true, publishedAt: null });
    expect(await rt.provider.getRelease('acme/app', 'v0.8.0')).toBeNull();
  });

  it('plans closing an issue as one PUT that sets the state event', async () => {
    const rt = await make(GL, '/api/v4', {});
    const [close] = await rt.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 });
    expect(close).toEqual({ vcs: 'gitlab', via: 'api', method: 'PUT', endpoint: 'projects/acme%2Fapp/issues/12', fields: { state_event: 'close' } });
    expect(() => validateGitLabCommand(close)).not.toThrow();
  });
});

describe('Bitbucket', () => {
  const bbPr = (id: number, state: string) => ({ id, title: `Thing ${id}`, state, source: { branch: { name: `feat/${id}` }, commit: { hash: `${String(id).repeat(8)}cccc` } }, destination: { branch: { name: 'release/0.6.0' }, repository: { full_name: 'acme/app' } }, links: { html: { href: `https://bitbucket.org/acme/app/pull-requests/${id}` } }, author: { uuid: '{1}', nickname: 'ana' }, description: `Fixes #${id}` });

  it('lists the pull requests aimed at a branch with the host\'s own query, open and merged', async () => {
    const rt = await make(BB, '/2.0', { 'GET /2.0/repositories/acme/app/pullrequests': (h) => ({ json: { values: h.query.get('q')?.includes('state="OPEN"') ? [{ ...bbPr(9, 'OPEN'), source: { branch: { name: 'feat/9' }, commit: { hash: '9'.repeat(12) }, repository: { full_name: 'someone/app' } } }] : [bbPr(8, 'MERGED')] } }) });
    const mrs = await rt.provider.listMrsByTarget('acme/app', 'release/0.6.0');
    expect(host?.hits.map((h) => h.query.get('q')).sort()).toEqual(['destination.branch.name="release/0.6.0" AND state="MERGED"', 'destination.branch.name="release/0.6.0" AND state="OPEN"']);
    expect(mrs[0].fromFork).toBe(true);
    expect(mrs.map((m) => [m.iid, m.state, m.targetBranch])).toEqual([[9, 'open', 'release/0.6.0'], [8, 'merged', 'release/0.6.0']]);
    await expect(rt.provider.listMrsByTarget('acme/app', 'x" OR state="DECLINED')).rejects.toBeInstanceOf(VcsError);
  });

  it('has no releases: it says there is none and asks the host nothing', async () => {
    const rt = await make(BB, '/2.0', {});
    expect(await rt.provider.getRelease('acme/app', 'v0.6.0')).toBeNull();
    expect(host?.hits).toHaveLength(0);
  });

  it('plans closing an issue as one PUT of the closed state', async () => {
    const rt = await make(BB, '/2.0', {});
    const [close] = await rt.provider.planWrite({ op: 'closeIssue', project: 'acme/app', iid: 12 });
    expect(close).toEqual({ vcs: 'bitbucket', via: 'api', method: 'PUT', endpoint: 'repositories/acme/app/issues/12', fields: {}, json: '{"state":"closed"}' });
    expect(() => validateBitbucketCommand(close)).not.toThrow();
  });
});
