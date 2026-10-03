import { t } from '../../shared/i18n';
import { VCS_CAPS } from '../../shared/vcsCaps';
import { VcsError } from './errors';
import type { HttpClient } from './http';
import type {
  MyMrOptions,
  VcsApprovals,
  VcsCaps,
  VcsCi,
  VcsCiRun,
  VcsCiStatus,
  VcsCommand,
  VcsComment,
  VcsIssue,
  VcsMember,
  VcsMr,
  VcsProvider,
  VcsThread,
  VcsUser,
  VcsWriteOp,
} from './types';
import { indexPatch } from './diffLines';
import { ISSUE_TITLE_MAX, checkIid, checkTitle, enc, iso, issueRefsOf, pool, splitUnifiedDiff, worstCi } from './util';

// Bitbucket Cloud, REST 2.0 (api.bitbucket.org). A "project" is "workspace/repo-slug". Bitbucket has no CLI: this provider only uses
// the HTTP transport. Its issue tracker is optional (a repository may have it off): a repository without one simply has no issues.
// Pull request lists are per user across workspaces; the reviewer role and the issues are looked up in the repositories in `repos`.

export const BITBUCKET_CAPS: VcsCaps = VCS_CAPS.bitbucket;

// i18n-ignore: query language of the code host
const ISSUE_OPEN = '(state="new" OR state="open" OR state="on hold")';
const UUID = /^\{[0-9a-fA-F-]{36}\}$/;
// i18n-ignore: query language of the code host
export const ISSUE_STATES = ['new', 'open', 'resolved', 'on hold', 'invalid', 'duplicate', 'wontfix', 'closed'];

interface BbUser {
  uuid: string;
  nickname?: string;
  display_name?: string;
  username?: string;
  links?: { html?: { href?: string } };
}
interface BbPr {
  id: number;
  title: string;
  state: string;
  draft?: boolean;
  description?: string;
  source: { branch: { name: string }; commit?: { hash: string } | null };
  destination: { branch: { name: string }; repository?: { full_name: string } };
  links?: { html?: { href?: string } };
  author?: BbUser;
  reviewers?: BbUser[];
  participants?: { user: BbUser; role: string; approved: boolean; state?: string | null }[];
  created_on?: string;
  updated_on?: string;
}
interface BbIssue {
  id: number;
  title: string;
  state: string;
  kind?: string;
  priority?: string;
  milestone?: { name: string } | null;
  assignee?: BbUser | null;
  reporter?: BbUser | null;
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href?: string } };
  content?: { raw?: string };
}
interface BbComment {
  id: number;
  content?: { raw?: string };
  user?: BbUser;
  created_on: string;
  deleted?: boolean;
  parent?: { id: number };
  inline?: { path?: string; to?: number | null; from?: number | null } | null;
  resolution?: unknown;
  links?: { html?: { href?: string } };
}

const nick = (u?: BbUser | null): string => u?.nickname ?? u?.username ?? u?.display_name ?? '';
const user = (u: BbUser): VcsUser => ({ id: u.uuid, username: nick(u), name: u.display_name ?? nick(u), webUrl: u.links?.html?.href ?? null });

const CI: Record<string, VcsCiStatus> = { SUCCESSFUL: 'success', FAILED: 'failed', INPROGRESS: 'running', STOPPED: 'canceled' };

export interface BitbucketOptions {
  id: string;
  host: string;
  client: HttpClient;
  /** "workspace/repo" the reviewer role and the issues are looked up in. */
  repos: string[];
}

const checkRepo = (project: string): string => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(project) || project.split('/').some((s) => /^\.+$/.test(s))) throw new VcsError('invalid', { detail: project });
  return project;
};

export function createBitbucketProvider(o: BitbucketOptions): VcsProvider {
  const c = o.client;
  const web = 'https://bitbucket.org';
  let me: Promise<VcsUser> | null = null;
  const repo = (project: string): string => `repositories/${checkRepo(project)}`;
  const uuidPath = (uuid: string): string => {
    if (!UUID.test(uuid)) throw new VcsError('invalid', { detail: uuid });
    return enc(uuid);
  };

  const currentUser = (): Promise<VcsUser> => {
    me ??= c.getJson<BbUser & { account_id?: string }>('user').then(user);
    me.catch(() => {
      me = null;
    });
    return me;
  };

  const issueOf = (i: BbIssue, project: string): VcsIssue => ({
    project,
    iid: i.id,
    title: i.title,
    state: ['resolved', 'closed', 'invalid', 'duplicate', 'wontfix'].includes(i.state) ? 'closed' : 'open',
    status: i.state,
    labels: [i.kind, i.priority].filter((x): x is string => !!x),
    milestone: i.milestone?.name ?? null,
    assignees: i.assignee ? [nick(i.assignee)] : [],
    author: nick(i.reporter) || null,
    createdAt: iso(i.created_on),
    updatedAt: iso(i.updated_on),
    closedAt: null,
    webUrl: i.links?.html?.href ?? `${web}/${project}/issues/${i.id}`,
    body: i.content?.raw ?? null,
  });

  const mrOf = (pr: BbPr, roles: VcsMr['roles'] = []): VcsMr => {
    const project = pr.destination.repository?.full_name ?? '';
    return {
      project,
      iid: pr.id,
      title: pr.title,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'open' : 'closed',
      draft: Boolean(pr.draft),
      sourceBranch: pr.source.branch.name,
      targetBranch: pr.destination.branch.name,
      sha: pr.source.commit?.hash ?? '',
      webUrl: pr.links?.html?.href ?? `${web}/${project}/pull-requests/${pr.id}`,
      author: nick(pr.author),
      reviewers: (pr.reviewers ?? []).map(user),
      approvals: pr.participants ? approvalsOf(pr) : null,
      ci: null,
      hasConflicts: null,
      behind: null,
      createdAt: iso(pr.created_on),
      updatedAt: iso(pr.updated_on),
      mergedAt: pr.state === 'MERGED' ? iso(pr.updated_on) : null,
      description: pr.description ?? '',
      roles,
      issueRefs: issueRefsOf(`${pr.title}\n${pr.description ?? ''}`, pr.source.branch.name),
    };
  };

  function approvalsOf(pr: BbPr): VcsApprovals {
    const rev = (pr.participants ?? []).filter((p) => p.role === 'REVIEWER' || p.approved);
    const by = rev.filter((p) => p.approved).map((p) => nick(p.user));
    const changes = rev.filter((p) => p.state === 'changes_requested').map((p) => nick(p.user));
    return { approved: by.length > 0 && changes.length === 0, by, changesRequestedBy: changes };
  }

  async function ciOf(project: string, iid: number): Promise<VcsCi | null> {
    const rows = await c.values<{ state: string; url?: string }>(`${repo(project)}/pullrequests/${iid}/statuses`, { maxPages: 2 }).catch(() => []);
    const status = worstCi(rows.map((r) => CI[r.state] ?? 'pending'));
    return status ? { status, raw: rows.map((r) => r.state).join(',').toLowerCase(), runId: null, webUrl: rows.find((r) => r.url)?.url ?? null } : null;
  }

  const commentOf = (cm: BbComment, project: string, kind: 'issue' | 'mr', iid: number): VcsComment => ({
    id: cm.id,
    author: nick(cm.user) || 'unknown',
    body: cm.content?.raw ?? '',
    createdAt: cm.created_on,
    system: false,
    webUrl: cm.links?.html?.href ?? `${web}/${project}/${kind === 'issue' ? 'issues' : 'pull-requests'}/${iid}#comment-${cm.id}`,
  });

  async function prComments(project: string, iid: number): Promise<BbComment[]> {
    const rows = await c.values<BbComment>(`${repo(project)}/pullrequests/${checkIid(iid)}/comments`, { maxPages: 5 });
    return rows.filter((r) => !r.deleted);
  }

  function threadsOf(rows: BbComment[], project: string, iid: number): VcsThread[] {
    const byParent = new Map<number, BbComment[]>();
    for (const r of rows) if (r.parent) byParent.set(r.parent.id, [...(byParent.get(r.parent.id) ?? []), r]);
    const sorted = (list: BbComment[]) => [...list].sort((a, b) => a.created_on.localeCompare(b.created_on));
    return rows
      .filter((r) => !r.parent)
      .map((root) => {
        // Replies of replies belong to the same thread.
        const all: BbComment[] = [root];
        const walk = (id: number) => {
          for (const child of sorted(byParent.get(id) ?? [])) {
            all.push(child);
            walk(child.id);
          }
        };
        walk(root.id);
        return {
          id: String(root.id),
          resolvable: true,
          resolved: Boolean(root.resolution),
          path: root.inline?.path ?? null,
          line: root.inline?.to ?? root.inline?.from ?? null,
          notes: all.map((n) => commentOf(n, project, 'mr', iid)),
        };
      });
  }

  const provider: VcsProvider = {
    kind: 'bitbucket',
    id: o.id,
    host: o.host,
    transport: 'api',
    caps: BITBUCKET_CAPS,
    currentUser,

    async listMyIssues(opts = {}) {
      const who = await currentUser();
      const repos = opts.project ? [opts.project] : o.repos;
      const lists = await pool(repos, 3, async (project) => {
        try {
          const q = `assignee.uuid="${who.id}" AND ${ISSUE_OPEN}`;
          const rows = await c.values<BbIssue>(`${repo(project)}/issues`, { query: { q, sort: '-updated_on' }, maxPages: 2 });
          return rows.map((i) => issueOf(i, project));
        } catch (e) {
          // A repository with the tracker off answers 404: it has no issues, which is not an error.
          if (e instanceof VcsError && e.code === 'not_found') return [];
          throw e;
        }
      });
      return lists.flat().slice(0, opts.limit ?? 200);
    },

    async listIssues(opts) {
      // The tracker has no labels: a label scope would show every issue, so it is refused instead of widened.
      if (opts.scope === 'labels') throw new VcsError('unsupported', { kind: 'Bitbucket', what: t('vcs.write.labels') });
      try {
        const rows = await c.values<BbIssue>(`${repo(opts.project)}/issues`, { query: { q: ISSUE_OPEN, sort: '-updated_on' }, maxPages: 2 });
        return rows.slice(0, opts.limit ?? 200).map((i) => issueOf(i, opts.project));
      } catch (e) {
        // A repository with the tracker off answers 404: it has no issues, which is not an error.
        if (e instanceof VcsError && e.code === 'not_found') return [];
        throw e;
      }
    },

    async getIssue(project, iid) {
      return issueOf(await c.getJson<BbIssue>(`${repo(project)}/issues/${checkIid(iid)}`, undefined, `#${iid}`), project);
    },

    async issueStatuses(project, iids) {
      const out = new Map<number, string>();
      await pool(iids, 4, async (iid) => {
        try {
          out.set(iid, (await provider.getIssue(project, iid)).status ?? '');
        } catch {
          // an issue that cannot be read has no status
        }
      });
      return out;
    },

    async listIssueComments(project, iid) {
      const rows = await c.values<BbComment>(`${repo(project)}/issues/${checkIid(iid)}/comments`, { maxPages: 5 });
      return rows.filter((r) => !r.deleted).map((r) => commentOf(r, project, 'issue', iid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async searchIssues(project, q) {
      // i18n-ignore: query language of the code host
      const query = `title ~ "${q.text.replace(/["\\]/g, '')}" AND created_on >= ${q.createdAfter}`;
      const rows = await c.values<BbIssue>(`${repo(project)}/issues`, { query: { q: query, pagelen: 20 }, maxPages: 1 });
      return rows.map((i) => issueOf(i, project));
    },

    async listMyMrs(opts: MyMrOptions = {}) {
      const roles = opts.roles ?? ['author', 'reviewer'];
      const who = await currentUser();
      const found = new Map<string, VcsMr>();
      const add = (rows: BbPr[], role: 'author' | 'reviewer') => {
        for (const r of rows) {
          const m = mrOf(r, [role]);
          const key = `${m.project}!${m.iid}`;
          const had = found.get(key);
          if (had) had.roles.push(role);
          else found.set(key, m);
        }
      };
      if (roles.includes('author')) add(await c.values<BbPr>(`pullrequests/${uuidPath(String(who.id))}`, { query: { state: 'OPEN' }, maxPages: 2 }), 'author');
      if (roles.includes('reviewer')) {
        for (const project of o.repos) {
          try {
            // i18n-ignore: query language of the code host
            add(await c.values<BbPr>(`${repo(project)}/pullrequests`, { query: { q: `reviewers.uuid="${who.id}" AND state="OPEN"` }, maxPages: 1 }), 'reviewer');
          } catch (e) {
            console.error(`[vcs:bitbucket] ${project}`, (e as Error).message);
          }
        }
      }
      let list = [...found.values()].slice(0, opts.limit ?? 100);
      if (opts.detail) list = await pool(list, 4, async (m) => ({ ...m, ci: await ciOf(m.project, m.iid) }));
      return list;
    },

    async getMr(project, iid) {
      checkIid(iid);
      const pr = await c.getJson<BbPr>(`${repo(project)}/pullrequests/${iid}`, undefined, `#${iid}`);
      const mr = mrOf(pr);
      return { ...mr, project: mr.project || project, ci: await ciOf(project, iid) };
    },

    async linkedMrs(project, iid) {
      checkIid(iid);
      // i18n-ignore: query language of the code host
      const q = `(title ~ "#${iid}" OR source.branch.name ~ "${iid}") AND (state="OPEN" OR state="MERGED")`;
      const rows = await c.values<BbPr>(`${repo(project)}/pullrequests`, { query: { q }, maxPages: 1 }).catch(() => [] as BbPr[]);
      return rows.map((r) => mrOf(r)).filter((m) => issueRefsOf(`${m.title}\n${m.description}`, m.sourceBranch).includes(iid)).map((m) => ({ ...m, project: m.project || project, issueRefs: [iid] }));
    },

    async searchMrs(project, q) {
      // i18n-ignore: query language of the code host
      const query = `title ~ "${q.text.replace(/["\\]/g, '')}" AND created_on >= ${q.createdAfter}`;
      const rows = await c.values<BbPr>(`${repo(project)}/pullrequests`, { query: { q: query, state: 'OPEN', pagelen: 20 }, maxPages: 1 });
      return rows.map((r) => mrOf(r));
    },

    async listMrsByTarget(project, branch, opts = {}) {
      if (!/^[\w][\w./-]{0,200}$/.test(branch) || branch.includes('..')) throw new VcsError('invalid', { detail: branch });
      // i18n-ignore: query language of the code host
      const rows = await c.values<BbPr>(`${repo(project)}/pullrequests`, { query: { q: `destination.branch.name="${branch}" AND (state="OPEN" OR state="MERGED")`, sort: '-updated_on' }, maxPages: Math.ceil((opts.limit ?? 100) / 100) || 1 });
      return rows.slice(0, opts.limit ?? 100).map((r) => {
        const m = mrOf(r);
        return { ...m, project: m.project || project };
      });
    },

    // Bitbucket has no release objects (a tag is a tag, and downloads are not releases): a release run on it cannot see a beta published.
    async getRelease() {
      return null;
    },

    async listMrCommits(project, iid) {
      const rows = await c.values<{ hash: string; date: string }>(`${repo(project)}/pullrequests/${checkIid(iid)}/commits`, { maxPages: 1 });
      return rows.map((r) => ({ sha: r.hash, date: r.date }));
    },

    async listMrChanges(project, iid) {
      const raw = (await c.request('GET', `${repo(project)}/pullrequests/${checkIid(iid)}/diff`, { text: true, headers: { Accept: 'text/plain' } })).body;
      return splitUnifiedDiff(typeof raw === 'string' ? raw : '');
    },

    async listMrCi(project, iid) {
      const rows = await c.values<{ key?: string; uuid?: string; state: string; created_on: string; url?: string }>(`${repo(project)}/pullrequests/${checkIid(iid)}/statuses`, { maxPages: 2 });
      return rows.map((r, i): VcsCiRun => ({ id: r.uuid ?? r.key ?? i, status: (CI[r.state] ?? r.state).toLowerCase(), createdAt: r.created_on, webUrl: r.url ?? null }));
    },

    async listCiJobs() {
      return [];
    },

    async getCiJob() {
      throw new VcsError('unsupported', { kind: 'Bitbucket', what: t('vcs.write.playJob') });
    },

    async listMrComments(project, iid) {
      return (await prComments(project, iid)).map((r) => commentOf(r, project, 'mr', iid)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listMrThreads(project, iid) {
      return threadsOf(await prComments(project, iid), project, iid);
    },

    async getMrThread(project, iid, threadId) {
      const found = (await provider.listMrThreads(project, iid)).find((th) => th.id === threadId);
      if (!found) throw new VcsError('not_found', { host: o.host, what: threadId });
      return found;
    },

    async getRepo(project) {
      const r = await c.getJson<{ mainbranch?: { name: string } | null; links?: { html?: { href?: string } }; full_name?: string }>(repo(project));
      return { project: r.full_name ?? project, defaultBranch: r.mainbranch?.name ?? 'main', webUrl: r.links?.html?.href ?? `${web}/${project}` };
    },

    async getBranchSha(project, branch) {
      return (await c.getJson<{ target: { hash: string } }>(`${repo(project)}/refs/branches/${enc(branch)}`)).target.hash;
    },

    async listReviewerCandidates(project) {
      const who = await currentUser();
      const workspace = checkRepo(project).split('/')[0];
      const rows = await c.values<{ user: BbUser }>(`workspaces/${enc(workspace)}/members`, { maxPages: 2 });
      return rows
        .map((r) => r.user)
        .filter((u) => u.uuid !== who.id)
        .map((u): VcsMember => ({ ...user(u), usual: 0 }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 60);
    },

    async getReviewer(project, userId) {
      const found = (await provider.listReviewerCandidates(project)).find((m) => m.id === userId);
      if (!found) throw new Error(t('vcs.reviewer.noAccess', { user: String(userId) }));
      return found;
    },

    issueUrl: (project, iid) => `${web}/${project}/issues/${iid}`,
    mrUrl: (project, iid) => `${web}/${project}/pull-requests/${iid}`,
    noteUrl: (project, kind, iid, noteId) => `${web}/${project}/${kind === 'issue' ? 'issues' : 'pull-requests'}/${iid}#comment-${noteId}`,

    async planWrite(op: VcsWriteOp): Promise<VcsCommand[]> {
      const call = (method: VcsCommand['method'], endpoint: string, body?: unknown): VcsCommand => ({ vcs: 'bitbucket', via: 'api', method, endpoint, fields: {}, ...(body === undefined ? {} : { json: JSON.stringify(body) }) });
      switch (op.op) {
        case 'commentIssue':
          return [call('POST', `${repo(op.project)}/issues/${checkIid(op.iid)}/comments`, { content: { raw: op.body } })];
        case 'commentMr':
          return [call('POST', `${repo(op.project)}/pullrequests/${checkIid(op.iid)}/comments`, { content: { raw: op.body } })];
        case 'replyThread': {
          const parent = Number(op.threadId);
          if (!Number.isSafeInteger(parent) || parent <= 0) throw new VcsError('invalid', { detail: op.threadId });
          return [call('POST', `${repo(op.project)}/pullrequests/${checkIid(op.iid)}/comments`, { content: { raw: op.body }, parent: { id: parent } })];
        }
        case 'resolveThread': {
          const id = Number(op.threadId);
          if (!Number.isSafeInteger(id) || id <= 0) throw new VcsError('invalid', { detail: op.threadId });
          return [call('POST', `${repo(op.project)}/pullrequests/${checkIid(op.iid)}/comments/${id}/resolve`)];
        }
        case 'editIssueNote':
          return [call('PUT', `${repo(op.project)}/issues/${checkIid(op.iid)}/comments/${checkIid(Number(op.noteId))}`, { content: { raw: op.body } })];
        case 'setIssueLabels':
          throw new VcsError('unsupported', { kind: 'Bitbucket', what: t('vcs.write.labels') });
        case 'setIssueStatus':
          if (!ISSUE_STATES.includes(op.status)) throw new VcsError('invalid', { detail: op.status });
          return [call('PUT', `${repo(op.project)}/issues/${checkIid(op.iid)}`, { state: op.status })];
        case 'addReviewer': {
          const pr = await c.getJson<BbPr>(`${repo(op.project)}/pullrequests/${checkIid(op.iid)}`);
          const uuid = String(op.userId);
          uuidPath(uuid);
          const reviewers = [...(pr.reviewers ?? []).map((r) => r.uuid), uuid].filter((v, i, a) => a.indexOf(v) === i);
          return [call('PUT', `${repo(op.project)}/pullrequests/${op.iid}`, { title: pr.title, reviewers: reviewers.map((u) => ({ uuid: u })) })];
        }
        case 'setDraft': {
          const pr = await c.getJson<BbPr>(`${repo(op.project)}/pullrequests/${checkIid(op.iid)}`);
          return [call('PUT', `${repo(op.project)}/pullrequests/${op.iid}`, { title: pr.title, draft: op.draft })];
        }
        case 'playJob':
          throw new VcsError('unsupported', { kind: 'Bitbucket', what: t('vcs.write.playJob') });
        case 'editMrNote': {
          const id = checkIid(Number(op.noteId));
          return [call('PUT', `${repo(op.project)}/pullrequests/${checkIid(op.iid)}/comments/${id}`, { content: { raw: op.body } })];
        }
        case 'deleteNote':
          return [call('DELETE', `${repo(op.project)}/${op.target === 'issue' ? 'issues' : 'pullrequests'}/${checkIid(op.iid)}/comments/${checkIid(Number(op.noteId))}`)];
        case 'closeIssue':
          return [call('PUT', `${repo(op.project)}/issues/${checkIid(op.iid)}`, { state: 'closed' })];
        case 'createIssue':
          // Bitbucket's issues have no labels: the squad's label is left out (the request is linked in the run and in the description).
          return [call('POST', `${repo(op.project)}/issues`, { title: checkTitle(op.title), content: { raw: op.body } })];
        case 'createMr':
          return [call('POST', `${repo(op.project)}/pullrequests`, { title: op.title, description: op.body, source: { branch: { name: op.sourceBranch } }, destination: { branch: { name: op.targetBranch } } })];
        case 'submitReview': {
          const n = checkIid(op.iid);
          const url = `${repo(op.project)}/pullrequests/${n}`;
          const changes = op.comments.some((x) => x.line === null) ? await provider.listMrChanges(op.project, n) : [];
          const cmds = op.comments.map((x) => {
            // Bitbucket comments on one line of the old file (`from`) or the new one (`to`); there is no range and no comment on a whole file, so
            // a range stands on its last line and a file comment on the first line the change touches, saying so.
            if (x.line !== null) return call('POST', `${url}/comments`, { content: { raw: x.body }, inline: { path: x.path, [x.side === 'old' ? 'from' : 'to']: x.line } });
            const first = indexPatch(changes.find((f) => f.path === x.path)?.diff ?? '').first;
            const at = first?.new ?? first?.old ?? null;
            if (at === null) throw new VcsError('invalid', { detail: x.path });
            return call('POST', `${url}/comments`, { content: { raw: `${t('vcs.write.aboutFile')}\n\n${x.body}` }, inline: { path: x.path, [first?.new !== null ? 'to' : 'from']: at } });
          });
          cmds.push(call('POST', `${url}/comments`, { content: { raw: op.body } }));
          if (op.event === 'request_changes') cmds.push(call('POST', `${url}/request-changes`));
          return cmds;
        }
      }
    },

    validateCommand: validateBitbucketCommand,
  };
  return provider;
}

const R = '[\\w.-]+/[\\w.-]+';
const WRITES: { method: VcsCommand['method']; re: RegExp; allowed: string[]; required: string[] }[] = [
  { method: 'POST', re: new RegExp(`^repositories/${R}/issues/\\d+/comments$`), allowed: ['content'], required: ['content'] },
  { method: 'POST', re: new RegExp(`^repositories/${R}/pullrequests/\\d+/comments$`), allowed: ['content', 'parent', 'inline'], required: ['content'] },
  { method: 'PUT', re: new RegExp(`^repositories/${R}/pullrequests/\\d+/comments/\\d+$`), allowed: ['content'], required: ['content'] },
  { method: 'POST', re: new RegExp(`^repositories/${R}/pullrequests/\\d+/request-changes$`), allowed: [], required: [] },
  { method: 'POST', re: new RegExp(`^repositories/${R}/issues$`), allowed: ['title', 'content'], required: ['title', 'content'] },
  { method: 'POST', re: new RegExp(`^repositories/${R}/pullrequests$`), allowed: ['title', 'description', 'source', 'destination'], required: ['title', 'source', 'destination'] },
  { method: 'POST', re: new RegExp(`^repositories/${R}/pullrequests/\\d+/comments/\\d+/resolve$`), allowed: [], required: [] },
  { method: 'PUT', re: new RegExp(`^repositories/${R}/issues/\\d+/comments/\\d+$`), allowed: ['content'], required: ['content'] },
  { method: 'DELETE', re: new RegExp(`^repositories/${R}/issues/\\d+/comments/\\d+$`), allowed: [], required: [] },
  { method: 'DELETE', re: new RegExp(`^repositories/${R}/pullrequests/\\d+/comments/\\d+$`), allowed: [], required: [] },
  { method: 'PUT', re: new RegExp(`^repositories/${R}/issues/\\d+$`), allowed: ['state'], required: ['state'] },
  { method: 'PUT', re: new RegExp(`^repositories/${R}/pullrequests/\\d+$`), allowed: ['title', 'reviewers', 'draft'], required: ['title'] },
];

/** What a Bitbucket write may look like: the listed REST calls with only the listed body keys. */
export function validateBitbucketCommand(cmd: VcsCommand): void {
  const rule = WRITES.find((w) => w.method === cmd.method && w.re.test(cmd.endpoint));
  if (!rule || /\.\.|%2e/i.test(cmd.endpoint) || cmd.via !== 'api' || Object.keys(cmd.fields).length) throw new Error(t('vcs.validate.endpoint', { endpoint: cmd.endpoint }));
  let body: Record<string, unknown> = {};
  if (cmd.json !== undefined) {
    try {
      body = JSON.parse(cmd.json) as Record<string, unknown>;
    } catch {
      throw new Error(t('vcs.validate.body'));
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error(t('vcs.validate.body'));
  }
  const keys = Object.keys(body);
  if (keys.some((k) => !rule.allowed.includes(k)) || rule.required.some((k) => !keys.includes(k))) throw new Error(t('vcs.validate.body'));
  const content = body.content as { raw?: unknown } | undefined;
  if ('content' in body && typeof content?.raw !== 'string') throw new Error(t('vcs.validate.body'));
  if ('state' in body && !ISSUE_STATES.includes(String(body.state))) throw new Error(t('vcs.validate.body'));
  if ('reviewers' in body) {
    const list = body.reviewers;
    if (!Array.isArray(list) || !list.every((r) => typeof (r as { uuid?: unknown })?.uuid === 'string' && UUID.test((r as { uuid: string }).uuid))) throw new Error(t('vcs.validate.body'));
  }
  if ('parent' in body && !Number.isSafeInteger((body.parent as { id?: unknown })?.id)) throw new Error(t('vcs.validate.body'));
  if ('draft' in body && typeof body.draft !== 'boolean') throw new Error(t('vcs.validate.body'));
  if ('title' in body && typeof body.title !== 'string') throw new Error(t('vcs.validate.body'));
  if (cmd.endpoint.endsWith('/issues') && !(typeof body.title === 'string' && body.title.trim() && body.title.length <= ISSUE_TITLE_MAX)) throw new Error(t('vcs.validate.body'));
  if ('description' in body && typeof body.description !== 'string') throw new Error(t('vcs.validate.body'));
  if ('inline' in body) {
    const i = body.inline as { path?: unknown; to?: unknown; from?: unknown } | null;
    const ok = !!i && typeof i === 'object' && typeof i.path === 'string' && Object.keys(i).every((k) => ['path', 'to', 'from'].includes(k)) && ['to', 'from'].every((k) => !(k in i) || Number.isSafeInteger((i as Record<string, unknown>)[k]));
    if (!ok) throw new Error(t('vcs.validate.body'));
  }
  for (const k of ['source', 'destination']) {
    if (k in body && !(typeof (body[k] as { branch?: { name?: unknown } })?.branch?.name === 'string' && /^[\w][\w./-]*$/.test(String((body[k] as { branch: { name: string } }).branch.name)))) throw new Error(t('vcs.validate.body'));
  }
}
