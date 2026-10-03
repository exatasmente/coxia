import { cleanLabels } from '../../shared/cardScope';
import { t } from '../../shared/i18n';
import { VCS_CAPS } from '../../shared/vcsCaps';
import { VcsError } from './errors';
import type { RestTransport } from './transport';
import type {
  MyMrOptions,
  VcsApprovals,
  VcsCaps,
  VcsCi,
  VcsCiJob,
  VcsCiRun,
  VcsCiStatus,
  VcsCommand,
  VcsComment,
  VcsFileChange,
  VcsIssue,
  VcsMember,
  VcsMr,
  VcsProvider,
  VcsThread,
  VcsUser,
  VcsWriteOp,
} from './types';
import { ISSUE_TITLE_MAX, checkIid, checkLabel, checkTitle, enc, iso, issueRefsOf, noteNum, num, pool, worstCi } from './util';

// GitHub (github.com and GitHub Enterprise Server): REST for everything, GraphQL for what REST cannot say or do: whether a review
// thread is resolved, resolving it, and the draft state of a pull request. Issues are GitHub issues (no separate workflow status:
// the card stage comes from labels and from the pull request).

export const GITHUB_CAPS: VcsCaps = VCS_CAPS.github;

/** The GraphQL writes a GitHub proposal may carry: resolve a review thread, mark a pull request ready or back to draft. */
export const GITHUB_MUTATION =
  /^mutation \{ (?:resolveReviewThread\(input: \{ threadId: "[\w=-]{8,}" \}\) \{ thread \{ isResolved \} \}|(?:markPullRequestReadyForReview|convertPullRequestToDraft)\(input: \{ pullRequestId: "[\w=-]{8,}" \}\) \{ pullRequest \{ isDraft \} \}) \}$/;

interface GhUser {
  id: number;
  login: string;
  name?: string | null;
  html_url?: string;
  type?: string;
}
interface GhIssue {
  number: number;
  title: string;
  state: string;
  labels?: ({ name: string } | string)[];
  milestone?: { title: string } | null;
  assignees?: { login: string }[];
  user?: { login: string } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  html_url: string;
  repository_url?: string;
  pull_request?: unknown;
  body?: string | null;
  draft?: boolean;
}
interface GhPull {
  number: number;
  node_id?: string;
  title: string;
  state: string;
  merged?: boolean;
  merged_at?: string | null;
  draft?: boolean;
  head: { ref: string; sha: string; repo?: { full_name?: string } | null };
  base: { ref: string; repo?: { full_name?: string } | null };
  html_url: string;
  user?: { login: string } | null;
  requested_reviewers?: GhUser[];
  mergeable?: boolean | null;
  mergeable_state?: string;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
}
interface GhComment {
  id: number;
  body: string;
  created_at: string;
  user?: { login: string } | null;
  html_url?: string;
}
interface GqlThread {
  id: string;
  isResolved: boolean;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  comments: { nodes: { databaseId: number; author?: { login: string } | null; body: string; createdAt: string; url?: string }[] };
}

const user = (u: GhUser): VcsUser => ({ id: u.id, username: u.login, name: u.name ?? u.login, webUrl: u.html_url ?? null });
const repoFromUrl = (url?: string): string => (url ? url.split('/').slice(-2).join('/') : '');

const CHECK: Record<string, VcsCiStatus> = {
  success: 'success',
  neutral: 'success',
  skipped: 'skipped',
  failure: 'failed',
  timed_out: 'failed',
  startup_failure: 'failed',
  cancelled: 'canceled',
  action_required: 'manual',
  stale: 'canceled',
};

/** One check run as a normalized state: unfinished runs are running (or pending while queued), finished ones by their conclusion. */
export function checkState(status: string, conclusion: string | null | undefined): VcsCiStatus {
  if (status !== 'completed') return status === 'queued' || status === 'waiting' || status === 'requested' || status === 'pending' ? 'pending' : 'running';
  return CHECK[conclusion ?? ''] ?? 'pending';
}

export interface GitHubOptions {
  id: string;
  host: string;
  transport: RestTransport;
}

/** How many pages of open pull requests of one branch are read (100 each): more than a release can have. */
const OPEN_PAGES = 5;

const checkSha = (sha: string): string => {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new VcsError('invalid', { detail: sha });
  return sha;
};

const checkBranch = (name: string): string => {
  if (!/^[\w][\w./-]{0,200}$/.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock')) throw new VcsError('invalid', { detail: name });
  return name;
};

const checkRepo = (project: string): string => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(project) || project.split('/').some((s) => /^\.+$/.test(s))) throw new VcsError('invalid', { detail: project });
  return project;
};

export function createGitHubProvider(o: GitHubOptions): VcsProvider {
  const tr = o.transport;
  const web = `https://${o.host}`;
  let me: Promise<VcsUser> | null = null;
  const repo = (project: string): string => `repos/${checkRepo(project)}`;

  const currentUser = (): Promise<VcsUser> => {
    me ??= tr.get<GhUser>('user').then(user);
    me.catch(() => {
      me = null;
    });
    return me;
  };

  const labelNames = (l: GhIssue['labels']): string[] => (l ?? []).map((x) => (typeof x === 'string' ? x : x.name));

  const issueOf = (i: GhIssue, project: string): VcsIssue => ({
    project,
    iid: i.number,
    title: i.title,
    state: i.state === 'closed' ? 'closed' : 'open',
    status: null,
    labels: labelNames(i.labels),
    milestone: i.milestone?.title ?? null,
    assignees: (i.assignees ?? []).map((a) => a.login),
    author: i.user?.login ?? null,
    createdAt: iso(i.created_at),
    updatedAt: iso(i.updated_at),
    closedAt: iso(i.closed_at),
    webUrl: i.html_url,
    body: i.body ?? null,
  });

  const mrOf = (pr: GhPull, project: string, roles: VcsMr['roles'] = []): VcsMr => ({
    project,
    iid: pr.number,
    title: pr.title,
    state: pr.merged || pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
    draft: Boolean(pr.draft),
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    sha: pr.head.sha,
    webUrl: pr.html_url,
    author: pr.user?.login ?? '',
    reviewers: (pr.requested_reviewers ?? []).map(user),
    approvals: null,
    ci: null,
    hasConflicts: typeof pr.mergeable === 'boolean' ? !pr.mergeable : pr.mergeable_state === 'dirty' ? true : null,
    behind: null,
    createdAt: iso(pr.created_at),
    updatedAt: iso(pr.updated_at),
    mergedAt: iso(pr.merged_at),
    description: pr.body ?? '',
    roles,
    ...(pr.head.repo !== undefined && pr.base.repo !== undefined ? { fromFork: !pr.head.repo || !pr.base.repo || pr.head.repo.full_name !== pr.base.repo.full_name } : {}),
    issueRefs: issueRefsOf(`${pr.title}\n${pr.body ?? ''}`, pr.head.ref),
  });

  const commentOf = (c: GhComment, project: string, kind: 'issue' | 'mr', iid: number): VcsComment => ({
    id: c.id,
    author: c.user?.login ?? 'ghost',
    body: c.body,
    createdAt: c.created_at,
    system: false,
    webUrl: c.html_url ?? `${web}/${project}/${kind === 'issue' ? 'issues' : 'pull'}/${iid}#issuecomment-${c.id}`,
  });

  async function ciOf(project: string, sha: string): Promise<VcsCi | null> {
    if (!sha) return null;
    // A read that fails is not "no checks": the state is unknown, which counts as still running (a merge must not go ahead on a CI nobody could read).
    let unreadable = false;
    const [checks, combined] = await Promise.all([
      tr.get<{ check_runs?: { status: string; conclusion: string | null }[] }>(`${repo(project)}/commits/${sha}/check-runs?per_page=100`).catch(() => {
        unreadable = true;
        return { check_runs: [] };
      }),
      tr.get<{ state?: string; statuses?: unknown[] }>(`${repo(project)}/commits/${sha}/status`).catch(() => {
        unreadable = true;
        return { state: 'pending', statuses: [] };
      }),
    ]);
    if (unreadable) return { status: 'pending', raw: 'unreadable', runId: null, webUrl: `${web}/${project}/commit/${sha}/checks` };
    const states: VcsCiStatus[] = (checks.check_runs ?? []).map((c) => checkState(c.status, c.conclusion));
    // The legacy commit status API reports "pending" for a commit with no statuses at all: only count it when there are some.
    if ((combined.statuses ?? []).length) states.push(combined.state === 'success' ? 'success' : combined.state === 'pending' ? 'pending' : 'failed');
    const status = worstCi(states);
    return status ? { status, raw: status, runId: null, webUrl: `${web}/${project}/commit/${sha}/checks` } : null;
  }

  // GitHub's `author_association` says how the reviewer relates to the repository (owner, member, collaborator: an invitation, or an organisation seat), which is NOT the same
  // as a right to write to it: it is the best the reviews carry, and the docs say so.
  const MEMBER = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
  const REVIEW_PAGES = 3;

  async function approvalsOf(project: string, iid: number, head = ''): Promise<VcsApprovals> {
    const reviews = await tr.pages<{ user?: { login: string } | null; state: string; submitted_at?: string; commit_id?: string; author_association?: string }>(`${repo(project)}/pulls/${iid}/reviews`, { maxPages: REVIEW_PAGES });
    // Reviews beyond the pages read were not seen: what a merge may rely on is then not known, and `onHead` is false (the plain approval is still reported).
    const truncated = reviews.length >= REVIEW_PAGES * 100;
    const latest = new Map<string, { state: string; commit: string; member: boolean }>();
    for (const r of [...reviews].sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))) {
      const login = r.user?.login;
      if (!login) continue;
      if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') latest.set(login, { state: r.state, commit: r.commit_id ?? '', member: MEMBER.has(r.author_association ?? '') });
      else if (r.state === 'DISMISSED') latest.delete(login);
    }
    const by = [...latest].filter(([, s]) => s.state === 'APPROVED').map(([l]) => l);
    const changes = [...latest].filter(([, s]) => s.state === 'CHANGES_REQUESTED').map(([l]) => l);
    // What a merge may rely on: an approval by a member of the project, given on the commit the pull request is at now, with no member asking for changes.
    const standing = [...latest.values()].filter((s) => s.member && s.state === 'APPROVED' && !!head && s.commit.toLowerCase() === head.toLowerCase());
    const blocked = [...latest.values()].some((s) => s.member && s.state === 'CHANGES_REQUESTED');
    return { approved: by.length > 0 && changes.length === 0, by, changesRequestedBy: changes, onHead: !truncated && standing.length > 0 && !blocked };
  }

  async function gql<T>(query: string): Promise<T> {
    const r = await tr.graphql<{ data?: T; errors?: { message: string }[] }>(query);
    if (r.errors?.length || !r.data) throw new VcsError('invalid', { detail: r.errors?.[0]?.message ?? 'GraphQL' });
    return r.data;
  }

  const threadsQuery = (project: string, iid: number): string => {
    const [owner, name] = checkRepo(project).split('/');
    // i18n-ignore: query language of the code host
    return `query { repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${checkIid(iid)}) { reviewThreads(first: 100) { nodes { id isResolved path line originalLine comments(first: 50) { nodes { databaseId author { login } body createdAt url } } } } } } }`;
  };

  const threadOf = (th: GqlThread, project: string, iid: number): VcsThread => ({
    id: th.id,
    resolvable: true,
    resolved: th.isResolved,
    path: th.path ?? null,
    line: th.line ?? th.originalLine ?? null,
    notes: th.comments.nodes.map((c) => ({ id: c.databaseId, author: c.author?.login ?? 'ghost', body: c.body, createdAt: c.createdAt, system: false, webUrl: c.url ?? `${web}/${project}/pull/${iid}#discussion_r${c.databaseId}` })),
  });

  const searchRaw = async (q: string, limit = 100, maxPages = Math.ceil(limit / 100) || 1, order = ''): Promise<GhIssue[]> => tr.pages<GhIssue>(`search/issues?q=${enc(q)}${order}`, { pick: (b) => (b as { items?: GhIssue[] }).items ?? [], maxPages });

  const provider: VcsProvider = {
    kind: 'github',
    id: o.id,
    host: o.host,
    transport: tr.kind,
    caps: GITHUB_CAPS,
    currentUser,

    async listMyIssues(opts = {}) {
      const rows = opts.project
        ? await tr.pages<GhIssue>(`${repo(opts.project)}/issues?assignee=${enc((await currentUser()).username)}&state=open&sort=updated`, { maxPages: 2 })
        : await tr.pages<GhIssue>('issues?filter=assigned&state=open&sort=updated', { maxPages: 2 });
      return rows
        .filter((i) => !i.pull_request)
        .slice(0, opts.limit ?? 200)
        .map((i) => issueOf(i, opts.project ?? repoFromUrl(i.repository_url)));
    },

    async listIssues(opts) {
      const project = checkRepo(opts.project);
      const labels = opts.scope === 'labels' ? cleanLabels(opts.labels ?? []).map((l) => l.replace(/["\\]/g, '')) : [];
      if (opts.scope === 'labels' && !labels.length) return [];
      // The issues endpoint hands back pull requests too, which would spend the page budget; `is:issue` leaves them out of the count.
      // A comma inside one `label:` qualifier is an OR in the search syntax, while `labels=` of the endpoint is an AND.
      // i18n-ignore: query language of the code host
      const q = `is:issue is:open repo:${project}${labels.length ? ` label:${labels.map((l) => `"${l}"`).join(',')}` : ''}`;
      const rows = await searchRaw(q, opts.limit ?? 200, 2, '&sort=updated&order=desc');
      return rows.filter((i) => !i.pull_request).slice(0, opts.limit ?? 200).map((i) => issueOf(i, project));
    },

    async getIssue(project, iid) {
      return issueOf(await tr.get<GhIssue>(`${repo(project)}/issues/${checkIid(iid)}`, `#${iid}`), project);
    },

    async issueStatuses() {
      return new Map();
    },

    async listIssueComments(project, iid) {
      const rows = await tr.pages<GhComment>(`${repo(project)}/issues/${checkIid(iid)}/comments`, { maxPages: 5 });
      return rows.map((c) => commentOf(c, project, 'issue', iid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async searchIssues(project, q) {
      // i18n-ignore: query language of the code host
      const rows = await searchRaw(`is:issue repo:${checkRepo(project)} in:title ${q.text} created:>=${q.createdAfter.slice(0, 10)}`, 20);
      return rows.filter((i) => !i.pull_request).map((i) => issueOf(i, project));
    },

    async listMyMrs(opts: MyMrOptions = {}) {
      const roles = opts.roles ?? ['author', 'reviewer'];
      const who = (await currentUser()).username;
      const found = new Map<string, { project: string; number: number; roles: VcsMr['roles'] }>();
      const add = (rows: GhIssue[], role: 'author' | 'reviewer') => {
        for (const r of rows) {
          const project = repoFromUrl(r.repository_url);
          const key = `${project}#${r.number}`;
          const had = found.get(key);
          if (had) had.roles.push(role);
          else found.set(key, { project, number: r.number, roles: [role] });
        }
      };
      // i18n-ignore: query language of the code host
      if (roles.includes('author')) add(await searchRaw(`is:pr is:open author:${who}`), 'author');
      // i18n-ignore: query language of the code host
      if (roles.includes('reviewer')) add(await searchRaw(`is:pr is:open review-requested:${who}`), 'reviewer');
      const list = [...found.values()].slice(0, opts.limit ?? 100);
      // The search result has no branch, sha or mergeable flag: one pull request read each (a few at a time).
      const out = await pool(list, 4, async (f) => {
        try {
          const pr = await tr.get<GhPull>(`${repo(f.project)}/pulls/${f.number}`);
          const mr = mrOf(pr, f.project, f.roles);
          if (!opts.detail) return mr;
          const [ci, approvals] = await Promise.all([ciOf(f.project, mr.sha), approvalsOf(f.project, f.number, mr.sha)]);
          return { ...mr, ci, approvals };
        } catch (e) {
          console.error(`[vcs:github] ${f.project}#${f.number}`, (e as Error).message);
          return null;
        }
      });
      return out.filter((m): m is VcsMr => m !== null);
    },

    async getMr(project, iid, opts = {}) {
      checkIid(iid);
      const pr = await tr.get<GhPull>(`${repo(project)}/pulls/${iid}`, `#${iid}`);
      const mr = mrOf(pr, project);
      const [ci, approvals, behind] = await Promise.all([
        ciOf(project, mr.sha),
        opts.approvals ? approvalsOf(project, iid, mr.sha) : Promise.resolve(null),
        opts.behind ? tr.get<{ behind_by?: number }>(`${repo(project)}/compare/${enc(mr.targetBranch)}...${mr.sha}`).then((c) => c.behind_by ?? null, () => null) : Promise.resolve(null),
      ]);
      return { ...mr, ci, approvals, behind };
    },

    async linkedMrs(project, iid) {
      checkIid(iid);
      const events = await tr.pages<{ event?: string; source?: { issue?: { number: number; pull_request?: unknown; repository?: { full_name: string } } } }>(`${repo(project)}/issues/${iid}/timeline`, { maxPages: 3 });
      const numbers = new Set<number>();
      for (const e of events) {
        const src = e.source?.issue;
        if (e.event === 'cross-referenced' && src?.pull_request && src.repository?.full_name === project) numbers.add(src.number);
      }
      const mrs = await pool([...numbers], 4, async (n) => provider.getMr(project, n).catch(() => null));
      return mrs.filter((m): m is VcsMr => m !== null).map((m) => ({ ...m, issueRefs: [...new Set([...m.issueRefs, iid])] }));
    },

    async searchMrs(project, q) {
      // i18n-ignore: query language of the code host
      const rows = await searchRaw(`is:pr repo:${checkRepo(project)} in:title ${q.text} created:>=${q.createdAfter.slice(0, 10)}`, 20);
      return rows.map(
        (r): VcsMr => ({
          project,
          iid: r.number,
          title: r.title,
          state: r.state === 'closed' ? 'closed' : 'open',
          draft: Boolean(r.draft),
          sourceBranch: '',
          targetBranch: '',
          sha: '',
          webUrl: r.html_url,
          author: r.user?.login ?? '',
          reviewers: [],
          approvals: null,
          ci: null,
          hasConflicts: null,
          behind: null,
          createdAt: iso(r.created_at),
          updatedAt: iso(r.updated_at),
          mergedAt: null,
          description: r.body ?? '',
          roles: [],
          issueRefs: [],
        }),
      );
    },

    async listMrsByTarget(project, branch, opts = {}) {
      const base = `${repo(project)}/pulls?base=${enc(checkBranch(branch))}`;
      // The open ones are asked for by themselves (every one of them, up to a bound), so a branch with many merged or closed pull requests cannot push an open one off the list.
      const [open, closed] = await Promise.all([
        tr.pages<GhPull>(`${base}&state=open&sort=updated&direction=desc`, { maxPages: OPEN_PAGES }),
        tr.pages<GhPull>(`${base}&state=closed&sort=updated&direction=desc`, { maxPages: Math.ceil((opts.limit ?? 100) / 100) || 1 }),
      ]);
      return [...open.map((pr) => mrOf(pr, project)), ...closed.map((pr) => mrOf(pr, project)).filter((m) => m.state === 'merged').slice(0, opts.limit ?? 100)];
    },

    async getRelease(project, tag) {
      try {
        const r = await tr.get<{ tag_name: string; name?: string | null; draft?: boolean; prerelease?: boolean; published_at?: string | null; html_url: string }>(`${repo(project)}/releases/tags/${enc(checkBranch(tag))}`);
        return { tag: r.tag_name, name: r.name || r.tag_name, draft: Boolean(r.draft), prerelease: Boolean(r.prerelease), publishedAt: iso(r.published_at), webUrl: r.html_url };
      } catch (e) {
        // A tag with no published release (a draft is not shown here either) is a 404: it has none.
        if (e instanceof VcsError && e.code === 'not_found') return null;
        throw e;
      }
    },

    async listMrCommits(project, iid) {
      const rows = await tr.get<{ sha: string; commit: { committer?: { date?: string }; author?: { date?: string } } }[]>(`${repo(project)}/pulls/${checkIid(iid)}/commits?per_page=50`);
      return rows.map((c) => ({ sha: c.sha, date: c.commit.committer?.date ?? c.commit.author?.date ?? '' }));
    },

    async listMrChanges(project, iid) {
      const rows = await tr.pages<{ filename: string; patch?: string }>(`${repo(project)}/pulls/${checkIid(iid)}/files`, { maxPages: 10 });
      return rows.map((f): VcsFileChange => ({ path: f.filename, diff: f.patch ?? '' }));
    },

    async listMrCi(project, iid) {
      const pr = await tr.get<GhPull>(`${repo(project)}/pulls/${checkIid(iid)}`);
      const r = await tr.get<{ workflow_runs?: { id: number; status: string; conclusion: string | null; created_at: string; html_url?: string }[] }>(`${repo(project)}/actions/runs?head_sha=${pr.head.sha}&per_page=50`);
      return (r.workflow_runs ?? []).map((w): VcsCiRun => ({ id: w.id, status: w.status === 'completed' ? (w.conclusion ?? 'completed') : w.status, createdAt: w.created_at, webUrl: w.html_url ?? null }));
    },

    async listCiJobs(project, runId) {
      const r = await tr.get<{ jobs?: { id: number; name: string; status: string; conclusion: string | null; created_at?: string; started_at?: string | null; workflow_name?: string }[] }>(`${repo(project)}/actions/runs/${num(runId)}/jobs?per_page=100`);
      return (r.jobs ?? []).map((j): VcsCiJob => ({ id: j.id, name: j.name, stage: j.workflow_name ?? '', status: j.status === 'completed' ? (j.conclusion ?? 'completed') : j.status, createdAt: iso(j.created_at), startedAt: iso(j.started_at), runId }));
    },

    async getCiJob(project, jobId) {
      const j = await tr.get<{ id: number; name: string; status: string; conclusion: string | null; created_at?: string; started_at?: string | null; run_id?: number; workflow_name?: string }>(`${repo(project)}/actions/jobs/${num(jobId)}`);
      return { id: j.id, name: j.name, stage: j.workflow_name ?? '', status: j.status === 'completed' ? (j.conclusion ?? 'completed') : j.status, createdAt: iso(j.created_at), startedAt: iso(j.started_at), runId: j.run_id ?? null };
    },

    async listMrComments(project, iid) {
      checkIid(iid);
      const [issue, review] = await Promise.all([
        tr.pages<GhComment>(`${repo(project)}/issues/${iid}/comments`, { maxPages: 3 }),
        tr.pages<GhComment>(`${repo(project)}/pulls/${iid}/comments`, { maxPages: 3 }),
      ]);
      return [...issue, ...review].map((c) => commentOf(c, project, 'mr', iid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listMrThreads(project, iid) {
      const d = await gql<{ repository: { pullRequest: { reviewThreads: { nodes: GqlThread[] } } | null } | null }>(threadsQuery(project, iid));
      return (d.repository?.pullRequest?.reviewThreads.nodes ?? []).map((th) => threadOf(th, project, iid));
    },

    async getMrThread(project, iid, threadId) {
      const found = (await provider.listMrThreads(project, iid)).find((th) => th.id === threadId);
      if (!found) throw new VcsError('not_found', { host: o.host, what: threadId });
      return found;
    },

    async getRepo(project) {
      const r = await tr.get<{ default_branch: string; html_url: string; full_name?: string }>(repo(project));
      return { project: r.full_name ?? project, defaultBranch: r.default_branch, webUrl: r.html_url };
    },

    async getBranchSha(project, branch) {
      return (await tr.get<{ commit: { sha: string } }>(`${repo(project)}/branches/${enc(branch)}`)).commit.sha;
    },

    async listReviewerCandidates(project) {
      const who = await currentUser();
      const rows = await tr.pages<GhUser & { permissions?: { push?: boolean } }>(`${repo(project)}/collaborators`, { maxPages: 2 });
      return rows
        .filter((c) => c.permissions?.push && c.login !== who.username && c.type !== 'Bot' && !/\[bot\]$/.test(c.login))
        .map((c): VcsMember => ({ ...user(c), usual: 0 }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 60);
    },

    async getReviewer(project, userId) {
      const u = typeof userId === 'number' || /^\d+$/.test(String(userId)) ? await tr.get<GhUser>(`user/${num(userId)}`) : await tr.get<GhUser>(`users/${enc(String(userId))}`);
      const perm = await tr.get<{ permission?: string }>(`${repo(project)}/collaborators/${enc(u.login)}/permission`);
      if (!['admin', 'maintain', 'write'].includes(perm.permission ?? '')) throw new Error(t('vcs.reviewer.noAccess', { user: u.login }));
      return user(u);
    },

    issueUrl: (project, iid) => `${web}/${project}/issues/${iid}`,
    mrUrl: (project, iid) => `${web}/${project}/pull/${iid}`,
    noteUrl: (project, kind, iid, noteId) => `${web}/${project}/${kind === 'issue' ? 'issues' : 'pull'}/${iid}#issuecomment-${noteId}`,

    async planWrite(op: VcsWriteOp): Promise<VcsCommand[]> {
      const via = tr.kind === 'cli' ? 'gh' : 'api';
      const call = (method: VcsCommand['method'], endpoint: string, body: unknown): VcsCommand => ({ vcs: 'github', via, method, endpoint, fields: {}, ...(body === undefined ? {} : { json: JSON.stringify(body) }) });
      const graphql = (query: string): VcsCommand => ({ vcs: 'github', via, method: 'POST', endpoint: 'graphql', fields: { query } });
      switch (op.op) {
        case 'commentIssue':
        case 'commentMr':
          return [call('POST', `${repo(op.project)}/issues/${checkIid(op.iid)}/comments`, { body: op.body })];
        case 'replyThread': {
          const thread = await provider.getMrThread(op.project, op.iid, op.threadId);
          const first = thread.notes[0];
          if (!first) throw new VcsError('not_found', { host: o.host, what: op.threadId });
          return [call('POST', `${repo(op.project)}/pulls/${op.iid}/comments/${num(first.id)}/replies`, { body: op.body })];
        }
        case 'resolveThread':
          if (!/^[\w=-]{8,}$/.test(op.threadId)) throw new VcsError('invalid', { detail: op.threadId });
          // i18n-ignore: query language of the code host
          return [graphql(`mutation { resolveReviewThread(input: { threadId: "${op.threadId}" }) { thread { isResolved } } }`)];
        case 'editIssueNote':
          return [call('PATCH', `${repo(op.project)}/issues/comments/${num(op.noteId)}`, { body: op.body })];
        case 'setIssueLabels': {
          const n = checkIid(op.iid);
          const cmds: VcsCommand[] = [];
          if (op.add.length) cmds.push(call('POST', `${repo(op.project)}/issues/${n}/labels`, { labels: op.add }));
          for (const l of op.remove) cmds.push(call('DELETE', `${repo(op.project)}/issues/${n}/labels/${enc(l)}`, undefined));
          return cmds;
        }
        case 'setIssueStatus':
          if (op.status !== 'open' && op.status !== 'closed') throw new VcsError('unsupported', { kind: 'GitHub', what: t('vcs.write.statusOpenClosed') });
          return [call('PATCH', `${repo(op.project)}/issues/${checkIid(op.iid)}`, { state: op.status })];
        case 'addReviewer':
          return [call('POST', `${repo(op.project)}/pulls/${checkIid(op.iid)}/requested_reviewers`, { reviewers: [op.username] })];
        case 'setDraft': {
          const pr = await tr.get<GhPull>(`${repo(op.project)}/pulls/${checkIid(op.iid)}`);
          if (!pr.node_id || !/^[\w=-]{8,}$/.test(pr.node_id)) throw new VcsError('invalid', { detail: String(pr.node_id) });
          const mutation = op.draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
          // i18n-ignore: query language of the code host
          return [graphql(`mutation { ${mutation}(input: { pullRequestId: "${pr.node_id}" }) { pullRequest { isDraft } } }`)];
        }
        case 'playJob':
          throw new VcsError('unsupported', { kind: 'GitHub', what: t('vcs.write.playJob') });
        case 'editMrNote':
          // A pull request's conversation comments are issue comments on GitHub.
          return [call('PATCH', `${repo(op.project)}/issues/comments/${num(op.noteId)}`, { body: op.body })];
        case 'deleteNote':
          checkIid(op.iid);
          // The conversation comments of an issue and of a pull request are the same resource on GitHub; a comment on a line or a file of a review is not.
          return [call('DELETE', op.target === 'review' ? `${repo(op.project)}/pulls/comments/${noteNum(op.noteId)}` : `${repo(op.project)}/issues/comments/${noteNum(op.noteId)}`, undefined)];
        case 'submitReview': {
          const n = checkIid(op.iid);
          const sha = checkSha(op.commitSha);
          const side = (c: { side: 'new' | 'old' }): 'RIGHT' | 'LEFT' => (c.side === 'old' ? 'LEFT' : 'RIGHT');
          const onLines = op.comments.filter((c) => c.line !== null);
          // The reviews endpoint takes comments on lines; a comment on a whole file is a review comment of its own (subject_type file).
          const onFiles = op.comments.filter((c) => c.line === null);
          const review = {
            event: op.event === 'request_changes' ? 'REQUEST_CHANGES' : 'COMMENT',
            body: op.body,
            commit_id: sha,
            comments: onLines.map((c) => ({ path: c.path, body: c.body, line: c.line, side: side(c), ...(c.startLine !== null ? { start_line: c.startLine, start_side: side(c) } : {}) })),
          };
          return [call('POST', `${repo(op.project)}/pulls/${n}/reviews`, review), ...onFiles.map((c) => call('POST', `${repo(op.project)}/pulls/${n}/comments`, { body: c.body, commit_id: sha, path: c.path, subject_type: 'file' }))];
        }
        case 'closeIssue':
          return [call('PATCH', `${repo(op.project)}/issues/${checkIid(op.iid)}`, { state: 'closed' })];
        case 'createIssue':
          return [call('POST', `${repo(op.project)}/issues`, { title: checkTitle(op.title), body: op.body, ...(op.labels.length ? { labels: op.labels.map(checkLabel) } : {}) })];
        case 'createMr':
          return [call('POST', `${repo(op.project)}/pulls`, { title: op.title, head: checkBranch(op.sourceBranch), base: checkBranch(op.targetBranch), body: op.body })];
      }
    },

    validateCommand: validateGitHubCommand,
  };
  return provider;
}

const R = '[\\w.-]+/[\\w.-]+';
// `keys` are required, `optional` may be there; anything else is refused.
const WRITES: { method: VcsCommand['method']; re: RegExp; keys: string[]; optional?: string[] }[] = [
  { method: 'POST', re: new RegExp(`^repos/${R}/issues/\\d+/comments$`), keys: ['body'] },
  { method: 'POST', re: new RegExp(`^repos/${R}/issues/\\d+/labels$`), keys: ['labels'] },
  { method: 'DELETE', re: new RegExp(`^repos/${R}/issues/\\d+/labels/[\\w%.-]+$`), keys: [] },
  { method: 'PATCH', re: new RegExp(`^repos/${R}/issues/comments/\\d+$`), keys: ['body'] },
  // Only a comment the runner wrote can be taken back: the conversation comment of an issue or pull request, and the comment of a review.
  { method: 'DELETE', re: new RegExp(`^repos/${R}/issues/comments/\\d+$`), keys: [] },
  { method: 'DELETE', re: new RegExp(`^repos/${R}/pulls/comments/\\d+$`), keys: [] },
  { method: 'PATCH', re: new RegExp(`^repos/${R}/issues/\\d+$`), keys: ['state'] },
  { method: 'POST', re: new RegExp(`^repos/${R}/pulls/\\d+/requested_reviewers$`), keys: ['reviewers'] },
  { method: 'POST', re: new RegExp(`^repos/${R}/pulls/\\d+/comments/\\d+/replies$`), keys: ['body'] },
  // A review: its verdict is a comment or a request for changes, never an approval.
  { method: 'POST', re: new RegExp(`^repos/${R}/pulls/\\d+/reviews$`), keys: ['event', 'body', 'commit_id', 'comments'] },
  { method: 'POST', re: new RegExp(`^repos/${R}/pulls/\\d+/comments$`), keys: ['body', 'commit_id', 'path', 'subject_type'] },
  { method: 'POST', re: new RegExp(`^repos/${R}/pulls$`), keys: ['title', 'head', 'base', 'body'] },
  // A new issue: its title and description, and the labels it is born with.
  { method: 'POST', re: new RegExp(`^repos/${R}/issues$`), keys: ['title', 'body'], optional: ['labels'] },
];

const REVIEW_EVENTS = ['REQUEST_CHANGES', 'COMMENT'];
const isText = (v: unknown): v is string => typeof v === 'string';
const isLine = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function reviewCommentOk(c: unknown): boolean {
  if (!isObject(c)) return false;
  const keys = Object.keys(c);
  const allowed = ['path', 'body', 'line', 'side', 'start_line', 'start_side'];
  if (keys.some((k) => !allowed.includes(k)) || !isText(c.path) || !isText(c.body) || !isLine(c.line) || !['LEFT', 'RIGHT'].includes(String(c.side))) return false;
  if ('start_line' in c && !(isLine(c.start_line) && c.start_line < c.line && c.start_side === c.side)) return false;
  return !('start_side' in c) || 'start_line' in c;
}

/** What a GitHub write may look like: the listed REST calls with only the listed body keys, and the three GraphQL mutations. */
export function validateGitHubCommand(c: VcsCommand): void {
  if (c.endpoint === 'graphql') {
    if ((c.via !== 'gh' && c.via !== 'api') || c.method !== 'POST' || Object.keys(c.fields).join() !== 'query' || c.json !== undefined || !GITHUB_MUTATION.test(c.fields.query ?? '')) {
      throw new Error(t('vcs.validate.githubGraphql'));
    }
    return;
  }
  const rule = WRITES.find((w) => w.method === c.method && w.re.test(c.endpoint));
  if (!rule || /\.\.|%2e/i.test(c.endpoint) || (c.via !== 'gh' && c.via !== 'api') || Object.keys(c.fields).length) throw new Error(t('vcs.validate.endpoint', { endpoint: c.endpoint }));
  let body: Record<string, unknown> = {};
  if (c.json !== undefined) {
    try {
      body = JSON.parse(c.json) as Record<string, unknown>;
    } catch {
      throw new Error(t('vcs.validate.body'));
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error(t('vcs.validate.body'));
  }
  const keys = Object.keys(body);
  const optional = rule.optional ?? [];
  if (keys.some((k) => !rule.keys.includes(k) && !optional.includes(k)) || rule.keys.some((k) => !keys.includes(k))) throw new Error(t('vcs.validate.body'));
  if (rule.keys.includes('state') && body.state !== 'open' && body.state !== 'closed') throw new Error(t('vcs.validate.body'));
  for (const k of ['labels', 'reviewers']) if (k in body && !(Array.isArray(body[k]) && (body[k] as unknown[]).every((x) => typeof x === 'string'))) throw new Error(t('vcs.validate.body'));
  for (const k of ['body', 'title', 'head', 'base', 'path', 'commit_id']) if (k in body && typeof body[k] !== 'string') throw new Error(t('vcs.validate.body'));
  if ('event' in body && !REVIEW_EVENTS.includes(String(body.event))) throw new Error(t('vcs.validate.body'));
  if ('comments' in body && !(Array.isArray(body.comments) && body.comments.length <= 100 && body.comments.every(reviewCommentOk))) throw new Error(t('vcs.validate.body'));
  if ('subject_type' in body && body.subject_type !== 'file') throw new Error(t('vcs.validate.body'));
  if ('commit_id' in body && !/^[0-9a-f]{7,64}$/i.test(String(body.commit_id))) throw new Error(t('vcs.validate.body'));
  if (c.endpoint.endsWith('/issues') && !(typeof body.title === 'string' && body.title.trim() && body.title.length <= ISSUE_TITLE_MAX)) throw new Error(t('vcs.validate.body'));
  if (c.endpoint.endsWith('/pulls') && !(/^[\w][\w./-]*$/.test(String(body.head)) && /^[\w][\w./-]*$/.test(String(body.base)))) throw new Error(t('vcs.validate.body'));
}
