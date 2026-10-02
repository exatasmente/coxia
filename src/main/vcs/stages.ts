import type { StageDef, StageKind, VcsKind } from '../../shared/config/types';
import { matchStage } from '../../shared/config/stages';
import type { VcsIssue, VcsMr } from './types';

// Provider states in the app's stage vocabulary. The workspace's own mapping (`devCycle.stages`: name -> kind and rank, filled by a dev-cycle
// template) always wins; when it is empty, these defaults say what a status, a label or a pull request state means on each host.
// The list is in matching priority order: the first stage a text matches wins ("Approved in testing" is QA-approved, not just approved).

const RANK: Record<StageKind, number> = { backlog: 1, development: 2, returned: 3, review: 4, reviewApproved: 5, qa: 6, qaApproved: 7, done: 8 };

function stage(kind: StageKind, label: string, match: string[]): StageDef {
  return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label, match, kind, rank: RANK[kind] };
}

const COMMON: StageDef[] = [
  stage('returned', 'Returned', ['failed testing', 'test fail', 'rejected', 'changes requested', 'needs work', 'returned']),
  stage('qaApproved', 'QA approved', ['approved in testing', 'test ok', 'qa approved', 'qa passed', 'tested']),
  stage('qa', 'In QA', ['ready (for|to) test', 'in testing', 'in qa', 'qa\\b', 'verification', 'to verify']),
  stage('reviewApproved', 'Review approved', ['approved in code review', 'code review ok', 'review approved', 'review ok', 'lgtm', '^approved$']),
  stage('review', 'In review', ['code review', 'in review', 'ready for review', 'needs review', 'review']),
  stage('development', 'In development', ['in development', 'in progress', 'doing', 'wip', 'started', 'active', 'working']),
  stage('backlog', 'Backlog', ['^open$', '^new$', '^to ?do$', 'backlog', 'ready for planning', 'triage', 'icebox', 'on hold']),
  stage('done', 'Done', ['^done$', '^closed$', '^resolved$', '^complete', '^shipped$', '^released$']),
];

// Bitbucket's issue tracker has a fixed set of states.
const BITBUCKET: StageDef[] = [
  stage('done', 'Done', ['^resolved$', '^closed$', '^invalid$', '^duplicate$', '^wontfix$']),
  stage('backlog', 'Backlog', ['^new$', '^open$', '^on hold$']),
];

export const DEFAULT_STAGES: Record<VcsKind, StageDef[]> = {
  gitlab: COMMON,
  github: COMMON,
  bitbucket: [...BITBUCKET.slice(0, 1), ...COMMON.filter((s) => s.kind !== 'done' && s.kind !== 'backlog'), ...BITBUCKET.slice(1)],
};

/** The configured stages, or the defaults of the host when the workspace has none. */
export function stagesFor(kind: VcsKind, configured: StageDef[]): StageDef[] {
  return configured.length ? configured : DEFAULT_STAGES[kind];
}

/** A scoped label ("STAGE:: Doing", "stage/doing") also offers its last part as text. */
function texts(issue: VcsIssue): string[] {
  const out: string[] = [];
  if (issue.status) out.push(issue.status);
  for (const l of issue.labels) {
    out.push(l);
    const scoped = /^[\w .-]+(?:::|\/)\s*(.+)$/.exec(l);
    if (scoped) out.push(scoped[1]);
  }
  return out;
}

/** The stage kind an issue is in when no status or label says: from what its merge requests are doing. */
export function kindFromWork(issue: VcsIssue, mrs: VcsMr[]): StageKind {
  if (issue.state === 'closed') return 'done';
  const open = mrs.filter((m) => m.state === 'open');
  if (!open.length) return mrs.some((m) => m.state === 'merged') ? 'qa' : 'backlog';
  if (open.every((m) => m.draft)) return 'development';
  if (open.some((m) => m.approvals?.changesRequestedBy.length)) return 'returned';
  if (open.some((m) => m.approvals?.approved)) return 'reviewApproved';
  return 'review';
}

/** The stage of an issue: the highest-ranked stage a status or label matches, else the one its merge requests imply. null: the stages have none to offer. */
export function stageOf(issue: VcsIssue, mrs: VcsMr[], stages: StageDef[]): StageDef | null {
  const hits = texts(issue)
    .map((text) => matchStage(stages, text))
    .filter((s): s is StageDef => s !== null);
  if (hits.length) return hits.reduce((a, b) => (b.rank > a.rank ? b : a));
  const kind = kindFromWork(issue, mrs);
  return stages.find((s) => s.kind === kind) ?? null;
}
