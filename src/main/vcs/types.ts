import type { VcsKind } from '../../shared/config/types';
import type { VcsCaps } from '../../shared/vcsCaps';
import type { VcsCommand } from '../../shared/types';

// The neutral shapes every provider (GitLab, GitHub, Bitbucket Cloud) returns, and the interface the rest of the app talks to.
// Vocabulary: a "project" is the repository path as the host writes it ("group/sub/name" on GitLab, "owner/repo" on GitHub,
// "workspace/repo" on Bitbucket); an "MR" is a merge request or pull request; a "thread" is a discussion on an MR.
// Everything here is read-only. A provider never writes: it only DESCRIBES a write (`planWrite`), and the description runs
// through the confirmation flow (proposeVcsAction in actions.ts) and the audit log, nowhere else.

export interface VcsUser {
  id: string | number;
  username: string;
  name: string;
  webUrl: string | null;
}

export type VcsIssueState = 'open' | 'closed';

export interface VcsIssue {
  project: string;
  iid: number;
  title: string;
  state: VcsIssueState;
  /** The tracker's own workflow status (GitLab work item status, Bitbucket issue state); null when the host has none. */
  status: string | null;
  labels: string[];
  milestone: string | null;
  assignees: string[];
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  webUrl: string;
  /** The description as the author wrote it; null or missing when the host did not send one (list reads may omit it). */
  body?: string | null;
  /** Provider global id (GitLab work item gid); filled by a status read only. */
  nodeId?: string | null;
}

export interface VcsComment {
  id: string | number;
  author: string;
  body: string;
  createdAt: string;
  /** Machine-generated entry (GitLab system note). */
  system: boolean;
  webUrl: string | null;
}

/** Normalized CI state. */
export type VcsCiStatus = 'success' | 'failed' | 'running' | 'pending' | 'manual' | 'canceled' | 'skipped';

export interface VcsCi {
  status: VcsCiStatus;
  /** The host's own word for it (GitLab pipeline status, Bitbucket state), for display. */
  raw: string;
  /** Provider run id when there is one single run to open (GitLab pipeline id, GitHub workflow run id). */
  runId: string | number | null;
  webUrl: string | null;
}

export interface VcsApprovals {
  approved: boolean;
  by: string[];
  /** Reviewers that asked for changes (GitHub). */
  changesRequestedBy: string[];
}

export type VcsMrState = 'open' | 'merged' | 'closed';

export interface VcsMr {
  project: string;
  iid: number;
  title: string;
  state: VcsMrState;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  sha: string;
  webUrl: string;
  author: string;
  reviewers: VcsUser[];
  /** null when the list endpoint of the host does not carry it (the detail read fills it). */
  approvals: VcsApprovals | null;
  ci: VcsCi | null;
  /** null: the host has not computed it (or does not expose it). */
  hasConflicts: boolean | null;
  /** Commits the target has that the branch does not; filled only when asked for. */
  behind: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  /** The text the issue links are read from (description). */
  description: string;
  /** Roles of the current user on it: author and/or reviewer (list calls only). */
  roles: ('author' | 'reviewer')[];
  /** Issue numbers the host says this MR closes or references; empty when unknown. */
  issueRefs: number[];
}

export interface VcsThread {
  id: string;
  resolvable: boolean;
  resolved: boolean;
  path: string | null;
  line: number | null;
  notes: VcsComment[];
}

export interface VcsCiRun {
  id: string | number;
  status: string;
  createdAt: string;
  webUrl: string | null;
}

export interface VcsCiJob {
  id: string | number;
  name: string;
  stage: string;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  runId: string | number | null;
}

export interface VcsCommit {
  sha: string;
  date: string;
}

export interface VcsFileChange {
  path: string;
  /** Unified diff text of the file; empty when the host collapsed it. */
  diff: string;
}

export interface VcsMember extends VcsUser {
  /** How many of my recent MRs in the project this person reviewed. */
  usual: number;
}

export interface VcsRepo {
  project: string;
  defaultBranch: string;
  webUrl: string;
}

export type { VcsCaps };

export type VcsTransport = 'cli' | 'api';

// ---------------------------------------------------------------- writes (described, never run, by the provider)

/** One comment of a review: on a line (or a range) of a file, or on the file itself when `line` is null. */
export interface ReviewComment {
  path: string;
  /** The line it stands on (the last line of a range) as numbered in the side's file; null: a comment on the whole file. */
  line: number | null;
  /** The first line of a range; null for a single line. */
  startLine: number | null;
  /** new: the file after the change. old: a line the change removes. */
  side: 'new' | 'old';
  body: string;
}

export type ReviewEvent = 'request_changes' | 'comment';

export type VcsWriteOp =
  | { op: 'commentIssue'; project: string; iid: number; body: string }
  | { op: 'commentMr'; project: string; iid: number; body: string }
  | { op: 'replyThread'; project: string; iid: number; threadId: string; body: string }
  | { op: 'resolveThread'; project: string; iid: number; threadId: string }
  | { op: 'editIssueNote'; project: string; iid: number; noteId: string | number; body: string }
  | { op: 'setIssueLabels'; project: string; iid: number; add: string[]; remove: string[] }
  /** `status` is the provider's id of the target status; `nodeId` the issue's global id when the caller already read it. */
  | { op: 'setIssueStatus'; project: string; iid: number; status: string; nodeId?: string }
  | { op: 'addReviewer'; project: string; iid: number; userId: string | number; username: string }
  | { op: 'setDraft'; project: string; iid: number; draft: boolean; title?: string }
  | { op: 'playJob'; project: string; jobId: number }
  /** A note on a merge or pull request edited in place (the conversation comment a stage left, not a review thread). */
  | { op: 'editMrNote'; project: string; iid: number; noteId: string | number; body: string }
  /**
   * One review round: the general comment (`body`), the comments on lines and on files, and the verdict. Never an approval. `commitSha` is the head the
   * positions were taken from; the provider anchors every comment to it.
   */
  | { op: 'submitReview'; project: string; iid: number; event: ReviewEvent; body: string; comments: ReviewComment[]; commitSha: string }
  /**
   * A comment deleted. `target` says which kind of note it is, because hosts keep them apart: the conversation comment of an issue (`issue`) or of a
   * merge or pull request (`mr`), and a comment of a review on a line or a file (`review`; on GitHub a different resource from the conversation's).
   */
  | { op: 'deleteNote'; project: string; iid: number; noteId: string | number; target: 'issue' | 'mr' | 'review' }
  /**
   * A new issue in a project, with its description and the labels it is born with (the squad's label on the issue another squad's request turns into). A host
   * with no labels on issues (Bitbucket) leaves them out.
   */
  | { op: 'createIssue'; project: string; title: string; body: string; labels: string[] }
  /** A pull request from a branch of the same repository. */
  | { op: 'createMr'; project: string; title: string; body: string; sourceBranch: string; targetBranch: string };

export type VcsWriteName = VcsWriteOp['op'];

/** A write as the confirmation screen shows it and the executor runs it. Never contains a token. */
export type { VcsCommand } from '../../shared/types';

// ---------------------------------------------------------------- the provider

export interface MyMrOptions {
  roles?: ('author' | 'reviewer')[];
  /** Fill CI and approvals with one more read per MR. */
  detail?: boolean;
  limit?: number;
}

export interface IssueListOptions {
  /** The project whose open issues are listed, whoever they are assigned to. */
  project: string;
  /** `labels` keeps the issues that carry any of `labels`. */
  scope: 'all' | 'labels';
  labels?: string[];
  limit?: number;
}

export interface VcsProvider {
  readonly kind: VcsKind;
  readonly id: string;
  readonly host: string;
  readonly transport: VcsTransport;
  readonly caps: VcsCaps;

  currentUser(): Promise<VcsUser>;

  // issues
  listMyIssues(opts?: { project?: string | null; limit?: number }): Promise<VcsIssue[]>;
  /** The open issues of one project, newest update first; throws `unsupported` for a label scope on a host whose issues have no labels. */
  listIssues(opts: IssueListOptions): Promise<VcsIssue[]>;
  /** `status` also reads the workflow status and the global id (a second call on GitLab); its failure is the caller's. */
  getIssue(project: string, iid: number, opts?: { status?: boolean }): Promise<VcsIssue>;
  /** Workflow status by issue number; an empty map when the host has none or the read failed. */
  issueStatuses(project: string, iids: number[]): Promise<Map<number, string>>;
  listIssueComments(project: string, iid: number): Promise<VcsComment[]>;
  searchIssues(project: string, query: { text: string; createdAfter: string }): Promise<VcsIssue[]>;

  // merge / pull requests
  listMyMrs(opts?: MyMrOptions): Promise<VcsMr[]>;
  getMr(project: string, iid: number, opts?: { behind?: boolean; approvals?: boolean }): Promise<VcsMr>;
  /** MRs that reference the issue (open or merged), in the issue's own project. */
  linkedMrs(project: string, iid: number): Promise<VcsMr[]>;
  searchMrs(project: string, query: { text: string; createdAfter: string }): Promise<VcsMr[]>;
  listMrCommits(project: string, iid: number): Promise<VcsCommit[]>;
  listMrChanges(project: string, iid: number): Promise<VcsFileChange[]>;
  listMrCi(project: string, iid: number): Promise<VcsCiRun[]>;
  listCiJobs(project: string, runId: string | number): Promise<VcsCiJob[]>;
  getCiJob(project: string, jobId: number): Promise<VcsCiJob>;
  listMrComments(project: string, iid: number): Promise<VcsComment[]>;
  listMrThreads(project: string, iid: number): Promise<VcsThread[]>;
  getMrThread(project: string, iid: number, threadId: string): Promise<VcsThread>;

  // repository
  getRepo(project: string): Promise<VcsRepo>;
  getBranchSha(project: string, branch: string): Promise<string>;
  listReviewerCandidates(project: string): Promise<VcsMember[]>;
  /** The user with this id, only when allowed to review in the project (throws otherwise). */
  getReviewer(project: string, userId: string | number): Promise<VcsUser>;

  // links
  issueUrl(project: string, iid: number): string;
  mrUrl(project: string, iid: number): string;
  noteUrl(project: string, kind: 'issue' | 'mr', iid: number, noteId: string | number): string;

  /** Describes a write as the commands that would run, reading what it needs to be exact. Runs nothing. */
  planWrite(op: VcsWriteOp): Promise<VcsCommand[]>;
  /** Checks that a command (possibly read back from disk) has a shape this provider may run. Throws the reason. */
  validateCommand(command: VcsCommand): void;
}

/** What an executor tells the caller besides the text it returns. */
export interface ExecMeta {
  /** Filled with the HTTP status when the host answered. */
  code?: number;
  /** Filled with what the host answered, parsed, when it was JSON: the id of the comment or the number of the pull request that was just made. */
  response?: unknown;
}
