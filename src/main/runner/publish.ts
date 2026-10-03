import { createHash } from 'node:crypto';
import type { AgentDef, CommentTemplate, WorkspaceConfig } from '../../shared/config/types';
import { cycleText } from '../../shared/cycles/text';
import { type ForumMessage, type PublishedRef, runThreadId } from '../../shared/forum';
import { createTranslator } from '../../shared/i18n';
import {
  type CommentProblem,
  type CommentTarget,
  type FlowStage,
  type OutputKind,
  type Run,
  type StageComment,
  type StageOutput,
  checkComment,
  checkText,
  findMarked,
  flowOfRun,
  markerOf,
  pushStageOf,
  readMarker,
  recordCommentDraft,
  recordCommentProposal,
  recordCommentPublished,
  recordCommentRefused,
  renderComment,
} from '../../shared/runs';
import type { ReleaseAction, VcsCommand } from '../../shared/types';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import type { RunStore } from '../runs-core';
import { moveRun } from '../runs-forum';
import type { VcsComment, VcsProvider, VcsThread, VcsWriteOp } from '../vcs/types';
import { type Placed, commentText, generalFindings, placeFindings, reviewComments, sameFinding, withTail } from './review';

// What the runner leaves on the code host: the comment of each stage on the issue, the decision of each gate, the questions of the agents, the review of
// the pull request on its lines, and the proposals of the push and the pull request. It decides what goes out by itself (the agent is autonomous and the
// text passed its check), what waits for a "yes" (anything else) and what is refused (a test workspace); it never touches the host. Every write goes
// through the `Door`, which is the one place that imports Actions: this file and the rest of the runner do not.

/** One write that goes out without a "yes": who it is for the audit log, and the hash of the body. */
export interface PostMeta {
  issue: number;
  key: string;
  summary: string;
  by: string;
  bodyHash?: string;
}

/** A proposal that waits in Actions. `commands` run in order under one "sim". */
export interface ProposalMeta {
  key: string;
  issue: number;
  issueTitle: string;
  summary: string;
  detail?: string;
  /** What the publisher needs to recognise the proposal when it is carried out. */
  unit: Record<string, unknown>;
  notify?: { title: string; body: string };
}

export interface PushMeta {
  key: string;
  issue: number;
  issueTitle: string;
  summary: string;
  runId: string;
  branch: string;
  notify?: { title: string; body: string };
}

/** The only way out of the runner (door.ts). */
export interface Door {
  /** The provider of the integration that holds the issues, or null when the workspace has none. */
  provider(): VcsProvider | null;
  /** Why external writes are refused right now (a test workspace), or null. */
  refusal(): string | null;
  /** Runs the commands in order, each audited; returns what the host answered to each. Throws at the first that fails. */
  post(meta: PostMeta, commands: VcsCommand[]): Promise<unknown[]>;
  /** Puts the commands in Actions as one proposal; false when the same proposal is already there. */
  propose(meta: ProposalMeta, commands: VcsCommand[]): boolean;
  proposePush(meta: PushMeta): boolean;
}

export interface PublisherEnv {
  /** The project that holds the issues ("group/name"). */
  issueProject: string;
  /** The repository (and its project on the host) each run works in. */
  repos: { id: string; projectPath: string | null }[];
}

export interface PublisherDeps {
  runs: RunStore;
  forum: ForumStore;
  config(): WorkspaceConfig;
  env(): PublisherEnv;
  door: Door;
  now?(): Date;
}

export interface StageEnd {
  stage: FlowStage;
  agent: AgentDef;
  kind: OutputKind;
  output: StageOutput;
  /** The review round this pass is, for a review (the run may have gone on to another by the time it is published). */
  round?: number;
  /** Whether the agent was autonomous in this stage (what its stage record said when it ended), so a later change of the switch does not reach back. */
  autonomous: boolean;
}

export type GateAction = 'approve' | 'reject' | 'skip';

export interface Publisher {
  /** A work stage ended an attempt (done, findings or QA result). Its comment goes out, or waits, or is refused; a review goes to the pull request. */
  stageEnded(runId: string, end: StageEnd): Promise<void>;
  /** An agent asked the person something. */
  asked(runId: string, e: { stage: FlowStage; agent: AgentDef; question: string; autonomous: boolean }): Promise<void>;
  /** The person decided a gate. */
  gateDecided(runId: string, e: { stage: FlowStage; action: GateAction; reason: string; autonomous: boolean }): Promise<void>;
  /** A proposal this publisher made was carried out (or the push of a run was). */
  actionDone(action: ReleaseAction, responses: unknown[]): Promise<void>;
  /** The review of a round that waited for the pull request goes out now, if the pull request exists. */
  flushReviews(runId: string): Promise<void>;
}

const iso = (d: Date): string => d.toISOString();
/** The comment template of a stage: the one its `comment` names, none when it names none. */
const templateOf = (config: WorkspaceConfig, stage: { comment: string | null } | undefined): CommentTemplate | undefined => (stage?.comment ? config.devCycle.comments[stage.comment] : undefined);
const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex');
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const normalize = (text: string): string => text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
const message = (e: unknown): string => redact(e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The id of what the host just made, and where to read it. */
function refOf(response: unknown): { id: string | number | null; url: string | null } {
  const r = rec(response);
  const id = r.id ?? r.iid ?? r.number ?? null;
  const links = rec(rec(r.links).html);
  const url = [r.html_url, r.web_url, links.href].find((u): u is string => typeof u === 'string' && !!u) ?? null;
  return { id: typeof id === 'string' || typeof id === 'number' ? id : null, url };
}

/** The pull request a host just made: its number and address. */
function prRefOf(response: unknown): { iid: number | null; url: string | null } {
  const r = rec(response);
  const n = r.number ?? r.iid ?? r.id;
  const { url } = refOf(response);
  return { iid: typeof n === 'number' ? n : typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : null, url };
}

interface Delivery {
  key: string;
  /** The stage of the run the thread's message about it belongs to, and which kinds of message it is. */
  stage: string;
  kinds: ForumMessage['kind'][];
  target: CommentTarget;
  /** The rendered, checked comment. */
  body: string;
  headline: string;
  title: string;
  problems: { code: CommentProblem; sample: string }[];
  by: string;
  autonomous: boolean;
  /** The first line of the previous version is compared with this one to tell whether the edit changes what the comment says. */
  announce: boolean;
}

export function createPublisher(deps: PublisherDeps): Publisher {
  const now = (): string => iso(deps.now?.() ?? new Date());
  const door = deps.door;
  const d = { runs: deps.runs, forum: deps.forum };
  const lang = () => deps.config().language;
  const tr = (key: string, params?: Record<string, string | number>): string => createTranslator(lang())(key, params);
  const need = (id: string): Run => {
    const run = deps.runs.get(id);
    if (!run) throw new Error(`no run ${id}`);
    return run;
  };

  const say = (run: Run, code: string, params: Record<string, string | number> = {}, stage: string | null = null): void => {
    try {
      deps.forum.append(runThreadId(run.id), { kind: 'system', author: { type: 'app' }, code, params, stage: stage ?? run.stage });
    } catch (e) {
      console.error('[runner] could not record a publication', message(e));
    }
  };

  const projects = (run: Run): { issue: string; repo: string } => {
    const env = deps.env();
    return { issue: env.issueProject, repo: env.repos.find((r) => r.id === run.repo)?.projectPath || env.issueProject };
  };

  const checkOptions = (run: Run, config: WorkspaceConfig) => ({ worktree: run.worktree, agentIds: config.agents.team.map((a) => a.id), redact: (text: string) => redact(text) });
  const titleOf = (tpl: CommentTemplate): string => cycleText(tpl.title, lang());
  const stageAutonomy = (run: Run, stage: string): boolean => run.stages.find((s) => s.stage === stage)?.autonomous ?? false;
  const problemsText = (problems: { code: string; sample: string }[]): string => problems.map((p) => (p.sample ? `${p.code} (${p.sample})` : p.code)).join(', ');

  // ---- the forum links to what was posted ------------------------------------------------------------------------------------------

  function markPublished(run: Run, stage: string, kinds: ForumMessage['kind'][], ref: PublishedRef): void {
    try {
      const thread = runThreadId(run.id);
      const found = [...(deps.forum.read(thread, 0, 2000)?.messages ?? [])].reverse().find((m) => m.public && !m.published && m.stage === stage && kinds.includes(m.kind));
      if (found) deps.forum.markPublished(thread, found.seq, ref);
    } catch (e) {
      console.error('[runner] could not link a message to its comment', message(e));
    }
  }

  // ---- finding what is on the host --------------------------------------------------------------------------------------------------

  async function commentsOf(provider: VcsProvider, run: Run, target: CommentTarget, pr: { project: string; iid: number } | null): Promise<VcsComment[]> {
    const { issue } = projects(run);
    const list = target === 'issue' ? await provider.listIssueComments(issue, run.issue.iid) : pr ? await provider.listMrComments(pr.project, pr.iid) : [];
    return list.filter((c) => !c.system);
  }

  /** The pull request of the run: the one the run recorded, else an open one from its branch (the person may have opened it by hand). */
  async function prOf(run: Run, provider: VcsProvider): Promise<{ project: string; iid: number; url: string | null } | null> {
    const known = run.comments.pr;
    const { issue, repo } = projects(run);
    if (known && known.status === 'published' && known.noteId !== null && /^\d+$/.test(String(known.noteId))) return { project: repo, iid: Number(known.noteId), url: known.url };
    try {
      const found = (await provider.linkedMrs(issue, run.issue.iid)).find((m) => m.sourceBranch === run.branch && m.state === 'open');
      if (!found) return null;
      moveRun(d, run.id, (r) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: found.iid, url: found.webUrl, bodyHash: known?.bodyHash ?? '' }, now()));
      return { project: found.project || repo, iid: found.iid, url: found.webUrl };
    } catch (e) {
      console.error('[runner] could not look for the pull request', message(e));
      return null;
    }
  }

  // ---- one comment: written, checked, then posted, proposed or refused -------------------------------------------------------------

  async function deliver(runId: string, x: Delivery): Promise<void> {
    let run = need(runId);
    const hash = hashOf(x.body);
    const had = run.comments[x.key];
    if (had && (had.status === 'published' || had.status === 'proposed') && had.bodyHash === hash) return;
    const details = { body: x.body, headline: x.headline, title: x.title };
    run = moveRun(d, runId, (r) => recordCommentDraft(r, x.key, { target: x.target, bodyHash: hash, ...details }, now()));

    const refusal = door.refusal();
    if (refusal) {
      moveRun(d, runId, (r) => recordCommentRefused(r, x.key, x.target, now()));
      say(run, 'runner.comment.refused', { title: x.title });
      return;
    }
    const provider = door.provider();
    if (!provider) {
      say(run, 'runner.comment.noHost', { title: x.title });
      return;
    }
    const where = x.target === 'issue' ? { project: projects(run).issue, iid: run.issue.iid } : await prOf(run, provider);
    if (!where) {
      say(run, 'runner.review.waiting', { round: x.key.replace(/^\D+/, '') || '1' });
      return;
    }

    // The stage's comment is one comment, edited in place: the note the run remembers, else the one that carries its marker, else a new one.
    let noteId: string | number | null = had?.noteId ?? null;
    if (noteId === null) {
      const marked = findMarked(await commentsOf(provider, run, x.target, x.target === 'mr' ? (where as { project: string; iid: number }) : null), run.id, x.key);
      if (marked) noteId = marked.id;
    }
    const op: VcsWriteOp =
      noteId === null
        ? { op: x.target === 'issue' ? 'commentIssue' : 'commentMr', project: where.project, iid: where.iid, body: x.body }
        : { op: x.target === 'issue' ? 'editIssueNote' : 'editMrNote', project: where.project, iid: where.iid, noteId, body: x.body };
    const commands = await provider.planWrite(op);

    const meta = { issue: run.issue.iid, summary: x.title, by: x.by, bodyHash: hash };
    const unit = { runId, purpose: 'comment', key: x.key, stage: x.stage, kinds: x.kinds, target: x.target, bodyHash: hash, project: where.project, iid: where.iid, edit: noteId !== null };

    if (!x.autonomous || x.problems.length) {
      const created = door.propose({ key: `comment:${runId}:${x.key}:${hash.slice(0, 12)}`, issue: run.issue.iid, issueTitle: run.issue.title, summary: x.title, detail: [x.problems.length ? tr('main.runner.comment.heldDetail', { problems: problemsText(x.problems) }) : '', x.body].filter(Boolean).join('\n\n'), unit, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: x.title } }, commands);
      moveRun(d, runId, (r) => recordCommentProposal(r, x.key, { target: x.target, bodyHash: hash, ...details }, now()));
      if (created) say(run, x.problems.length ? 'runner.comment.held' : 'runner.comment.proposed', x.problems.length ? { title: x.title, problems: problemsText(x.problems) } : { title: x.title });
      return;
    }

    let responses: unknown[];
    try {
      responses = await door.post({ ...meta, key: `comment:${runId}:${x.key}` }, commands);
    } catch (e) {
      say(run, 'runner.comment.failed', { title: x.title, reason: message(e) });
      return;
    }
    await afterPosted(runId, { ...x, hash, details, noteId, responses, where, provider, previous: had?.headline ?? null });
  }

  interface Posted {
    key: string;
    stage: string;
    kinds: ForumMessage['kind'][];
    target: CommentTarget;
    title: string;
    body: string;
    headline: string;
    announce: boolean;
    hash: string;
    details: { body: string; headline: string; title: string };
    noteId: string | number | null;
    responses: unknown[];
    where: { project: string; iid: number };
    provider: VcsProvider;
    previous: string | null;
  }

  /** The host took the comment (by itself or after a "sim"): the run learns its id, the thread links to it, the comment is read back and, when what it says changed, a short one tells so. */
  async function afterPosted(runId: string, p: Posted): Promise<void> {
    const run0 = need(runId);
    const made = refOf(p.responses[0]);
    const id = p.noteId ?? made.id;
    if (id === null) {
      say(run0, 'runner.comment.failed', { title: p.title, reason: tr('main.runner.comment.noId') });
      return;
    }
    const url = made.url ?? p.provider.noteUrl(p.where.project, p.target, p.where.iid, id);
    // Published either way: an edit of a comment the run had lost the id of (it was found by its marker) is how the run gets the id back.
    const run = moveRun(d, runId, (r) => recordCommentPublished(r, p.key, { target: p.target, noteId: id, url, bodyHash: p.hash, ...p.details }, now()));
    say(run, p.noteId === null ? 'runner.comment.posted' : 'runner.comment.edited', { target: tr(`main.runner.target.${p.target}`), title: p.title, url: url ?? '' });
    markPublished(run, p.stage, p.kinds, { target: p.target, noteId: id, url });

    // The markup is the thing that breaks: tables and collapsed sections. The host's own copy is compared with what was sent.
    try {
      const back = (await commentsOf(p.provider, run, p.target, p.target === 'mr' ? p.where : null)).find((c) => String(c.id) === String(id));
      if (!back || normalize(back.body) !== normalize(p.body)) say(run, 'runner.comment.markup', { title: p.title });
    } catch (e) {
      say(run, 'runner.comment.unreadable', { title: p.title, reason: message(e) });
    }

    // An edit that changes what the comment says (not just how it says it) is worth a notification: a short comment of its own that links to it.
    if (p.announce && p.noteId !== null && p.previous && p.previous !== p.headline) {
      try {
        const body = `${tr(url ? 'main.runner.comment.notable' : 'main.runner.comment.notableNoLink', { status: p.headline, url: url ?? '' })}\n\n${markerOf(run.id, `${p.key}-notice`)}\n`;
        const cmds = await p.provider.planWrite({ op: p.target === 'issue' ? 'commentIssue' : 'commentMr', project: p.where.project, iid: p.where.iid, body });
        await door.post({ issue: run.issue.iid, key: `notice:${run.id}:${p.key}:${hashOf(p.headline).slice(0, 8)}`, summary: p.title, by: stageAgent(run, p.key), bodyHash: hashOf(body) }, cmds);
      } catch (e) {
        say(run, 'runner.comment.failed', { title: p.title, reason: message(e) });
      }
    }
  }

  const stageAgent = (run: Run, key: string): string => run.stages.find((s) => s.stage === key)?.agent ?? 'app';

  // ---- the comments of the stages ---------------------------------------------------------------------------------------------------

  const resultWord = (end: StageEnd): string | undefined => {
    if (end.kind === 'review') return tr(`main.runner.comment.result.${end.output.verdict === 'changes' ? 'changes' : 'approved'}`);
    if (end.kind === 'qa') {
      const s = end.output.scenarios;
      return tr(`main.runner.comment.result.${s.some((x) => x.result === 'fail') ? 'fail' : s.some((x) => x.result === 'not-run') ? 'partial' : 'pass'}`);
    }
    return undefined;
  };

  async function stageComment(runId: string, end: StageEnd): Promise<void> {
    const config = deps.config();
    const tpl = templateOf(config, end.stage);
    if (!tpl) return;
    const run = need(runId);
    const marker = markerOf(run.id, end.stage.id);
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: end.stage.label, round: end.round, result: resultWord(end) }, end.output.comment, { marker, fallback: end.output.summary });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: tpl.technicalDetail });
    await deliver(runId, { key: end.stage.id, stage: end.stage.id, kinds: ['post'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: end.agent.id, autonomous: end.autonomous, announce: true });
  }

  async function question(runId: string, e: { stage: FlowStage; agent: AgentDef; question: string; autonomous: boolean }): Promise<void> {
    const config = deps.config();
    const tpl = config.devCycle.comments.question;
    if (!tpl) return;
    const run = need(runId);
    // Each time an agent asks is its own comment: the thread of the issue reads as the conversation it was.
    const n = run.history.filter((h) => h.type === 'question' && h.stage === e.stage.id).length || 1;
    const key = `question-${e.stage.id}-${n}`.slice(0, 48);
    const marker = markerOf(run.id, key);
    const content: StageComment = { sections: [{ heading: '', body: e.question }], technical: '' };
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: e.stage.label }, content, { marker });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: tpl.technicalDetail });
    await deliver(runId, { key, stage: e.stage.id, kinds: ['question'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: e.agent.id, autonomous: e.autonomous, announce: false });
  }

  async function gate(runId: string, e: { stage: FlowStage; action: GateAction; reason: string; autonomous: boolean }): Promise<void> {
    const config = deps.config();
    const tpl = config.devCycle.comments.gate;
    if (!tpl) return;
    const run = need(runId);
    const producer = flowOfRun(run, config).find((s) => s.id === e.stage.returnsTo);
    const decided = run.history.filter((h) => (h.type === 'gate-approved' || h.type === 'gate-rejected' || h.type === 'gate-skipped') && h.stage === e.stage.id).length || 1;
    const key = `decision-${e.stage.id}-${decided}`.slice(0, 48);
    const marker = markerOf(run.id, key);
    const decision = tr(`main.runner.comment.decision.${e.action === 'approve' ? 'approved' : e.action === 'reject' ? 'rejected' : 'skipped'}`);
    const link = producer ? run.comments[producer.id]?.url : null;
    const content: StageComment | null = e.reason.trim() ? { sections: [{ heading: '', body: e.reason.trim() }], technical: '' } : null;
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: e.stage.label, decision }, content, { marker, tail: link ? tr('main.runner.comment.decisionLink', { url: link }) : undefined });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: tpl.technicalDetail });
    // The decision was the person's; whether it goes out by itself follows the agent whose work it judged.
    await deliver(runId, { key, stage: e.stage.id, kinds: ['decision'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: producer?.agent ?? 'app', autonomous: e.autonomous, announce: false });
  }

  // ---- the review on the pull request -----------------------------------------------------------------------------------------------

  function reviewMarkerOf(thread: VcsThread, runId: string): { round: number; index: number } | null {
    const body = thread.notes[0]?.body ?? '';
    const m = readMarker(body);
    return m && m.run === runId && m.key === 'review' && m.round !== null && m.finding !== null ? { round: m.round, index: m.finding } : null;
  }

  async function review(runId: string, end: StageEnd): Promise<void> {
    const config = deps.config();
    const tpl = templateOf(config, end.stage);
    if (!tpl) return;
    let run = need(runId);
    const record = run.reviews.find((r) => r.round === end.round);
    if (!record) return;
    const round = record.round;
    const key = `review-${round}`;
    const title = `${titleOf(tpl)} (${round})`;
    if (run.comments[key]?.status === 'published') return;
    const marker = markerOf(run.id, 'review', round);
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: end.stage.label, round, result: resultWord(end) }, end.output.comment, { marker, fallback: end.output.summary });
    const hash = hashOf(rendered.body);
    run = moveRun(d, runId, (r) => recordCommentDraft(r, key, { target: 'mr', bodyHash: hash, body: rendered.body, headline: rendered.status, title }, now()));
    await publishReview(runId, round, { autonomous: end.autonomous, by: end.agent.id });
  }

  /** The review of a round: the replies and resolutions on the threads of the rounds before, and one review with the new findings and the general comment. */
  async function publishReview(runId: string, round: number, who: { autonomous: boolean; by: string }): Promise<void> {
    const config = deps.config();
    let run = need(runId);
    const key = `review-${round}`;
    const draft = run.comments[key];
    const record = run.reviews.find((r) => r.round === round);
    if (!draft?.body || !record || draft.status === 'published') return;
    const tpl = templateOf(config, flowOfRun(run, config).find((s) => s.id === record.stage));
    const title = draft.title ?? `Review (${round})`;
    const refusal = door.refusal();
    if (refusal) {
      moveRun(d, runId, (r) => recordCommentRefused(r, key, 'mr', now()));
      say(run, 'runner.review.refused', { round }, 'review');
      return;
    }
    const provider = door.provider();
    if (!provider) {
      say(run, 'runner.comment.noHost', { title });
      return;
    }
    const pr = await prOf(run, provider);
    if (!pr) {
      say(run, 'runner.review.waiting', { round }, 'review');
      return;
    }
    run = need(runId);

    // The pull request as it is now: the files it changes and the commit it is at.
    const [changes, mr] = await Promise.all([provider.listMrChanges(pr.project, pr.iid), provider.getMr(pr.project, pr.iid)]);
    const placed = placeFindings(record.findings, changes);
    const kind = provider.kind;

    // The threads of the earlier rounds: a finding that is still there gets a reply in its own thread, one that was fixed a reply and its thread resolved.
    const threads = (await provider.listMrThreads(pr.project, pr.iid).catch(() => [] as VcsThread[])).filter((t) => !t.resolved);
    const used = new Set<number>();
    const ops: VcsWriteOp[] = [];
    for (const thread of threads) {
      const at = reviewMarkerOf(thread, run.id);
      if (!at || at.round >= round) continue;
      const original = run.reviews.find((r) => r.round === at.round)?.findings[at.index];
      const now_ = original ? record.findings.findIndex((f, i) => !used.has(i) && sameFinding(original, f)) : -1;
      if (now_ >= 0) {
        used.add(now_);
        ops.push({ op: 'replyThread', project: pr.project, iid: pr.iid, threadId: thread.id, body: tr('main.runner.review.stillOpen', { round }) });
      } else {
        ops.push({ op: 'replyThread', project: pr.project, iid: pr.iid, threadId: thread.id, body: tr('main.runner.review.fixed') });
        if (thread.resolvable && provider.caps.resolvableThreads) ops.push({ op: 'resolveThread', project: pr.project, iid: pr.iid, threadId: thread.id });
      }
    }

    // What is new opens threads; the rest of the findings were answered above and open nothing.
    const fresh: Placed[] = placed.filter((p) => !used.has(p.index));
    const problems: { code: string; sample: string }[] = [];
    const bodies = new Map<number, string>();
    for (const p of fresh) {
      const marker = markerOf(run.id, 'review', round, p.index);
      const checked = checkText(`${commentText(kind, p, lang())}\n\n${marker}`, { ...checkOptions(run, config), marker });
      problems.push(...checked.problems);
      bodies.set(p.index, checked.body);
    }
    const general = checkComment(withTail(draft.body, generalFindings(fresh, lang())), { ...checkOptions(run, config), status: draft.headline ?? '', marker: markerOf(run.id, 'review', round), technicalDetail: tpl?.technicalDetail ?? true });
    problems.push(...general.problems);

    // Whatever still blocks asks for changes again, answered thread or not; nothing the app writes ever approves. On a pull request of the person's own
    // the hosts do not take a request for changes (the one who opened it cannot ask itself), so the review is a comment and the status line says the rest.
    const me = await provider.currentUser().catch(() => null);
    const own = !!me && !!mr.author && me.username.toLowerCase() === mr.author.toLowerCase();
    const blocking = record.findings.some((f) => f.severity === 'blocking') && !own;
    const commitSha = /^[0-9a-f]{7,64}$/i.test(mr.sha) ? mr.sha : record.head ?? '';
    ops.push({ op: 'submitReview', project: pr.project, iid: pr.iid, event: blocking ? 'request_changes' : 'comment', body: general.body, comments: reviewComments(fresh, bodies), commitSha });
    const commands = (await Promise.all(ops.map((o) => provider.planWrite(o)))).flat();

    const bodyHash = hashOf(general.body);
    const unit = { runId, purpose: 'review', key, round, project: pr.project, iid: pr.iid, bodyHash };
    if (!who.autonomous || problems.length) {
      const created = door.propose({ key: `review:${runId}:${round}:${bodyHash.slice(0, 12)}`, issue: run.issue.iid, issueTitle: run.issue.title, summary: title, detail: [problems.length ? tr('main.runner.comment.heldDetail', { problems: problemsText(problems) }) : '', general.body, ...reviewComments(fresh, bodies).map((c) => `${c.path}${c.line !== null ? `:${c.line}` : ''}\n${c.body}`)].filter(Boolean).join('\n\n'), unit, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: title } }, commands);
      moveRun(d, runId, (r) => recordCommentProposal(r, key, { target: 'mr', bodyHash, body: general.body }, now()));
      if (created) say(run, problems.length ? 'runner.review.held' : 'runner.review.proposed', problems.length ? { round, problems: problemsText(problems) } : { round }, 'review');
      return;
    }
    let responses: unknown[];
    try {
      responses = await door.post({ issue: run.issue.iid, key: `review:${runId}:${round}`, summary: title, by: who.by, bodyHash }, commands);
    } catch (e) {
      say(run, 'runner.review.failed', { round, reason: message(e) }, 'review');
      return;
    }
    recordReviewPosted(runId, key, { round, commands, responses, provider, pr, bodyHash, body: general.body });
  }

  /** The review went out: the run records the comment that carries the round's general text (found by its marker among what was written), and the thread links to it. */
  function recordReviewPosted(runId: string, key: string, p: { round: number; commands: VcsCommand[]; responses: unknown[]; provider: VcsProvider; pr: { project: string; iid: number }; bodyHash: string; body: string }): void {
    const marker = markerOf(runId, 'review', p.round);
    const at = p.commands.findIndex((c) => `${c.json ?? ''}${Object.values(c.fields).join('')}`.includes(marker));
    const made = refOf(p.responses[at >= 0 ? at : 0]);
    const url = made.url ?? (made.id !== null ? p.provider.noteUrl(p.pr.project, 'mr', p.pr.iid, made.id) : null);
    const run = moveRun(d, runId, (r) => recordCommentPublished(r, key, { target: 'mr', noteId: made.id ?? p.pr.iid, url, bodyHash: p.bodyHash, body: p.body }, now()));
    say(run, 'runner.review.posted', { round: p.round, url: url ?? '' }, 'review');
    markPublished(run, 'review', ['post'], { target: 'mr', noteId: made.id ?? p.pr.iid, url });
  }

  // ---- the push and the pull request ------------------------------------------------------------------------------------------------

  /** The line that makes the host close the issue when the pull request is merged: the keyword is the host's, in English whatever the workspace's language. */
  const closesOf = (run: Run): string => {
    const { issue, repo } = projects(run);
    return `Closes ${issue === repo ? '' : issue}#${run.issue.iid}`;
  };

  /** At the end of the stage that ends with the push: the pull request's description is written, and the push waits in Actions. */
  async function pushStage(runId: string, end: StageEnd): Promise<void> {
    const config = deps.config();
    const run = need(runId);
    const pr = config.devCycle.comments.pr;
    if (pr) {
      const marker = markerOf(run.id, 'pr');
      const closes = closesOf(run);
      const rendered = renderComment(pr, { language: lang(), ref: run.issue.ref, stage: end.stage.label }, end.output.pr, { marker, fallback: end.output.summary, tail: closes });
      const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: pr.technicalDetail });
      const title = (end.output.pr?.title || run.issue.title).trim().slice(0, 120);
      moveRun(d, runId, (r) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: hashOf(checked.body), body: checked.body, headline: rendered.status, title }, now()));
    }
    // Each time the stage ends is a new state of the branch: a push of an earlier one that still waits is replaced.
    const attempt = run.stages.find((s) => s.stage === end.stage.id)?.attempts ?? 1;
    const created = door.proposePush({ key: `push:${run.id}:${attempt}`, issue: run.issue.iid, issueTitle: run.issue.title, summary: tr('main.runner.push.summary', { branch: run.branch }), runId: run.id, branch: run.branch, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: tr('main.runner.push.summary', { branch: run.branch }) } });
    if (created) say(run, 'runner.push.proposed', { branch: run.branch }, end.stage.id);
  }

  /** The push was carried out: the pull request waits in Actions for its own "sim" (unless one is already there). */
  async function pullRequest(runId: string): Promise<void> {
    const run = need(runId);
    const provider = door.provider();
    if (!provider) return;
    try {
      if (await prOf(run, provider)) return;
      const draft = run.comments.pr;
      const { repo } = projects(run);
      const title = (draft?.title || run.issue.title).trim();
      // The description comes from the template; a cycle with none still says which issue the pull request closes.
      const closes = closesOf(run);
      const body = draft?.body ? draft.body : `${closes}\n`;
      const target = (await provider.getRepo(repo)).defaultBranch;
      const commands = await provider.planWrite({ op: 'createMr', project: repo, title, body, sourceBranch: run.branch, targetBranch: target });
      const created = door.propose({ key: `pr:${run.id}`, issue: run.issue.iid, issueTitle: run.issue.title, summary: title, detail: body, unit: { runId, purpose: 'run-pr' }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: title } }, commands);
      moveRun(d, runId, (r) => recordCommentProposal(r, 'pr', { target: 'mr', bodyHash: hashOf(body), body, title }, now()));
      if (created) say(run, 'runner.pr.proposed', { title }, 'implement');
    } catch (e) {
      say(run, 'runner.pr.failed', { reason: message(e) });
    }
  }

  async function pullRequestOpened(runId: string, responses: unknown[]): Promise<void> {
    const run = need(runId);
    const made = prRefOf(responses[0]);
    if (made.iid === null) {
      say(run, 'runner.pr.failed', { reason: tr('main.runner.comment.noId') });
      return;
    }
    const body = run.comments.pr?.body ?? '';
    const after = moveRun(d, runId, (r) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: made.iid as number, url: made.url, bodyHash: hashOf(body) }, now()));
    say(after, 'runner.pr.created', { url: made.url ?? '' });
    await flush(runId);
  }

  // ---- reviews that waited for the pull request -------------------------------------------------------------------------------------

  /** The latest review that has not gone out goes out now (the earlier rounds were answered by the work that followed them). */
  async function flush(runId: string): Promise<void> {
    const run = deps.runs.get(runId);
    if (!run) return;
    const waiting = run.reviews.filter((r) => run.comments[`review-${r.round}`]?.status === 'draft').at(-1);
    if (!waiting) return;
    const flowStage = flowOfRun(run, deps.config()).find((s) => s.id === waiting.stage);
    await publishReview(runId, waiting.round, { autonomous: stageAutonomy(run, waiting.stage), by: waiting.by || flowStage?.agent || 'app' });
  }

  // ---- what happens when a proposal is carried out -----------------------------------------------------------------------------------

  async function done(a: ReleaseAction, responses: unknown[]): Promise<void> {
    if (a.kind === 'run-push') {
      const runId = String(a.unit?.runId ?? '');
      if (deps.runs.get(runId)) await pullRequest(runId);
      return;
    }
    const unit = a.unit ?? {};
    const runId = String(unit.runId ?? '');
    const run = deps.runs.get(runId);
    if (!run) return;
    const provider = door.provider();
    if (unit.purpose === 'run-pr') return pullRequestOpened(runId, responses);
    if (unit.purpose === 'review' && provider) {
      const round = Number(unit.round);
      const draft = run.comments[`review-${round}`];
      const commands = a.commands ?? (a.command ? [a.command] : []);
      return recordReviewPosted(runId, `review-${round}`, { round, commands, responses, provider, pr: { project: String(unit.project), iid: Number(unit.iid) }, bodyHash: String(unit.bodyHash ?? draft?.bodyHash ?? ''), body: draft?.body ?? '' });
    }
    if (unit.purpose === 'comment' && provider) {
      const key = String(unit.key);
      const draft = run.comments[key];
      const target = unit.target === 'mr' ? 'mr' : 'issue';
      await afterPosted(runId, {
        key,
        stage: String(unit.stage ?? key),
        kinds: Array.isArray(unit.kinds) ? (unit.kinds as ForumMessage['kind'][]) : ['post'],
        target,
        title: draft?.title ?? a.summary ?? key,
        body: draft?.body ?? '',
        headline: draft?.headline ?? '',
        // The person decided to post it: no extra notice on top of the comment they approved.
        announce: false,
        hash: String(unit.bodyHash ?? draft?.bodyHash ?? ''),
        details: { body: draft?.body ?? '', headline: draft?.headline ?? '', title: draft?.title ?? a.summary ?? key },
        noteId: unit.edit === true ? (draft?.noteId ?? null) : null,
        responses,
        where: { project: String(unit.project), iid: Number(unit.iid) },
        provider,
        previous: null,
      });
    }
  }

  // Anything that goes wrong while publishing is said in the thread and never fails the stage or the run.
  const guarded = (runId: string, work: () => Promise<void>): Promise<void> =>
    work().catch((e) => {
      const run = deps.runs.get(runId);
      console.error('[runner] publishing', runId, message(e));
      if (run) say(run, 'runner.publish.failed', { reason: message(e) });
    });

  return {
    stageEnded: (runId, end) =>
      guarded(runId, async () => {
        if (end.kind === 'review') await review(runId, end);
        else await stageComment(runId, end);
        if (end.kind === 'work' && pushStageOf(deps.config(), flowOfRun(need(runId), deps.config()))?.id === end.stage.id) await pushStage(runId, end);
      }),
    asked: (runId, e) => guarded(runId, () => question(runId, e)),
    gateDecided: (runId, e) => guarded(runId, () => gate(runId, e)),
    actionDone: (a, responses) => guarded(String(a.unit?.runId ?? ''), () => done(a, responses)),
    flushReviews: (runId) => guarded(runId, () => flush(runId)),
  };
}

