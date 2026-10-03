import type { StageDef, StageMappingRule, VcsKind } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import { stageOf, stagesFor } from './stages';
import type { VcsIssue, VcsMr, VcsProvider } from './types';
import { pool } from './util';

// The generic card source: my assigned open issues and their merge or pull requests, built from the provider. It stands in for an
// external card source command when the workspace has none, and produces the same items (issue, mr) that command did.

export interface CardItem {
  kind: 'issue' | 'mr';
  ref: string;
  project: string;
  iid: number;
  title: string;
  stage: string | null;
  web_url: string;
  issue_refs?: string[];
  blockers: string[];
  pending: string[];
  changes: { field: string; from: unknown; to: unknown }[];
  manual_note: string | null;
  labels?: string[];
  // Issue items only
  milestone?: string | null;
  updated_at?: string | null;
  // Merge request items only
  state?: string;
  roles?: string[];
  draft?: boolean;
  has_conflicts?: boolean;
  pipeline?: string | null;
  pipeline_url?: string | null;
  project_id?: number | string;
}

export interface CardReport {
  generated_at: string;
  items: CardItem[];
}

/** What is compared from one day to the next to tell what changed. */
export interface CardSnapshot {
  stage: string | null;
  pipeline: string | null;
  draft: boolean;
  conflicts: boolean;
  state: string;
}

export interface CardState {
  /** Local date (yyyy-mm-dd) the baseline belongs to. */
  date: string;
  /** What the cards looked like when the day started (the last state of the day before). */
  baseline: Record<string, CardSnapshot>;
  current: Record<string, CardSnapshot>;
}

export interface CardSourceOptions {
  /** "group/name" of the issue project; null: every project the host lists for me. */
  issueProject: string | null;
  /** "app#" for "app#101"; empty: "<repo>#<n>". */
  refPrefix: string;
  /** devCycle.stages; empty: the host's defaults. */
  stages: StageDef[];
  /** devCycle.stageMapping: what a label, a status or a state of this host means, checked before the stage patterns. */
  stageMapping?: StageMappingRule[];
  kind: VcsKind;
  state: CardState | null;
  now: () => Date;
  /** Issues with no merge request in the text of any: how many are asked the host about (one read each). */
  linkLookups?: number;
  /** "group/name" of the workspace's repos on this host: my merge requests elsewhere are not this workspace's. Empty: every project. */
  projects?: string[];
}

const short = (project: string): string => project.split('/').pop() ?? project;
const dayOf = (d: Date): string => d.toLocaleDateString('sv-SE');

function issueRef(issue: VcsIssue, o: CardSourceOptions): string {
  const own = o.issueProject !== null && issue.project === o.issueProject;
  return own ? `${o.refPrefix}${issue.iid}` : `${short(issue.project)}#${issue.iid}`;
}

function mrBlockers(m: VcsMr): string[] {
  const out: string[] = [];
  if (m.ci?.status === 'failed') out.push(t('vcs.card.ciFailed'));
  if (m.hasConflicts) out.push(t('vcs.card.conflicts'));
  if (m.approvals?.changesRequestedBy.length) out.push(t('vcs.card.changesRequested', { who: m.approvals.changesRequestedBy.join(', ') }));
  return out;
}

function mrPending(m: VcsMr): string[] {
  const out: string[] = [];
  if (m.draft) out.push(t('vcs.card.draft'));
  else if (m.roles.includes('reviewer') && !m.roles.includes('author')) out.push(t('vcs.card.reviewRequested'));
  else if (m.state === 'open' && m.approvals && !m.approvals.approved && !m.approvals.changesRequestedBy.length) out.push(t('vcs.card.awaitingReview'));
  if (m.ci?.status === 'running' || m.ci?.status === 'pending') out.push(t('vcs.card.ciRunning'));
  if (m.ci?.status === 'manual') out.push(t('vcs.card.ciManual'));
  return out;
}

function diff(before: CardSnapshot | undefined, now: CardSnapshot): CardItem['changes'] {
  if (!before) return [];
  const out: CardItem['changes'] = [];
  if (before.stage !== now.stage) out.push({ field: 'stage', from: before.stage, to: now.stage });
  if (before.pipeline !== now.pipeline) out.push({ field: 'pipeline', from: before.pipeline, to: now.pipeline });
  if (before.draft !== now.draft) out.push({ field: 'draft', from: before.draft, to: now.draft });
  if (before.conflicts !== now.conflicts) out.push({ field: 'conflicts', from: before.conflicts, to: now.conflicts });
  if (before.state !== now.state) out.push({ field: 'state', from: before.state, to: now.state });
  return out;
}

/** Builds the report and the state to save. Reads only. */
export async function buildCardReport(provider: VcsProvider, o: CardSourceOptions): Promise<{ report: CardReport; state: CardState }> {
  const stages = stagesFor(o.kind, o.stages);
  const today = dayOf(o.now());
  const baseline = o.state ? (o.state.date === today ? o.state.baseline : o.state.current) : {};

  const [issues, allMrs] = await Promise.all([
    provider.caps.issues ? provider.listMyIssues({ project: o.issueProject, limit: 100 }) : Promise.resolve([] as VcsIssue[]),
    provider.listMyMrs({ roles: ['author', 'reviewer'], detail: true, limit: 60 }),
  ]);

  const projects = new Set((o.projects ?? []).map((p) => p.toLowerCase()));
  const mrs = projects.size ? allMrs.filter((m) => projects.has(m.project.toLowerCase())) : allMrs;

  // Merge requests of each issue: by the numbers the text of the merge request names, then by asking the host for the issues left without.
  const byIssue = new Map<number, VcsMr[]>();
  const link = (iid: number, m: VcsMr) => {
    const list = byIssue.get(iid) ?? [];
    if (!list.some((x) => x.project === m.project && x.iid === m.iid)) byIssue.set(iid, [...list, m]);
  };
  const wanted = new Set(issues.map((i) => i.iid));
  for (const m of mrs) for (const n of m.issueRefs) if (wanted.has(n)) link(n, m);
  const unlinked = issues.filter((i) => !byIssue.has(i.iid)).slice(0, o.linkLookups ?? 25);
  await pool(unlinked, 4, async (i) => {
    try {
      for (const m of await provider.linkedMrs(i.project, i.iid)) link(i.iid, m);
    } catch (e) {
      console.error(`[vcs:cards] ${i.project}#${i.iid}`, (e as Error).message);
    }
  });

  const current: Record<string, CardSnapshot> = {};
  const items: CardItem[] = [];
  const refsOf = new Map<string, string[]>();
  const issueByNumber = new Map(issues.map((i) => [i.iid, i]));

  for (const issue of issues) {
    const linked = byIssue.get(issue.iid) ?? [];
    const stage = stageOf(issue, linked, stages, o.stageMapping, o.kind)?.label ?? null;
    const ref = issueRef(issue, o);
    const snap: CardSnapshot = { stage, pipeline: null, draft: false, conflicts: false, state: issue.state };
    current[ref] = snap;
    for (const m of linked) refsOf.set(`${m.project}!${m.iid}`, [...(refsOf.get(`${m.project}!${m.iid}`) ?? []), String(issue.iid)]);
    items.push({
      kind: 'issue',
      ref,
      project: issue.project,
      iid: issue.iid,
      title: issue.title,
      stage,
      web_url: issue.webUrl,
      blockers: issue.labels.filter((l) => /blocked|bloquead/i.test(l)).map((l) => t('vcs.card.blockedLabel', { label: l })),
      pending: [],
      changes: diff(baseline[ref], snap),
      manual_note: null,
      labels: issue.labels,
      milestone: issue.milestone,
      updated_at: issue.updatedAt,
      project_id: issue.project,
    });
  }

  for (const m of mrs) {
    const ref = `${short(m.project)}!${m.iid}`;
    const snap: CardSnapshot = { stage: null, pipeline: m.ci?.status ?? null, draft: m.draft, conflicts: m.hasConflicts === true, state: m.state };
    current[ref] = snap;
    const refs = refsOf.get(`${m.project}!${m.iid}`) ?? [];
    items.push({
      kind: 'mr',
      ref,
      project: m.project,
      iid: m.iid,
      title: m.title,
      stage: null,
      web_url: m.webUrl,
      issue_refs: refs.length ? refs : m.issueRefs.filter((n) => issueByNumber.has(n)).map(String),
      blockers: mrBlockers(m),
      pending: mrPending(m),
      changes: diff(baseline[ref], snap),
      manual_note: null,
      state: m.state === 'open' ? 'opened' : m.state,
      roles: m.roles,
      draft: m.draft,
      has_conflicts: m.hasConflicts === true,
      pipeline: m.ci?.status ?? null,
      pipeline_url: m.ci?.webUrl ?? null,
      project_id: m.project,
    });
  }

  return { report: { generated_at: o.now().toISOString(), items }, state: { date: today, baseline: o.state?.date === today ? o.state.baseline : (o.state?.current ?? {}), current } };
}
