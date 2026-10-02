import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Card } from '../shared/types';
import type { QuickContext, QuickIssue, QuickJob, QuickMember, QuickMr, QuickPerson, QuickRequest, QuickResult, QuickTransition } from '../shared/gitlabQuick';
import { listActions, proposeGitlabAction } from './actions';
import { getSettings } from './config';
import { isIssueRef, issueProjectRef, rc, vcsCliEnv } from './workspaceConfig';
import type { Module } from './module';
import { readReport } from './report';
import type { Notice } from './scheduler';

const exec = promisify(execFile);
const JOB_EVERY_MIN = 30;
const DRAFT_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:|\[wip\]|wip:)\s*/i;
// Build, release prep and deploy belong to the QA flow (qa-release-branch skill): the app never plays them.
const QA_OWNED = /^(deploy|build|pre_build|set_version)/i;
// The AI review job is left to the reviewers' flow: proposing it on every MR was noise.
const SKIPPED_JOBS = /ai_code_review/i;

// agent-pipeline §8 (what the dev moves) with the closed label sets of qa-release-branch §5. Review and QA exits
// (In code review, Approved/Rejected, In testing, Failed testing, Approved in testing, Done...) are never offered.
const RULES = [
  {
    to: 'In development',
    id: 75,
    label: 'STAGE:: Doing',
    from: ['Open', 'Ready for planning', 'Blocked in development', 'Rejected in code review', 'Failed testing'],
    removable: ['STAGE:: Backlog', 'STAGE:: To Do', 'STAGE:: Code Review Fail', 'STAGE:: Test Fail'],
  },
  { to: 'Ready for code review', id: 77, label: 'STAGE:: Code Review', from: ['In development'], removable: ['STAGE:: Doing'] },
  {
    to: 'Ready for testing',
    id: 6,
    label: 'STAGE:: Ready To Test',
    from: ['Approved in code review', 'Failed testing', 'In development'],
    removable: ['STAGE:: Code Review OK', 'STAGE:: Code Review', 'STAGE:: Test Fail', 'STAGE:: Doing'],
  },
];

interface ReportMr {
  kind: string;
  ref: string;
  project: string;
  project_id: number;
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

interface ApiMr {
  title: string;
  draft: boolean;
  state: string;
  has_conflicts: boolean;
  web_url: string;
  project_id: number;
  reviewers: QuickPerson[];
  author: { username: string };
  head_pipeline: { id: number; status: string } | null;
}

interface ApiJob {
  id: number;
  name: string;
  stage: string;
  status: string;
  pipeline: { id: number };
}

async function glab(args: string[]): Promise<string> {
  const { stdout } = await exec('glab', args, { env: vcsCliEnv(), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function get<T>(endpoint: string): Promise<T> {
  return JSON.parse(await glab(['api', endpoint])) as T;
}

// GraphQL reads only: the work item status is not in the REST API.
async function readQuery<T>(query: string): Promise<T> {
  if (!/^\s*query\b/.test(query)) throw new Error('só leitura');
  return JSON.parse(await glab(['api', 'graphql', '-f', `query=${query}`])) as T;
}

let meCache: string | null = null;
async function me(): Promise<string> {
  meCache ??= (await get<{ username: string }>('user')).username;
  return meCache;
}

const enc = (path: string) => encodeURIComponent(path);

function checkPath(path: string): string {
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path)) throw new Error(`projeto inválido: ${path}`);
  return enc(path);
}

const day = () => new Date().toLocaleDateString('sv-SE');

function manualJobs(jobs: ApiJob[]): QuickJob[] {
  return jobs.filter((j) => j.status === 'manual' && !QA_OWNED.test(j.stage) && !QA_OWNED.test(j.name) && !SKIPPED_JOBS.test(j.name)).map((j) => ({ id: j.id, name: j.name, stage: j.stage }));
}

function undrafted(title: string): string {
  return title.replace(DRAFT_PREFIX, '');
}

async function mrInfo(projectPath: string, iid: number, user: string): Promise<QuickMr> {
  const p = checkPath(projectPath);
  const m = await get<ApiMr>(`projects/${p}/merge_requests/${iid}`);
  const jobs = m.head_pipeline ? await get<ApiJob[]>(`projects/${p}/pipelines/${m.head_pipeline.id}/jobs?per_page=100`) : [];
  return {
    ref: `${projectPath.split('/').pop()}!${iid}`,
    projectPath,
    iid,
    title: m.title,
    webUrl: m.web_url,
    draft: m.draft,
    hasConflicts: m.has_conflicts,
    pipeline: m.head_pipeline?.status ?? null,
    reviewers: m.reviewers.map((r) => ({ id: r.id, username: r.username, name: r.name })),
    author: m.author.username,
    mine: m.author.username === user,
    manualJobs: m.state === 'opened' ? manualJobs(jobs) : [],
  };
}

function transitionsFor(status: string | null, labels: string[]): QuickTransition[] {
  const stage = labels.filter((l) => /^STAGE\s*::/.test(l));
  return RULES.map((r) => {
    const base = { to: r.to, addLabel: stage.includes(r.label) ? null : r.label, removeLabels: stage.filter((l) => r.removable.includes(l)) };
    if (status === r.to) return { ...base, allowed: false, reason: 'Já está neste status.' };
    if (!status || !r.from.includes(status)) return { ...base, allowed: false, reason: `Não sai de “${status ?? 'sem status'}” por aqui.` };
    const foreign = stage.filter((l) => l !== r.label && !r.removable.includes(l));
    if (foreign.length) return { ...base, allowed: false, reason: `A issue tem ${foreign.join(', ')}, fora do conjunto que o app troca. Ajuste no GitLab.` };
    return { ...base, allowed: true, reason: null };
  });
}

async function readIssue(iid: number): Promise<QuickIssue & { gid: string | null }> {
  const issue = await get<{ labels: string[] }>(`projects/${issueProjectRef()}/issues/${iid}`);
  const q = await readQuery<{ data: { project: { workItems: { nodes: { id: string; widgets: { type: string; status?: { name: string } }[] }[] } } } }>(
    `query { project(fullPath: "${rc().issues.project}") { workItems(iid: "${iid}") { nodes { id widgets { type ... on WorkItemWidgetStatus { status { name } } } } } } }`,
  );
  const node = q.data.project.workItems.nodes[0];
  const status = node?.widgets.find((w) => w.type === 'STATUS')?.status?.name ?? null;
  const stageLabels = issue.labels.filter((l) => /^STAGE\s*::/.test(l));
  return { iid, status, stageLabels, transitions: transitionsFor(status, issue.labels), gid: node?.id ?? null };
}

async function context(card: Card): Promise<QuickContext> {
  const user = await me();
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
      const { gid: _gid, ...rest } = await readIssue(Number(card.iid));
      issue = rest;
    } catch (e) {
      warnings.push(`issue ${card.ref}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return { me: user, issue, mrs, warnings };
}

async function members(projectPath: string): Promise<QuickMember[]> {
  const p = checkPath(projectPath);
  const user = await me();
  const [all, recent] = await Promise.all([
    get<(QuickPerson & { access_level: number; state: string })[]>(`projects/${p}/members/all?per_page=100`),
    get<{ reviewers: QuickPerson[] }[]>(`projects/${p}/merge_requests?author_username=${user}&state=all&per_page=50&order_by=updated_at`).catch(() => []),
  ]);
  const count = new Map<number, number>();
  for (const mr of recent) for (const r of mr.reviewers) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  return all
    .filter((m) => m.access_level >= 30 && m.state === 'active' && m.username !== user && !/^k8s|_bot_|bot$/i.test(m.username))
    .map((m) => ({ id: m.id, username: m.username, name: m.name, usual: count.get(m.id) ?? 0 }))
    .sort((a, b) => b.usual - a.usual || a.name.localeCompare(b.name))
    .slice(0, 60);
}

function propose(input: Parameters<typeof proposeGitlabAction>[0], out: QuickResult): void {
  if (proposeGitlabAction(input)) out.created.push(input.summary);
  else out.duplicated += 1;
}

const issueOf = (refs: string[]): number => Number(refs.map((r) => /(\d+)$/.exec(r)?.[1]).find(Boolean) ?? 0);

async function proposeManual(req: QuickRequest): Promise<QuickResult> {
  const out: QuickResult = { created: [], duplicated: 0 };
  if (req.kind === 'transition') {
    const rule = RULES.find((r) => r.to === req.to);
    if (!rule) throw new Error(`transição não permitida: ${req.to}`);
    const issue = await readIssue(req.issue);
    const t = issue.transitions.find((x) => x.to === req.to);
    if (!t?.allowed) throw new Error(t?.reason ?? 'transição não permitida');
    const title = (await get<{ title: string }>(`projects/${issueProjectRef()}/issues/${req.issue}`)).title;
    if (issue.gid) {
      propose(
        {
          key: `quick:status:${req.issue}:${t.to}:${day()}`,
          issue: req.issue,
          issueTitle: title,
          stage: issue.stageLabels.join(', '),
          summary: `Status da #${req.issue}: ${issue.status} → ${t.to}`,
          detail: 'Muda o status do work item (skill issue-status). A label vai numa proposta separada.',
          command: {
            via: 'glab',
            method: 'POST',
            endpoint: 'graphql',
            fields: { query: `mutation { workItemUpdate(input: { id: "${issue.gid}", statusWidget: { status: "gid://gitlab/WorkItems::Statuses::Custom::Status/${rule.id}" } }) { errors } }` },
          },
        },
        out,
      );
    }
    const fields: Record<string, string> = {};
    if (t.addLabel) fields.add_labels = t.addLabel;
    if (t.removeLabels.length) fields.remove_labels = t.removeLabels.join(',');
    if (Object.keys(fields).length) {
      propose(
        {
          key: `quick:label:${req.issue}:${t.to}:${day()}`,
          issue: req.issue,
          issueTitle: title,
          stage: issue.stageLabels.join(', '),
          summary: `Label da #${req.issue}: ${t.removeLabels.length ? `${t.removeLabels.join(', ')} → ` : ''}${t.addLabel ?? ''} (${issue.status} → ${t.to})`,
          command: { via: 'glab', method: 'PUT', endpoint: `projects/${issueProjectRef()}/issues/${req.issue}`, fields },
        },
        out,
      );
    }
    if (!issue.gid && !Object.keys(fields).length) throw new Error('Nada a mudar: a label já está certa e o status não pôde ser lido.');
    return out;
  }

  const p = checkPath(req.projectPath);
  if (req.kind === 'play') {
    const job = await get<ApiJob>(`projects/${p}/jobs/${req.jobId}`);
    if (!manualJobs([job]).length) throw new Error(`o job ${job.name} não pode ser tocado por aqui`);
    propose(
      {
        key: `quick:play:${job.id}`,
        issue: 0,
        issueTitle: `${req.projectPath} · pipeline ${job.pipeline.id}`,
        summary: `Rodar o job ${job.name} (${req.projectPath}, pipeline ${job.pipeline.id})`,
        command: { via: 'glab', method: 'POST', endpoint: `projects/${p}/jobs/${job.id}/play`, fields: {} },
      },
      out,
    );
    return out;
  }
  const ref = `${req.projectPath.split('/').pop()}!${req.mrIid}`;
  const mr = await get<ApiMr>(`projects/${p}/merge_requests/${req.mrIid}`);
  if (mr.state !== 'opened') throw new Error(`${ref} não está aberto`);
  if (mr.author.username !== (await me())) throw new Error(`${ref} é de ${mr.author.username}: só leitura`);
  const issue = req.issue ?? 0;
  if (req.kind === 'undraft') {
    if (!mr.draft) throw new Error(`${ref} não está em draft`);
    const title = undrafted(mr.title);
    if (title === mr.title) throw new Error('o título não tem prefixo de draft; tire o draft no GitLab');
    propose(
      {
        key: `quick:undraft:${ref}`,
        issue,
        issueTitle: mr.title,
        summary: `Tirar o Draft de ${ref}`,
        command: { via: 'glab', method: 'PUT', endpoint: `projects/${p}/merge_requests/${req.mrIid}`, fields: { title } },
      },
      out,
    );
    return out;
  }
  const person = await get<QuickPerson & { access_level: number }>(`projects/${p}/members/all/${req.userId}`);
  if (person.access_level < 30) throw new Error(`${person.username} não tem acesso de revisão no projeto`);
  const had = mr.reviewers.map((r) => `@${r.username}`);
  propose(
    {
      key: `quick:reviewer:${ref}:${person.id}:${day()}`,
      issue,
      issueTitle: mr.title,
      summary: `Reviewer de ${ref}: @${person.username}${mr.draft ? ' (o MR está em draft)' : ''}`,
      detail: had.length ? `Substitui os reviewers atuais: ${had.join(', ')}.` : undefined,
      command: { via: 'curl', method: 'PUT', endpoint: `projects/${p}/merge_requests/${req.mrIid}`, fields: { 'reviewer_ids[]': String(person.id) } },
    },
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
  command: Parameters<typeof proposeGitlabAction>[0]['command'];
  notify: { title: string; body: string };
}

// Pure on purpose: the integration script feeds it the real report plus the job lists.
export function autoProposals(items: ReportMr[], jobsOf: (m: ReportMr) => ApiJob[]): AutoProposal[] {
  const out: AutoProposal[] = [];
  for (const m of items) {
    if (m.state !== 'opened' || !m.roles.includes('author')) continue;
    const issue = issueOf(m.issue_refs ?? []);
    const body = 'Proposta criada. Confirme em Ações.';
    if (m.draft && !m.has_conflicts && m.pipeline !== 'failed') {
      out.push({
        key: `quick:undraft:${m.ref}`,
        issue,
        issueTitle: m.title,
        summary: `Tirar o Draft de ${m.ref}`,
        command: { via: 'glab', method: 'PUT', endpoint: `projects/${m.project_id}/merge_requests/${m.iid}`, fields: { title: undrafted(m.title) } },
        notify: { title: `${m.ref} segue em Draft`, body },
      });
    }
    if (!m.draft && m.pipeline === 'manual') {
      for (const j of manualJobs(jobsOf(m))) {
        out.push({
          key: `quick:play:${j.id}`,
          issue,
          issueTitle: m.title,
          summary: `Rodar o job ${j.name} em ${m.ref}`,
          command: { via: 'glab', method: 'POST', endpoint: `projects/${m.project_id}/jobs/${j.id}/play`, fields: {} },
          notify: { title: `Job ${j.name} parado em ${m.ref}`, body },
        });
      }
    }
  }
  return out;
}

export async function scan(): Promise<AutoProposal[]> {
  const items = (await readMrs()).filter((m) => m.state === 'opened' && m.roles.includes('author'));
  const jobs = new Map<string, ApiJob[]>();
  for (const m of items.filter((x) => !x.draft && x.pipeline === 'manual')) {
    const pid = /\/pipelines\/(\d+)/.exec(m.pipeline_url ?? '')?.[1];
    if (pid) jobs.set(m.ref, await get<ApiJob[]>(`projects/${m.project_id}/pipelines/${pid}/jobs?per_page=100`));
  }
  return autoProposals(items, (m) => jobs.get(m.ref) ?? []);
}

const NOTIFY_EACH_UP_TO = 3;

async function autoRun(notify: (n: Notice) => void): Promise<void> {
  // A skipped or failed proposal is not re-created on the next run: it stays a decision the user already made.
  const known = new Set(listActions().map((a) => a.key));
  const fresh = (await scan()).filter((p) => !known.has(p.key));
  // Many at once (typically right after a push) get one notice instead of a burst.
  const each = fresh.length <= NOTIFY_EACH_UP_TO;
  for (const p of fresh) proposeGitlabAction({ key: p.key, issue: p.issue, issueTitle: p.issueTitle, summary: p.summary, command: p.command, notify: each ? p.notify : undefined });
  if (!each && getSettings().notifications) {
    notify({ title: `${fresh.length} propostas novas no GitLab`, body: 'Draft e jobs manuais aguardando o seu “seguir”.', onClick: { type: 'navigate', to: 'actions' } });
  }
}

export const register: Module = (ctx) => {
  ctx.handle('gitlabQuick:context', (card: Card) => context(card));
  ctx.handle('gitlabQuick:members', (projectPath: string) => members(projectPath));
  ctx.handle('gitlabQuick:propose', (req: QuickRequest) => proposeManual(req));
  ctx.job({ name: 'gitlab-quick', everyMin: JOB_EVERY_MIN, workHoursOnly: true, run: () => autoRun(ctx.notify) });
};
