import { t } from '../../shared/i18n';
import { VcsError } from './errors';
import type { RestTransport } from './transport';
import type {
  MyMrOptions,
  VcsCaps,
  VcsCi,
  VcsCiJob,
  VcsCiRun,
  VcsCiStatus,
  VcsCommand,
  VcsComment,
  VcsCommit,
  VcsFileChange,
  VcsIssue,
  VcsMember,
  VcsMr,
  VcsProvider,
  VcsRepo,
  VcsThread,
  VcsUser,
  VcsWriteOp,
} from './types';
import { checkIid, checkProject, enc, iso, issueRefsOf, num, pool } from './util';

// GitLab, REST v4 plus the one GraphQL read the work item status needs. The transport is the glab CLI (the migrated user's setup) or
// fetch with a token; this file does not know which. Endpoints and fields are the ones the app called before providers existed.

/** The only GraphQL write the app may propose: a work item status change (authorized by the user on 2026-10-02). */
export const STATUS_MUTATION =
  /^mutation \{ workItemUpdate\(input: \{ id: "gid:\/\/gitlab\/WorkItem\/\d+", statusWidget: \{ status: "gid:\/\/gitlab\/WorkItems::Statuses::Custom::Status\/\d+" \} \}\) \{ errors \} \}$/;

const DRAFT_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:|\[wip\]|wip:)\s*/i;
const BOT = /^k8s|_bot_|bot$/i;
const ISSUE_PAGE_LIMIT = 5;

export const GITLAB_CAPS: VcsCaps = { issueStatus: true, resolvableThreads: true, manualJobs: true, draftToggle: true, conflictFlag: true, issues: true };

export function undrafted(title: string): string {
  return title.replace(DRAFT_PREFIX, '');
}

const CI: Record<string, VcsCiStatus> = {
  success: 'success',
  failed: 'failed',
  running: 'running',
  created: 'pending',
  pending: 'pending',
  preparing: 'pending',
  scheduled: 'pending',
  waiting_for_resource: 'pending',
  manual: 'manual',
  canceled: 'canceled',
  canceling: 'canceled',
  skipped: 'skipped',
};

interface GlUser {
  id: number;
  username: string;
  name?: string;
  web_url?: string;
}
interface GlIssue {
  iid: number;
  project_id?: number;
  title: string;
  state: string;
  labels?: string[];
  milestone?: { title: string } | null;
  assignees?: { username: string }[];
  author?: { username: string };
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  web_url: string;
  description?: string | null;
  references?: { full?: string };
}
interface GlMr {
  iid: number;
  project_id?: number;
  title: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  target_branch: string;
  sha?: string;
  web_url: string;
  author?: { username: string };
  reviewers?: GlUser[];
  head_pipeline?: { id: number; status: string; web_url?: string } | null;
  has_conflicts?: boolean;
  diverged_commits_count?: number | null;
  created_at?: string;
  updated_at?: string;
  merged_at?: string | null;
  description?: string;
  references?: { full?: string };
}
interface GlNote {
  id: number;
  body: string;
  system: boolean;
  created_at: string;
  author: { username: string };
  resolvable?: boolean;
  resolved?: boolean | null;
  position?: { new_path?: string | null; old_path?: string | null; new_line?: number | null; old_line?: number | null } | null;
}
interface GlDiscussion {
  id: string;
  notes: GlNote[];
}

/** "group/sub/name" out of "group/sub/name#12" / "…!12", else out of the web URL ("…/-/issues/12"). */
function pathOf(refs: string | undefined, webUrl: string): string {
  const fromRef = refs?.replace(/[#!]\d+$/, '');
  if (fromRef) return fromRef;
  try {
    return new URL(webUrl).pathname.replace(/^\//, '').split('/-/')[0];
  } catch {
    return '';
  }
}

const user = (u: GlUser): VcsUser => ({ id: u.id, username: u.username, name: u.name ?? u.username, webUrl: u.web_url ?? null });

function ciOf(p: GlMr['head_pipeline']): VcsCi | null {
  return p ? { status: CI[p.status] ?? 'pending', raw: p.status, runId: p.id, webUrl: p.web_url ?? null } : null;
}

export interface GitLabOptions {
  id: string;
  host: string;
  transport: RestTransport;
}

export function createGitLabProvider(o: GitLabOptions): VcsProvider {
  const tr = o.transport;
  const web = `https://${o.host}`;
  let me: Promise<VcsUser> | null = null;

  const issueOf = (i: GlIssue, project?: string): VcsIssue => ({
    project: project ?? pathOf(i.references?.full, i.web_url),
    iid: i.iid,
    title: i.title,
    state: i.state === 'closed' ? 'closed' : 'open',
    status: null,
    labels: i.labels ?? [],
    milestone: i.milestone?.title ?? null,
    assignees: (i.assignees ?? []).map((a) => a.username),
    author: i.author?.username ?? null,
    createdAt: iso(i.created_at),
    updatedAt: iso(i.updated_at),
    closedAt: iso(i.closed_at),
    webUrl: i.web_url,
    body: i.description ?? null,
  });

  const mrOf = (m: GlMr, project?: string, roles: VcsMr['roles'] = []): VcsMr => ({
    project: project ?? pathOf(m.references?.full, m.web_url),
    iid: m.iid,
    title: m.title,
    state: m.state === 'merged' ? 'merged' : m.state === 'closed' ? 'closed' : 'open',
    draft: Boolean(m.draft ?? m.work_in_progress),
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    sha: m.sha ?? '',
    webUrl: m.web_url,
    author: m.author?.username ?? '',
    reviewers: (m.reviewers ?? []).map(user),
    approvals: null,
    ci: ciOf(m.head_pipeline),
    hasConflicts: typeof m.has_conflicts === 'boolean' ? m.has_conflicts : null,
    behind: typeof m.diverged_commits_count === 'number' ? m.diverged_commits_count : null,
    createdAt: iso(m.created_at),
    updatedAt: iso(m.updated_at),
    mergedAt: iso(m.merged_at),
    description: m.description ?? '',
    roles,
    issueRefs: issueRefsOf(`${m.title}\n${m.description ?? ''}`, m.source_branch),
  });

  const noteOf = (n: GlNote, kind: 'issue' | 'mr', project: string, iid: number): VcsComment => ({
    id: n.id,
    author: n.author.username,
    body: n.body,
    createdAt: n.created_at,
    system: n.system,
    webUrl: `${web}/${project}/-/${kind === 'issue' ? 'work_items' : 'merge_requests'}/${iid}#note_${n.id}`,
  });

  const threadOf = (d: GlDiscussion, project: string, iid: number): VcsThread => {
    const real = d.notes.filter((n) => !n.system);
    const pos = real.find((n) => n.position)?.position;
    return {
      id: d.id,
      resolvable: d.notes.some((n) => !n.system && n.resolvable),
      resolved: !d.notes.some((n) => !n.system && n.resolvable && !n.resolved),
      path: pos?.new_path ?? pos?.old_path ?? null,
      line: pos?.new_line ?? pos?.old_line ?? null,
      notes: d.notes.map((n) => noteOf(n, 'mr', project, iid)),
    };
  };

  const p = (project: string): string => enc(checkProject(project));
  const repoPath = (project: string): string => `projects/${p(project)}`;

  const currentUser = (): Promise<VcsUser> => {
    me ??= tr.get<GlUser>('user').then(user);
    me.catch(() => {
      me = null;
    });
    return me;
  };

  const provider: VcsProvider = {
    kind: 'gitlab',
    id: o.id,
    host: o.host,
    transport: tr.kind,
    caps: GITLAB_CAPS,
    currentUser,

    async listMyIssues(opts = {}) {
      const base = opts.project ? `${repoPath(opts.project)}/issues` : 'issues';
      const rows = await tr.pages<GlIssue>(`${base}?scope=assigned_to_me&state=opened&order_by=updated_at`, { maxPages: Math.ceil((opts.limit ?? 100) / 100) || 1 });
      const issues = rows.slice(0, opts.limit ?? 200).map((i) => issueOf(i, opts.project && !/^\d+$/.test(opts.project) ? opts.project : undefined));
      // Statuses come from one GraphQL read per project; a failed read leaves them empty, never fails the list.
      const byProject = new Map<string, VcsIssue[]>();
      for (const i of issues) byProject.set(i.project, [...(byProject.get(i.project) ?? []), i]);
      await pool([...byProject], 3, async ([project, list]) => {
        if (!project) return;
        const statuses = await provider.issueStatuses(project, list.map((i) => i.iid));
        for (const i of list) i.status = statuses.get(i.iid) ?? null;
      });
      return issues;
    },

    async getIssue(project, iid, opts = {}) {
      checkIid(iid);
      const issue = issueOf(await tr.get<GlIssue>(`${repoPath(project)}/issues/${iid}`, `#${iid}`), /^\d+$/.test(project) ? undefined : project);
      if (!opts.status) return issue;
      const full = issue.project || project;
      const q = await tr.graphql<{ data: { project: { workItems: { nodes: { id: string; widgets: { type: string; status?: { name: string } }[] }[] } } | null } }>(
        // i18n-ignore: query language of the code host
        `query { project(fullPath: "${full}") { workItems(iid: "${iid}") { nodes { id widgets { type ... on WorkItemWidgetStatus { status { name } } } } } } }`,
      );
      const node = q.data?.project?.workItems.nodes[0];
      return { ...issue, status: node?.widgets.find((w) => w.type === 'STATUS')?.status?.name ?? null, nodeId: node?.id ?? null };
    },

    async issueStatuses(project, iids) {
      const out = new Map<number, string>();
      if (!iids.length) return out;
      const full = checkProject(project, false);
      // i18n-ignore: query language of the code host
      const query = `{ project(fullPath:"${full}"){ workItems(iids:[${iids.map((i) => `"${checkIid(i)}"`).join(',')}]){ nodes{ iid widgets{ ... on WorkItemWidgetStatus{ status{ name } } } } } } }`;
      try {
        const r = await tr.graphql<{ data?: { project?: { workItems?: { nodes: { iid: string; widgets: { status?: { name: string } }[] }[] } } } }>(query);
        for (const n of r.data?.project?.workItems?.nodes ?? []) {
          const name = n.widgets.find((w) => w.status)?.status?.name;
          if (name) out.set(Number(n.iid), name);
        }
      } catch (e) {
        console.error('[vcs:gitlab] status query failed', (e as Error).message);
      }
      return out;
    },

    async listIssueComments(project, iid) {
      checkIid(iid);
      const rows = await tr.pages<GlNote>(`${repoPath(project)}/issues/${iid}/notes?sort=desc&order_by=created_at`, { maxPages: ISSUE_PAGE_LIMIT });
      return rows.map((n) => noteOf(n, 'issue', project, iid));
    },

    async searchIssues(project, q) {
      const rows = await tr.get<GlIssue[]>(`${repoPath(project)}/issues?search=${enc(q.text)}&in=title&scope=all&created_after=${enc(q.createdAfter)}&per_page=20`);
      return rows.map((i) => issueOf(i, project));
    },

    async listMyMrs(opts: MyMrOptions = {}) {
      const roles = opts.roles ?? ['author', 'reviewer'];
      const who = await currentUser();
      const byKey = new Map<string, VcsMr>();
      const add = (rows: GlMr[], role: 'author' | 'reviewer') => {
        for (const row of rows) {
          const m = mrOf(row);
          const key = `${m.project}!${m.iid}`;
          const had = byKey.get(key);
          if (had) had.roles.push(role);
          else byKey.set(key, { ...m, roles: [role] });
        }
      };
      if (roles.includes('author')) add(await tr.pages<GlMr>('merge_requests?scope=created_by_me&state=opened&order_by=updated_at', { maxPages: 2 }), 'author');
      if (roles.includes('reviewer')) add(await tr.pages<GlMr>(`merge_requests?scope=all&reviewer_username=${enc(who.username)}&state=opened&order_by=updated_at`, { maxPages: 2 }), 'reviewer');
      let list = [...byKey.values()].slice(0, opts.limit ?? 100);
      // The list endpoint carries no pipeline: one detail read per MR (a few at a time).
      if (opts.detail) {
        list = await pool(list, 4, async (m) => {
          try {
            const d = await provider.getMr(m.project, m.iid);
            return { ...d, roles: m.roles };
          } catch (e) {
            console.error(`[vcs:gitlab] ${m.project}!${m.iid}`, (e as Error).message);
            return m;
          }
        });
      }
      return list;
    },

    async getMr(project, iid, opts = {}) {
      checkIid(iid);
      const raw = await tr.get<GlMr>(`${repoPath(project)}/merge_requests/${iid}${opts.behind ? '?include_diverged_commits_count=true' : ''}`, `!${iid}`);
      const mr = mrOf(raw, /^\d+$/.test(project) ? undefined : project);
      if (!opts.approvals) return mr;
      const a = await tr.get<{ approved?: boolean; approved_by?: { user: { username: string } }[] }>(`${repoPath(project)}/merge_requests/${iid}/approvals`);
      return { ...mr, approvals: { approved: Boolean(a.approved), by: (a.approved_by ?? []).map((x) => x.user.username), changesRequestedBy: [] } };
    },

    async linkedMrs(project, iid) {
      checkIid(iid);
      const rows = await tr.get<GlMr[]>(`${repoPath(project)}/issues/${iid}/related_merge_requests`);
      return rows.map((m) => ({ ...mrOf(m), issueRefs: [iid] }));
    },

    async searchMrs(project, q) {
      const rows = await tr.get<GlMr[]>(`${repoPath(project)}/merge_requests?search=${enc(q.text)}&in=title&scope=all&created_after=${enc(q.createdAfter)}&per_page=20`);
      return rows.map((m) => mrOf(m, project));
    },

    async listMrCommits(project, iid) {
      checkIid(iid);
      const rows = await tr.get<{ id: string; committed_date: string }[]>(`${repoPath(project)}/merge_requests/${iid}/commits?per_page=50`);
      return rows.map((c): VcsCommit => ({ sha: c.id, date: c.committed_date }));
    },

    async listMrChanges(project, iid) {
      checkIid(iid);
      const d = await tr.get<{ changes?: { new_path: string; diff?: string }[] }>(`${repoPath(project)}/merge_requests/${iid}/changes`);
      return (d.changes ?? []).map((c): VcsFileChange => ({ path: c.new_path, diff: c.diff ?? '' }));
    },

    async listMrCi(project, iid) {
      checkIid(iid);
      const rows = await tr.get<{ id: number; status: string; created_at: string; web_url?: string }[]>(`${repoPath(project)}/merge_requests/${iid}/pipelines`);
      return rows.map((r): VcsCiRun => ({ id: r.id, status: r.status, createdAt: r.created_at, webUrl: r.web_url ?? null }));
    },

    async listCiJobs(project, runId) {
      const rows = await tr.get<{ id: number; name: string; stage: string; status: string; created_at?: string; started_at?: string | null; pipeline?: { id: number } }[]>(`${repoPath(project)}/pipelines/${num(runId)}/jobs?per_page=100`);
      return rows.map((j): VcsCiJob => ({ id: j.id, name: j.name, stage: j.stage, status: j.status, createdAt: iso(j.created_at), startedAt: iso(j.started_at), runId: j.pipeline?.id ?? runId }));
    },

    async getCiJob(project, jobId) {
      const j = await tr.get<{ id: number; name: string; stage: string; status: string; created_at?: string; started_at?: string | null; pipeline?: { id: number } }>(`${repoPath(project)}/jobs/${num(jobId)}`);
      return { id: j.id, name: j.name, stage: j.stage, status: j.status, createdAt: iso(j.created_at), startedAt: iso(j.started_at), runId: j.pipeline?.id ?? null };
    },

    async listMrComments(project, iid) {
      checkIid(iid);
      const rows = await tr.get<GlNote[]>(`${repoPath(project)}/merge_requests/${iid}/notes?sort=desc&order_by=created_at&per_page=50`);
      return rows.map((n) => noteOf(n, 'mr', project, iid));
    },

    async listMrThreads(project, iid) {
      checkIid(iid);
      const rows = await tr.pages<GlDiscussion>(`${repoPath(project)}/merge_requests/${iid}/discussions`, { maxPages: 5 });
      return rows.map((d) => threadOf(d, project, iid));
    },

    async getMrThread(project, iid, threadId) {
      checkIid(iid);
      if (!/^[0-9a-f]{8,64}$/.test(threadId)) throw new VcsError('invalid', { detail: threadId });
      return threadOf(await tr.get<GlDiscussion>(`${repoPath(project)}/merge_requests/${iid}/discussions/${threadId}`), project, iid);
    },

    async getRepo(project) {
      const r = await tr.get<{ default_branch: string; web_url: string; path_with_namespace?: string }>(repoPath(project));
      return { project: r.path_with_namespace ?? project, defaultBranch: r.default_branch, webUrl: r.web_url } satisfies VcsRepo;
    },

    async getBranchSha(project, branch) {
      const b = await tr.get<{ commit: { id: string } }>(`${repoPath(project)}/repository/branches/${enc(branch)}`);
      return b.commit.id;
    },

    async listReviewerCandidates(project) {
      const who = await currentUser();
      const [all, recent] = await Promise.all([
        tr.get<(GlUser & { access_level: number; state: string })[]>(`${repoPath(project)}/members/all?per_page=100`),
        tr.get<{ reviewers: GlUser[] }[]>(`${repoPath(project)}/merge_requests?author_username=${who.username}&state=all&per_page=50&order_by=updated_at`).catch(() => []),
      ]);
      const count = new Map<number, number>();
      for (const mr of recent) for (const r of mr.reviewers) count.set(r.id, (count.get(r.id) ?? 0) + 1);
      return all
        .filter((m) => m.access_level >= 30 && m.state === 'active' && m.username !== who.username && !BOT.test(m.username))
        .map((m): VcsMember => ({ ...user(m), usual: count.get(m.id) ?? 0 }))
        .sort((a, b) => b.usual - a.usual || a.name.localeCompare(b.name))
        .slice(0, 60);
    },

    async getReviewer(project, userId) {
      const m = await tr.get<GlUser & { access_level: number }>(`${repoPath(project)}/members/all/${num(userId)}`);
      if (m.access_level < 30) throw new Error(t('vcs.reviewer.noAccess', { user: m.username }));
      return user(m);
    },

    issueUrl: (project, iid) => `${web}/${project}/-/work_items/${iid}`,
    mrUrl: (project, iid) => `${web}/${project}/-/merge_requests/${iid}`,
    noteUrl: (project, kind, iid, noteId) => `${web}/${project}/-/${kind === 'issue' ? 'work_items' : 'merge_requests'}/${iid}#note_${noteId}`,

    async planWrite(op: VcsWriteOp): Promise<VcsCommand[]> {
      const via = tr.kind === 'cli' ? 'glab' : 'api';
      const rest = (method: VcsCommand['method'], endpoint: string, fields: Record<string, string>, v: VcsCommand['via'] = via): VcsCommand => ({ vcs: 'gitlab', via: v, method, endpoint, fields });
      switch (op.op) {
        case 'commentIssue':
          return [rest('POST', `${repoPath(op.project)}/issues/${checkIid(op.iid)}/notes`, { body: op.body })];
        case 'commentMr':
          return [rest('POST', `${repoPath(op.project)}/merge_requests/${checkIid(op.iid)}/notes`, { body: op.body })];
        case 'replyThread':
          return [rest('POST', `${repoPath(op.project)}/merge_requests/${checkIid(op.iid)}/discussions/${op.threadId}/notes`, { body: op.body })];
        case 'resolveThread':
          return [rest('PUT', `${repoPath(op.project)}/merge_requests/${checkIid(op.iid)}/discussions/${op.threadId}`, { resolved: 'true' })];
        case 'editIssueNote':
          return [rest('PUT', `${repoPath(op.project)}/issues/${checkIid(op.iid)}/notes/${num(op.noteId)}`, { body: op.body })];
        case 'setIssueLabels': {
          const fields: Record<string, string> = {};
          if (op.add.length) fields.add_labels = op.add.join(',');
          if (op.remove.length) fields.remove_labels = op.remove.join(',');
          return Object.keys(fields).length ? [rest('PUT', `${repoPath(op.project)}/issues/${checkIid(op.iid)}`, fields)] : [];
        }
        case 'setIssueStatus': {
          if (!/^\d+$/.test(op.status)) throw new VcsError('invalid', { detail: op.status });
          const gid = op.nodeId ?? (await provider.getIssue(op.project, op.iid, { status: true })).nodeId;
          if (!gid) throw new VcsError('unsupported', { kind: 'GitLab', what: t('vcs.write.statusNoNode') });
          const id = /^gid:\/\/gitlab\/WorkItem\/(\d+)$/.exec(gid)?.[1] ?? /^(\d+)$/.exec(gid)?.[1];
          if (!id) throw new VcsError('invalid', { detail: gid });
          return [
            rest('POST', 'graphql', {
              // i18n-ignore: query language of the code host
              query: `mutation { workItemUpdate(input: { id: "gid://gitlab/WorkItem/${id}", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/${op.status}" } }) { errors } }`,
            }),
          ];
        }
        case 'addReviewer':
          // Array fields such as reviewer_ids[] are rejected by glab (it sends a JSON body): the CLI setup uses curl with the CLI's token.
          return [rest('PUT', `${repoPath(op.project)}/merge_requests/${checkIid(op.iid)}`, { 'reviewer_ids[]': String(op.userId) }, tr.kind === 'cli' ? 'curl' : 'api')];
        case 'setDraft': {
          const title = op.title ?? (op.draft ? `Draft: ${undrafted((await provider.getMr(op.project, op.iid)).title)}` : undrafted((await provider.getMr(op.project, op.iid)).title));
          return [rest('PUT', `${repoPath(op.project)}/merge_requests/${checkIid(op.iid)}`, { title })];
        }
        case 'playJob':
          return [rest('POST', `${repoPath(op.project)}/jobs/${num(op.jobId)}/play`, {})];
      }
    },

    validateCommand: validateGitLabCommand,
  };
  return provider;
}

/** What a GitLab write may look like: GraphQL only for the status mutation, REST only under projects/. */
export function validateGitLabCommand(command: VcsCommand): void {
  if (command.endpoint === 'graphql') {
    const keys = Object.keys(command.fields);
    if ((command.via !== 'glab' && command.via !== 'api') || command.method !== 'POST' || keys.length !== 1 || !STATUS_MUTATION.test(command.fields.query ?? '')) {
      throw new Error(t('vcs.validate.gitlabGraphql'));
    }
  } else if (!/^projects\/[\w%.-]+\/[\w/?=&%.-]+$/.test(command.endpoint) || /\.\.|%2e/i.test(command.endpoint)) {
    throw new Error(t('vcs.validate.endpoint', { endpoint: command.endpoint }));
  } else if (command.json !== undefined) {
    throw new Error(t('vcs.validate.endpoint', { endpoint: command.endpoint }));
  }
}
