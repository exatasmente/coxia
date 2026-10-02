import type { QuickTransitionRule, VcsKind } from '../shared/config/types';
import type { Card } from '../shared/types';
import type { QuickContext, QuickIssue, QuickJob, QuickMember, QuickMr, QuickRequest, QuickResult, QuickTransition } from '../shared/gitlabQuick';
import { listActions, proposeVcsAction, proposeVcsCommands } from './actions';
import { getSettings } from './config';
import { vcsName } from './cyclePrompts';
import { getConfig, isIssueRef, issueProjectKey, rc } from './workspaceConfig';
import type { Module } from './module';
import { readReport } from './report';
import type { Notice } from './scheduler';
import { vcsProvider, vcsReady } from './vcs';
import { undrafted } from './vcs/gitlab';
import type { VcsCiJob, VcsWriteOp } from './vcs/types';
import { t } from '../shared/i18n';

// The quick actions of a card (reviewer, draft, manual jobs, issue status) on whichever code host the workspace uses. Every write is
// only a proposal: it waits in Ações for the user's "seguir" (proposeVcsAction), then runs through the audited executor.

const JOB_EVERY_MIN = 30;
// Build, release prep and deploy belong to the QA flow (the team's release flow): the app never plays them.
const QA_OWNED = /^(deploy|build|pre_build|set_version)/i;
// The AI review job is left to the reviewers' flow: proposing it on every MR was noise.
const SKIPPED_JOBS = /ai_code_review/i;

// The status changes come from devCycle.quickTransitions: their status ids are the custom statuses of one GitLab instance.
// Review and QA exits are never listed there, the app only offers what the developer moves.
type Rule = QuickTransitionRule;

function activeRules(): Rule[] {
  return rc().primaryVcs?.kind === 'gitlab' ? getConfig().devCycle.quickTransitions : [];
}

interface ReportMr {
  kind: string;
  ref: string;
  project: string;
  project_id?: number;
  iid: number;
  title: string;
  state: string;
  roles: string[];
  draft: boolean;
  has_conflicts: boolean;
  pipeline: string | null;
  pipeline_url: string | null;
  issue_refs: string[];
}

const day = () => new Date().toLocaleDateString('sv-SE');

function manualJobs(jobs: VcsCiJob[]): QuickJob[] {
  return jobs.filter((j) => j.status === 'manual' && !QA_OWNED.test(j.stage) && !QA_OWNED.test(j.name) && !SKIPPED_JOBS.test(j.name)).map((j) => ({ id: Number(j.id), name: j.name, stage: j.stage }));
}

async function mrInfo(projectPath: string, iid: number, user: string): Promise<QuickMr> {
  const prov = vcsProvider();
  const m = await prov.getMr(projectPath, iid);
  const jobs = prov.caps.manualJobs && m.ci?.runId != null ? await prov.listCiJobs(projectPath, m.ci.runId) : [];
  return {
    ref: `${projectPath.split('/').pop()}!${iid}`,
    projectPath,
    iid,
    title: m.title,
    webUrl: m.webUrl,
    draft: m.draft,
    hasConflicts: m.hasConflicts ?? false,
    pipeline: m.ci?.raw ?? null,
    reviewers: m.reviewers.map((r) => ({ id: r.id, username: r.username, name: r.name })),
    author: m.author,
    mine: m.author === user,
    manualJobs: m.state === 'open' ? manualJobs(jobs) : [],
  };
}

function transitionsFor(status: string | null, labels: string[]): QuickTransition[] {
  const stage = labels.filter((l) => /^STAGE\s*::/.test(l));
  return activeRules().map((r) => {
    const base = { to: r.to, addLabel: stage.includes(r.label) ? null : r.label, removeLabels: stage.filter((l) => r.removable.includes(l)) };
    if (status === r.to) return { ...base, allowed: false, reason: t('main.quick.sameStatus') };
    if (!status || !r.from.includes(status)) return { ...base, allowed: false, reason: t('main.quick.cannotLeave', { status: status ?? t('main.quick.noStatus') }) };
    const foreign = stage.filter((l) => l !== r.label && !r.removable.includes(l));
    if (foreign.length) return { ...base, allowed: false, reason: t('main.quick.foreign', { labels: foreign.join(', '), vcs: vcsName() }) };
    return { ...base, allowed: true, reason: null };
  });
}

async function readIssue(iid: number): Promise<QuickIssue & { gid: string | null; title: string }> {
  const issue = await vcsProvider().getIssue(issueProjectKey(), iid, { status: true });
  const stageLabels = issue.labels.filter((l) => /^STAGE\s*::/.test(l));
  return { iid, status: issue.status, stageLabels, transitions: transitionsFor(issue.status, issue.labels), gid: issue.nodeId ?? null, title: issue.title };
}

async function context(card: Card): Promise<QuickContext> {
  const user = (await vcsProvider().currentUser()).username;
  const warnings: string[] = [];
  const mrs = (
    await Promise.all(
      card.mrPaths.map((m) =>
        mrInfo(m.project, m.iid, user).catch((e: Error) => {
          warnings.push(`${m.ref}: ${e.message.split('\n')[0]}`);
          return null;
        }),
      ),
    )
  ).filter((m): m is QuickMr => !!m);
  let issue: QuickIssue | null = null;
  if (isIssueRef(card.ref)) {
    try {
      const { gid: _gid, title: _title, ...rest } = await readIssue(Number(card.iid));
      issue = rest;
    } catch (e) {
      warnings.push(`issue ${card.ref}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return { me: user, issue, mrs, warnings };
}

async function members(projectPath: string): Promise<QuickMember[]> {
  return (await vcsProvider().listReviewerCandidates(projectPath)).map((m) => ({ id: m.id, username: m.username, name: m.name, usual: m.usual }));
}

type ProposeInput = Omit<Parameters<typeof proposeVcsAction>[0], 'command'>;

async function propose(input: ProposeInput, op: VcsWriteOp, out: QuickResult): Promise<void> {
  const commands = await vcsProvider().planWrite(op);
  for (const action of proposeVcsCommands(input, commands)) {
    if (action) out.created.push(input.summary);
    else out.duplicated += 1;
  }
}

const issueOf = (refs: string[]): number => Number(refs.map((r) => /(\d+)$/.exec(r)?.[1]).find(Boolean) ?? 0);

async function proposeManual(req: QuickRequest): Promise<QuickResult> {
  const out: QuickResult = { created: [], duplicated: 0 };
  const prov = vcsProvider();
  if (req.kind === 'transition') {
    const rule = activeRules().find((r) => r.to === req.to);
    if (!rule) throw new Error(t('main.quick.notAllowedTo', { to: req.to }));
    const issue = await readIssue(req.issue);
    const step = issue.transitions.find((x) => x.to === req.to);
    if (!step?.allowed) throw new Error(step?.reason ?? t('main.quick.notAllowed'));
    const project = issueProjectKey();
    const title = issue.title;
    if (issue.gid) {
      await propose(
        {
          key: `quick:status:${req.issue}:${step.to}:${day()}`,
          issue: req.issue,
          issueTitle: title,
          stage: issue.stageLabels.join(', '),
          summary: t('main.quick.statusSummary', { issue: req.issue, from: String(issue.status), to: step.to }),
          detail: t('main.quick.statusDetail'),
        },
        { op: 'setIssueStatus', project, iid: req.issue, status: String(rule.id), nodeId: issue.gid },
        out,
      );
    }
    const labels: VcsWriteOp = { op: 'setIssueLabels', project, iid: req.issue, add: step.addLabel ? [step.addLabel] : [], remove: step.removeLabels };
    const hasLabelChange = (labels.add.length || labels.remove.length) > 0;
    if (hasLabelChange) {
      await propose(
        {
          key: `quick:label:${req.issue}:${step.to}:${day()}`,
          issue: req.issue,
          issueTitle: title,
          stage: issue.stageLabels.join(', '),
          summary: t('main.quick.labelSummary', { issue: req.issue, change: `${step.removeLabels.length ? `${step.removeLabels.join(', ')} → ` : ''}${step.addLabel ?? ''}`, from: String(issue.status), to: step.to }),
        },
        labels,
        out,
      );
    }
    if (!issue.gid && !hasLabelChange) throw new Error(t('main.quick.nothingToChange'));
    return out;
  }

  if (req.kind === 'play') {
    if (!prov.caps.manualJobs) throw new Error(t('main.quick.noManualJobs'));
    const job = await prov.getCiJob(req.projectPath, req.jobId);
    if (!manualJobs([job]).length) throw new Error(t('main.quick.cannotPlay', { job: job.name }));
    await propose(
      {
        key: `quick:play:${job.id}`,
        issue: 0,
        issueTitle: `${req.projectPath} · pipeline ${job.runId}`,
        summary: t('main.quick.runJobIn', { job: job.name, project: req.projectPath, run: String(job.runId) }),
      },
      { op: 'playJob', project: req.projectPath, jobId: Number(job.id) },
      out,
    );
    return out;
  }
  const ref = `${req.projectPath.split('/').pop()}!${req.mrIid}`;
  const mr = await prov.getMr(req.projectPath, req.mrIid);
  if (mr.state !== 'open') throw new Error(t('main.quick.notOpen', { ref }));
  if (mr.author !== (await prov.currentUser()).username) throw new Error(t('main.quick.readOnly', { ref, author: mr.author }));
  const issue = req.issue ?? 0;
  if (req.kind === 'undraft') {
    if (!mr.draft) throw new Error(t('main.quick.notDraft', { ref }));
    // GitLab marks a draft by a prefix in the title; GitHub and Bitbucket by a flag.
    const title = prov.kind === 'gitlab' ? undrafted(mr.title) : undefined;
    if (title !== undefined && title === mr.title) throw new Error(t('main.quick.noDraftPrefix', { vcs: vcsName() }));
    await propose(
      { key: `quick:undraft:${ref}`, issue, issueTitle: mr.title, summary: t('main.quick.undraft', { ref }) },
      { op: 'setDraft', project: req.projectPath, iid: req.mrIid, draft: false, ...(title !== undefined ? { title } : {}) },
      out,
    );
    return out;
  }
  const person = await prov.getReviewer(req.projectPath, req.userId);
  const had = mr.reviewers.map((r) => `@${r.username}`);
  await propose(
    {
      key: `quick:reviewer:${ref}:${person.id}:${day()}`,
      issue,
      issueTitle: mr.title,
      summary: t('main.quick.reviewer', { ref, user: person.username, draft: mr.draft ? t('main.quick.reviewerDraft') : '' }),
      detail: had.length && prov.kind === 'gitlab' ? t('main.quick.replaceReviewers', { list: had.join(', ') }) : undefined,
    },
    { op: 'addReviewer', project: req.projectPath, iid: req.mrIid, userId: person.id, username: person.username },
    out,
  );
  return out;
}

async function readMrs(): Promise<ReportMr[]> {
  return ((await readReport()).items as unknown as ReportMr[]).filter((i) => i.kind === 'mr');
}

export interface AutoProposal {
  key: string;
  issue: number;
  issueTitle: string;
  summary: string;
  /** The write, as a neutral operation; the provider turns it into the command. */
  op: VcsWriteOp;
  notify: { title: string; body: string };
}

const projectOf = (m: ReportMr): string => String(m.project_id ?? m.project);

// Pure on purpose: the integration script feeds it the real report plus the job lists.
export function autoProposals(items: ReportMr[], jobsOf: (m: ReportMr) => VcsCiJob[], kind: VcsKind = 'gitlab'): AutoProposal[] {
  const out: AutoProposal[] = [];
  for (const m of items) {
    if (m.state !== 'opened' || !m.roles.includes('author')) continue;
    const issue = issueOf(m.issue_refs ?? []);
    const body = t('main.quick.created');
    if (m.draft && !m.has_conflicts && m.pipeline !== 'failed') {
      out.push({
        key: `quick:undraft:${m.ref}`,
        issue,
        issueTitle: m.title,
        summary: t('main.quick.undraft', { ref: m.ref }),
        op: { op: 'setDraft', project: projectOf(m), iid: m.iid, draft: false, ...(kind === 'gitlab' ? { title: undrafted(m.title) } : {}) },
        notify: { title: t('main.quick.stillDraft', { ref: m.ref }), body },
      });
    }
    if (!m.draft && m.pipeline === 'manual') {
      for (const j of manualJobs(jobsOf(m))) {
        out.push({
          key: `quick:play:${j.id}`,
          issue,
          issueTitle: m.title,
          summary: t('main.quick.runJob', { job: j.name, ref: m.ref }),
          op: { op: 'playJob', project: projectOf(m), jobId: j.id },
          notify: { title: t('main.quick.jobStuck', { job: j.name, ref: m.ref }), body },
        });
      }
    }
  }
  return out;
}

export async function scan(): Promise<AutoProposal[]> {
  const prov = vcsProvider();
  const items = (await readMrs()).filter((m) => m.state === 'opened' && m.roles.includes('author'));
  const jobs = new Map<string, VcsCiJob[]>();
  if (prov.caps.manualJobs) {
    for (const m of items.filter((x) => !x.draft && x.pipeline === 'manual')) {
      const pid = /\/pipelines\/(\d+)/.exec(m.pipeline_url ?? '')?.[1];
      if (pid) jobs.set(m.ref, await prov.listCiJobs(projectOf(m), Number(pid)));
    }
  }
  return autoProposals(items, (m) => jobs.get(m.ref) ?? [], prov.kind);
}

const NOTIFY_EACH_UP_TO = 3;

async function autoRun(notify: (n: Notice) => void): Promise<void> {
  // A skipped or failed proposal is not re-created on the next run: it stays a decision the user already made.
  const known = new Set(listActions().map((a) => a.key));
  const fresh = (await scan()).filter((p) => !known.has(p.key));
  // Many at once (typically right after a push) get one notice instead of a burst.
  const each = fresh.length <= NOTIFY_EACH_UP_TO;
  const prov = vcsProvider();
  for (const p of fresh) {
    proposeVcsCommands({ key: p.key, issue: p.issue, issueTitle: p.issueTitle, summary: p.summary, notify: each ? p.notify : undefined }, await prov.planWrite(p.op));
  }
  if (!each && getSettings().notifications) {
    notify({ title: t('main.quick.many', { count: fresh.length, vcs: vcsName() }), body: t('main.quick.manyBody'), onClick: { type: 'navigate', to: 'actions' } });
  }
}

export const register: Module = (ctx) => {
  ctx.handle('gitlabQuick:context', (card: Card) => context(card));
  ctx.handle('gitlabQuick:members', (projectPath: string) => members(projectPath));
  ctx.handle('gitlabQuick:propose', (req: QuickRequest) => proposeManual(req));
  ctx.job({ name: 'gitlab-quick', everyMin: JOB_EVERY_MIN, workHoursOnly: true, enabled: vcsReady, run: () => autoRun(ctx.notify) });
};
