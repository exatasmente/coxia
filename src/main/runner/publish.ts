import { createHash } from 'node:crypto';
import { autonomyOf, choiceOn, flowKeyOf } from '../../shared/config/autonomy';
import { autonomousOf } from '../../shared/config/squads';
import type { AgentDef, CommentTemplate, WorkspaceConfig } from '../../shared/config/types';
import { cycleText } from '../../shared/cycles/text';
import { type ForumMessage, type PublishedRef, runThreadId } from '../../shared/forum';
import { createTranslator } from '../../shared/i18n';
import { crMarkOf } from '../../shared/i18n/terms';
import { type ReleaseUnit, alwaysWaits, parseReleaseUnit, releaseBranchOf, releaseTagOf, releaseWaits, soleMaintainerOf } from '../../shared/release';
import {
  type CommentProblem,
  type CommentTarget,
  type FlowStage,
  type OutputKind,
  type ReleaseActivity,
  type Run,
  type StageComment,
  type StageOutput,
  type WaitState,
  checkComment,
  checkText,
  findMarked,
  flowOfRun,
  markerOf,
  priorityStageOf,
  pushesAt,
  readMarker,
  recordSubject,
  recordCommentDraft,
  recordCommentProposal,
  recordCommentPublished,
  recordCommentRefused,
  recordCommentRemoved,
  renderComment,
  scenarioBlocks,
  scenarioNotes,
} from '../../shared/runs';
import type { ReleaseAction, VcsCommand } from '../../shared/types';
import { priorityOf, resolvePriority } from '../../shared/priority';
import { redact } from '../errorlog-core';
import type { ForumStore } from '../forum-core';
import type { RunStore } from '../runs-core';
import { moveRun } from '../runs-forum';
import type { VcsComment, VcsProvider, VcsThread, VcsWriteOp } from '../vcs/types';
import { type BranchState, type MilestoneIssue, type ReleaseBrief, type RemoteRelease, activitiesText, releaseRecord, releaseTitle } from './release';
import { type Placed, commentText, generalFindings, lineCountText, placeFindings, reviewComments, sameFinding, withTail, withoutRepeats } from './review';

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

/** One step of a release that waits in Actions for a "sim". */
export interface ReleaseMeta {
  key: string;
  issue: number;
  issueTitle: string;
  summary: string;
  unit: ReleaseUnit;
  /** The stage and the attempt that asked for it: the steps of one group are carried out in the order they need each other. */
  group: string;
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
  /** Pushes the run's branch by itself, audited, under the autonomy block's "push" choice. Throws the reason it did not happen. */
  push(meta: PushMeta, by: string): Promise<void>;
  /** Puts one step of a release in Actions as a proposal; false when the same proposal is already there. */
  proposeRelease(meta: ReleaseMeta): boolean;
  /** Runs one local step of a release by itself, audited as the agent. A push is refused by the door whatever is asked. Throws the reason it did not happen. */
  release(meta: { issue: number; key: string; summary: string; by: string }, unit: ReleaseUnit): Promise<string>;
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
  /** The tags of the repository of a release run, as the local clone has them (a release run reads the beta it waits for from there). Without it the beta waits never end by themselves. */
  localTags?(run: Run): Promise<string[]>;
  /** What the remote of a release run's repository has of its version right now (null when it could not be read). Without it the waits for the host never end by themselves. */
  remoteRelease?(run: Run): Promise<RemoteRelease | null>;
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

/** What came of asking for the issue another squad's request turns into. */
export type IssueMade = { status: 'created'; iid: number; url: string | null } | { status: 'proposed' } | { status: 'refused' | 'no-host' | 'failed'; reason: string };

export interface Publisher {
  /** A work stage ended an attempt (done, findings or QA result). Its comment goes out, or waits, or is refused; a review goes to the pull request. */
  stageEnded(runId: string, end: StageEnd): Promise<void>;
  /** An agent asked the person something. */
  asked(runId: string, e: { stage: FlowStage; agent: AgentDef; question: string; autonomous: boolean }): Promise<void>;
  /** The person decided a gate. */
  gateDecided(runId: string, e: { stage: FlowStage; action: GateAction; reason: string; autonomous: boolean }): Promise<void>;
  /** A proposal this publisher made was carried out (or the push of a run was). */
  actionDone(action: ReleaseAction, responses: unknown[]): Promise<void>;
  /** The person's "sim" on a proposal of a run was refused before anything ran: the thread says why. */
  actionRefused(action: ReleaseAction, reason: string): Promise<void>;
  /** The review of a round that waited for the pull request goes out now, if the pull request exists. */
  flushReviews(runId: string): Promise<void>;
  /** Whether the event a waiting run waits for has happened, as the code host says (a reply is what the person wrote). Never throws: an unreadable host is "not yet". */
  waitOver(runId: string): Promise<{ over: boolean; reply?: string }>;
  /** Proposes deleting what an automatic post of the run put on the tracker (always a "yes"). `proposed` is false when there was nothing to propose and `reason` says why. */
  undo(runId: string, key: string): Promise<{ proposed: boolean; reason?: 'refused' | 'nothing' | 'no-host' }>;
  /**
   * The issue another squad's request turns into, created on the tracker in the issue project with the squad's label: by itself when the liaison that took
   * the request runs by itself (`autonomous`), as a proposal waiting for a "yes" otherwise (the runner learns of it through `actionDone`), refused in a test workspace.
   */
  requestIssue(runId: string, e: { key: string; squad: string; title: string; body: string; label: string | null; by: string; autonomous: boolean }): Promise<IssueMade>;
  /** The run started in a squad that carries a label on the tracker: the issue gets it, by itself when the squad's liaison runs by itself and as a proposal otherwise. */
  squadRouted(runId: string, e: { squad: string; label: string; by: string; autonomous: boolean }): Promise<void>;
  /** The run entered a stage that sets a label on the tracker (and left one that had set another). */
  stageEntered(runId: string, e: { stage: FlowStage; previous: FlowStage | null; autonomous: boolean }): Promise<void>;
  /** What a release is made of right now, read from the host before its run exists: the pull requests aimed at its branch and the open issues of its milestone. Never throws. */
  releaseBrief(i: { version: string; repo: string; branch: BranchState; from: string | null }): Promise<{ brief: ReleaseBrief; text: string }>;
  /** A release run began: its tracking issue is created (or adopted), its activities are listed there, and the branch is opened (or asked to be) when it does not exist. */
  releaseStarted(runId: string, e: { branchExists: boolean }): Promise<void>;
  /** One step of the release, asked through the `ReleaseAction` tool: the answer is what the agent is told (it ran, or it waits for the person, or why it was refused). */
  releaseStep(runId: string, input: unknown, who: { by: string; autonomous: boolean; stage: string; attempt: number }): Promise<string>;
  /** What the sweep looks at in a release run: the activities, the betas and the stable that were published, and the tracking issue. Never throws. */
  releaseTick(runId: string): Promise<void>;
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

  /** The issue a run's comments go to: its own issue, or, for a release, the tracking issue (0 until it exists). */
  const trackIid = (run: Run): number => (run.subject ? (run.subject.tracking?.iid ?? 0) : run.issue.iid);

  const projects = (run: Run): { issue: string; repo: string } => {
    const env = deps.env();
    return { issue: env.issueProject, repo: env.repos.find((r) => r.id === run.repo)?.projectPath || env.issueProject };
  };

  const checkOptions = (run: Run, config: WorkspaceConfig) => ({ worktree: run.worktree, agentIds: config.agents.team.map((a) => a.id), redact: (text: string) => redact(text) });
  const stageName = (label: string): string => cycleText(label, lang());
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
    const list = target === 'issue' ? await provider.listIssueComments(issue, trackIid(run)) : pr ? await provider.listMrComments(pr.project, pr.iid) : [];
    return list.filter((c) => !c.system);
  }

  /** The pull request of the run: the one the run recorded, else an open one from its branch (the person may have opened it by hand). */
  async function prOf(run: Run, provider: VcsProvider): Promise<{ project: string; iid: number; url: string | null } | null> {
    const known = run.comments.pr;
    const { issue, repo } = projects(run);
    if (known && known.status === 'published' && known.noteId !== null && /^\d+$/.test(String(known.noteId))) return { project: repo, iid: Number(known.noteId), url: known.url };
    // A documentation run has no issue to link a pull request to: what it opened is the one it recorded, and nothing is looked for under the issue number 0.
    if (run.docs) return null;
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
    // A documentation run has no issue: what would be a comment on it stays in the run's own thread, which is its record, and nothing is drafted, proposed or written.
    if (x.target === 'issue' && run.docs) return;
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
    // A release run comments on its tracking issue; until that exists the comment stays a draft and goes out when it does (`flushTracking`).
    if (x.target === 'issue' && run.subject && !trackIid(run)) {
      say(run, 'runner.release.noTracking', { title: x.title });
      return;
    }
    const where = x.target === 'issue' ? { project: projects(run).issue, iid: trackIid(run) } : await prOf(run, provider);
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

    const meta = { issue: trackIid(run), summary: x.title, by: x.by, bodyHash: hash };
    const unit = { runId, purpose: 'comment', key: x.key, stage: x.stage, kinds: x.kinds, target: x.target, bodyHash: hash, project: where.project, iid: where.iid, edit: noteId !== null };

    if (!x.autonomous || x.problems.length) {
      const created = door.propose({ key: `comment:${runId}:${x.key}:${hash.slice(0, 12)}`, issue: trackIid(run), issueTitle: run.issue.title, summary: x.title, detail: [x.problems.length ? tr('main.runner.comment.heldDetail', { problems: problemsText(x.problems) }) : '', x.body].filter(Boolean).join('\n\n'), unit, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: x.title } }, commands);
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
        await door.post({ issue: trackIid(run), key: `notice:${run.id}:${p.key}:${hashOf(p.headline).slice(0, 8)}`, summary: p.title, by: stageAgent(run, p.key), bodyHash: hashOf(body) }, cmds);
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
      return tr(`main.runner.comment.result.${s.some(scenarioBlocks) ? 'fail' : s.some((x) => x.result === 'not-run') ? 'partial' : s.some(scenarioNotes) ? 'passNotes' : 'pass'}`);
    }
    return undefined;
  };

  // What QA saw fail without blocking goes into its comment as a section of its own, after the template's sections.
  const notesTail = (end: StageEnd): string | undefined => {
    const notes = end.kind === 'qa' ? end.output.scenarios.filter(scenarioNotes) : [];
    if (!notes.length) return undefined;
    return `### ${tr('main.runner.scenario.notesTitle')}\n\n${notes.map((s) => tr('main.runner.scenario.note', { name: s.name, detail: s.detail || '—' })).join('\n')}`;
  };

  // For a QA agent with a sandbox: how many scenarios were executed and which claims nothing backed. Absent for one without (everything it did was reading).
  const evidenceTail = (end: StageEnd): string | undefined => {
    if (end.kind !== 'qa' || (end.agent.shell !== 'sandbox' && end.agent.shell !== 'host') || !end.output.scenarios.length) return undefined;
    const all = end.output.scenarios;
    const unbacked = all.filter((s) => s.unbacked);
    const lines = [tr('main.runner.scenario.evidenceLine', { executed: all.filter((s) => s.evidence === 'executed').length, total: all.length }), ...(unbacked.length ? [tr('main.runner.scenario.evidenceUnbacked', { names: unbacked.map((s) => s.name).join('; ') })] : [])];
    return `### ${tr('main.runner.scenario.evidenceTitle')}\n\n${lines.join('\n')}`;
  };

  async function stageComment(runId: string, end: StageEnd): Promise<void> {
    const config = deps.config();
    const tpl = templateOf(config, end.stage);
    if (!tpl) return;
    const run = need(runId);
    const marker = markerOf(run.id, end.stage.id);
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: stageName(end.stage.label), round: end.round, result: resultWord(end) }, end.output.comment, { marker, fallback: end.output.summary, tail: [notesTail(end), evidenceTail(end)].filter(Boolean).join('\n\n') || undefined });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: tpl.technicalDetail });
    await deliver(runId, { key: end.stage.id, stage: end.stage.id, kinds: ['post'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: end.agent.id, autonomous: end.autonomous, announce: true });
  }

  async function question(runId: string, e: { stage: FlowStage; agent: AgentDef; question: string; autonomous: boolean }): Promise<void> {
    const config = deps.config();
    const tpl = config.devCycle.comments.question;
    if (!tpl) return;
    const run = need(runId);
    // Each time an agent asks is its own comment: the thread of the issue reads as the conversation it was.
    const n = run.history.filter((h) => (h.type === 'question' || (h.type === 'wait-started' && h.detail === 'reporter-reply')) && h.stage === e.stage.id).length || 1;
    const key = `question-${e.stage.id}-${n}`.slice(0, 48);
    const marker = markerOf(run.id, key);
    const content: StageComment = { sections: [{ heading: '', body: e.question }], technical: '' };
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: stageName(e.stage.label) }, content, { marker });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: tpl.technicalDetail });
    await deliver(runId, { key, stage: e.stage.id, kinds: ['question'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: e.agent.id, autonomous: e.autonomous, announce: false });
  }

  /**
   * The plan was just accepted and its heads frozen from what the run had read (what the person was shown): the host is read again at once, and a pull request that
   * moved in the meantime, or that was not in the plan, is said in the thread. It is not merged either way (a merge needs the frozen head), so this only tells.
   */
  async function reportMovedSincePlan(runId: string): Promise<void> {
    if (!need(runId).subject?.planned) return;
    await refreshActivities(runId);
    const run = need(runId);
    const planned = run.subject?.planned ?? {};
    for (const a of run.subject?.activities ?? []) {
      if (a.state !== 'open') continue;
      const was = planned[String(a.pr)];
      if (!was) say(run, 'runner.release.notInPlan', { pr: a.pr, now: a.head.slice(0, 9) });
      else if (was.toLowerCase() !== a.head.toLowerCase()) say(run, 'runner.release.movedSincePlan', { pr: a.pr, was: was.slice(0, 9), now: a.head.slice(0, 9) });
    }
  }

  /**
   * The run has just entered the plan gate with the heads it had read (`seen`, taken by the transition): the host is read once more and `seen` is taken again from that, so what
   * the person is shown is as fresh as the end of the plan stage. After this nothing rewrites it (a sweep rewrites `activities`, not `seen`): the gate freezes `seen`.
   */
  async function sealSeen(runId: string): Promise<void> {
    const run = need(runId);
    if (!run.subject || run.subject.planned || run.status !== 'gate') return;
    const first = flowOfRun(run, deps.config()).find((s) => s.type === 'gate');
    if (!first || first.id !== run.stage) return;
    await refreshActivities(runId);
    const fresh = need(runId);
    if (!fresh.subject || fresh.subject.planned || fresh.status !== 'gate' || fresh.stage !== first.id) return;
    const seen = Object.fromEntries(fresh.subject.activities.map((a) => [String(a.pr), a.head]));
    moveRun(d, runId, (r) => recordSubject(r, { seen }, now()));
  }

  async function gate(runId: string, e: { stage: FlowStage; action: GateAction; reason: string; autonomous: boolean }): Promise<void> {
    const config = deps.config();
    if (e.action !== 'reject' && need(runId).subject && flowOfRun(need(runId), config).find((s) => s.type === 'gate')?.id === e.stage.id) await reportMovedSincePlan(runId).catch(() => undefined);
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
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: stageName(e.stage.label), decision }, content, { marker, tail: link ? tr('main.runner.comment.decisionLink', { url: link }) : undefined });
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
    // The general comment is for what does not fit a line: whatever the agent wrote that says what a finding says on its line is left out (the fallback text
    // is not used either: with findings, the summary would be them again).
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: stageName(end.stage.label), round, result: resultWord(end) }, withoutRepeats(end.output.comment, record.findings), { marker, ...(record.findings.length ? {} : { fallback: end.output.summary }) });
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
    const general = checkComment(withTail(draft.body, [lineCountText(reviewComments(fresh, bodies).length, lang()), generalFindings(fresh, lang())].filter(Boolean).join('\n\n')), { ...checkOptions(run, config), status: draft.headline ?? '', marker: markerOf(run.id, 'review', round), technicalDetail: tpl?.technicalDetail ?? true });
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

  /**
   * The autonomy block that decides this run's steps, and one of its choices as it stands right now. A run of a release is left out whatever the block says: the steps
   * that leave the machine in a release (the push of the branch, the push of a tag) run the repository's own script as the person and only ever wait for a "sim".
   */
  const chooses = (run: Run, choice: 'push' | 'pullRequest'): boolean => (run.subject ? false : choiceOn(autonomyOf(deps.config(), flowKeyOf(run.squad)), choice));

  /** At the end of the stage that ends with the push: the pull request's description is written, and the push goes out by itself or waits in Actions. */
  async function pushStage(runId: string, end: StageEnd): Promise<void> {
    const config = deps.config();
    const run = need(runId);
    const pr = config.devCycle.comments[run.docs ? 'docs-pr' : 'pr'];
    if (pr) {
      const marker = markerOf(run.id, 'pr');
      // What the pull request of an issue's run says last is the line that closes the issue; a documentation run has none to close.
      const closes = run.docs ? undefined : closesOf(run);
      const rendered = renderComment(pr, { language: lang(), ref: run.issue.ref, stage: stageName(end.stage.label) }, end.output.pr, { marker, fallback: end.output.summary, tail: closes });
      const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: pr.technicalDetail });
      const title = (end.output.pr?.title || run.issue.title).trim().slice(0, 120);
      moveRun(d, runId, (r) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: hashOf(checked.body), body: checked.body, headline: rendered.status, title }, now()));
    } else if (run.docs) {
      // No template for it (the person removed it): the description is what the stage said it did, still checked like any text that leaves the machine.
      const checked = checkComment(end.output.summary, { ...checkOptions(run, config), status: '', marker: markerOf(run.id, 'pr'), technicalDetail: false });
      const title = (end.output.pr?.title || run.issue.title).trim().slice(0, 120);
      moveRun(d, runId, (r) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: hashOf(checked.body), body: checked.body, headline: '', title }, now()));
    }
    // Each time the stage ends is a new state of the branch: a push of an earlier one that still waits is replaced.
    const attempt = run.stages.find((s) => s.stage === end.stage.id)?.attempts ?? 1;
    const meta = { key: `push:${run.id}:${attempt}`, issue: run.issue.iid, issueTitle: run.issue.title, summary: tr('main.runner.push.summary', { branch: run.branch }), runId: run.id, branch: run.branch, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: tr('main.runner.push.summary', { branch: run.branch }) } };
    // The autonomy block may let the push go out by itself, audited; a test workspace and a workspace with no host still refuse it where they always did.
    if (chooses(run, 'push')) {
      const refusal = door.refusal();
      if (refusal) {
        say(run, 'runner.push.refused', { reason: refusal }, end.stage.id);
      } else {
        try {
          await door.push(meta, end.agent.id);
          say(run, 'runner.push.pushed', { branch: run.branch }, end.stage.id);
        } catch (e) {
          say(run, 'runner.push.failed', { reason: message(e) }, end.stage.id);
        }
      }
      return;
    }
    const created = door.proposePush(meta);
    if (created) say(run, 'runner.push.proposed', { branch: run.branch }, end.stage.id);
  }

  /** The push was carried out: the pull request is opened by itself or waits in Actions for its own "sim" (unless one is already there). */
  async function pullRequest(runId: string): Promise<void> {
    const run = need(runId);
    const provider = door.provider();
    if (!provider) return;
    try {
      if (await prOf(run, provider)) return;
      const draft = run.comments.pr;
      const { repo } = projects(run);
      const title = (draft?.title || run.issue.title).trim();
      // The description comes from the template; a cycle with none still says which issue the pull request closes (a documentation run closes none).
      const body = draft?.body ? draft.body : run.docs ? '' : `${closesOf(run)}\n`;
      const target = (await provider.getRepo(repo)).defaultBranch;
      const commands = await provider.planWrite({ op: 'createMr', project: repo, title, body, sourceBranch: run.branch, targetBranch: target });
      // The autonomy block may open it by itself, through the same door that audits every other write an agent's autonomy lets out.
      if (chooses(run, 'pullRequest')) {
        const refusal = door.refusal();
        if (refusal) {
          say(run, 'runner.pr.refused', { reason: refusal });
          return;
        }
        try {
          const responses = await door.post({ key: `pr:${run.id}`, issue: run.issue.iid, summary: title, by: 'app' }, commands);
          await pullRequestOpened(runId, responses);
        } catch (e) {
          say(run, 'runner.pr.failed', { reason: message(e) });
        }
        return;
      }
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

  // ---- taking a post back ------------------------------------------------------------------------------------------------------------

  /** The notes of a review round: the comments on its lines and files (found by their marker) and, where the host lets it be deleted, its general comment. */
  async function reviewNotes(run: Run, round: number, rec: { noteId: string | number | null }, provider: VcsProvider, pr: { project: string; iid: number }): Promise<{ id: string | number; target: 'mr' | 'review' }[]> {
    const found: { id: string | number; target: 'mr' | 'review' }[] = [];
    for (const thread of await provider.listMrThreads(pr.project, pr.iid)) {
      const m = readMarker(thread.notes[0]?.body ?? '');
      if (m && m.run === run.id && m.key === 'review' && m.round === round && m.finding !== null) found.push({ id: thread.notes[0].id, target: 'review' });
    }
    // GitHub's review text is the review itself, which a host never deletes once submitted; on the other hosts it is a comment like the rest.
    if (provider.kind !== 'github' && rec.noteId !== null) found.push({ id: rec.noteId, target: 'mr' });
    return found;
  }

  async function undo(runId: string, key: string): Promise<{ proposed: boolean; reason?: 'refused' | 'nothing' | 'no-host' }> {
    const run = need(runId);
    const rec = run.comments[key];
    const title = rec?.title || key;
    if (!rec || rec.status !== 'published' || rec.noteId === null || key === 'pr') return { proposed: false, reason: 'nothing' };
    if (door.refusal()) {
      say(run, 'runner.undo.refused', { title });
      return { proposed: false, reason: 'refused' };
    }
    const provider = door.provider();
    if (!provider) return { proposed: false, reason: 'no-host' };
    const { issue } = projects(run);
    const review = /^review-(\d+)$/.exec(key);
    let ops: VcsWriteOp[];
    if (rec.target === 'issue') {
      ops = [{ op: 'deleteNote', project: issue, iid: run.issue.iid, noteId: rec.noteId, target: 'issue' }];
    } else {
      const pr = await prOf(run, provider);
      if (!pr) return { proposed: false, reason: 'nothing' };
      const notes = review ? await reviewNotes(run, Number(review[1]), rec, provider, pr) : [{ id: rec.noteId, target: 'mr' as const }];
      ops = notes.map((n) => ({ op: 'deleteNote' as const, project: pr.project, iid: pr.iid, noteId: n.id, target: n.target }));
    }
    const commands = (await Promise.all(ops.map((o) => provider.planWrite(o)))).flat();
    if (!commands.length) {
      say(run, 'runner.undo.nothing', { title });
      return { proposed: false, reason: 'nothing' };
    }
    const summary = tr('main.runner.undo.summary', { title });
    const created = door.propose({ key: `undo:${runId}:${key}`, issue: run.issue.iid, issueTitle: run.issue.title, summary, detail: [tr('main.runner.undo.detail', { url: rec.url ?? '' }), rec.body ?? ''].filter(Boolean).join('\n\n'), unit: { runId, purpose: 'undo', key }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
    if (created) say(run, 'runner.undo.proposed', { title });
    return { proposed: true };
  }

  // ---- what happens when a proposal is carried out -----------------------------------------------------------------------------------

  async function done(a: ReleaseAction, responses: unknown[]): Promise<void> {
    if (a.kind === 'run-push') {
      const runId = String(a.unit?.runId ?? '');
      if (deps.runs.get(runId)) await pullRequest(runId);
      return;
    }
    if (a.kind === 'release-git') return releaseStepDone(a);
    const unit = a.unit ?? {};
    const runId = String(unit.runId ?? '');
    const run = deps.runs.get(runId);
    if (!run) return;
    const provider = door.provider();
    if (unit.purpose === 'run-pr') return pullRequestOpened(runId, responses);
    if (unit.purpose === 'release-tracking') return trackingMade(runId, responses);
    if (unit.purpose === 'release-close') {
      const tracking = run.subject?.tracking;
      if (!tracking) return;
      moveRun(d, runId, (r) => recordSubject(r, { tracking: { ...tracking, closed: true } }, now()));
      return say(run, 'runner.release.closed', { url: tracking.url ?? '' });
    }
    if (unit.purpose === 'undo') {
      const key = String(unit.key);
      if (!run.comments[key]) return;
      const after = moveRun(d, runId, (r) => recordCommentRemoved(r, key, now()));
      say(after, 'runner.undo.removed', { title: after.comments[key].title || key });
      return;
    }
    // A write an answer proposed in the run's thread was approved: the thread hears that it went out, so a proposal raised there is not answered in silence.
    if (unit.purpose === 'mention-write') return say(run, 'runner.mention.writeDone', { agent: String(unit.agent ?? ''), summary: a.summary ?? '' });
    if (unit.purpose === 'review' && provider) {
      const round = Number(unit.round);
      const draft = run.comments[`review-${round}`];      const commands = a.commands ?? (a.command ? [a.command] : []);
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

  // ---- the priority an agent proposes ------------------------------------------------------------------------------------------------

  /** A priority is the person's decision: whatever the agent's autonomy, it only ever waits in Actions for a "yes". */
  async function proposePriority(runId: string, end: StageEnd): Promise<void> {
    const to = end.output.priority.trim();
    if (!to) return;
    const config = deps.config();
    const run = need(runId);
    // A documentation run has no issue whose labels could be read or proposed: it is told nothing of a priority (the flow of a workspace can be edited, so the guard is here).
    if (run.docs) return;
    const levels = config.devCycle.priority.labels;
    // Only the stage that owns the priority proposes it: a level any other stage returned is said not to have been taken.
    const flow = flowOfRun(run, config);
    const owner = priorityStageOf(flow);
    if (owner?.id !== end.stage.id) return say(run, 'runner.priority.notOwner', { agent: end.agent.id, to, owner: owner?.agent ?? '—' }, end.stage.id);
    if (end.output.milestone) say(run, 'runner.priority.milestone', { milestone: end.output.milestone, agent: end.agent.id }, end.stage.id);
    if (door.refusal()) return say(run, 'runner.priority.refused', { to }, end.stage.id);
    const provider = door.provider();
    if (!provider) return say(run, 'runner.priority.noHost', { to }, end.stage.id);
    const { issue } = projects(run);
    const labels = (await provider.getIssue(issue, run.issue.iid)).labels;
    const change = resolvePriority({ labels, priority: priorityOf(labels, levels), project: issue, iid: String(run.issue.iid), title: run.issue.title }, to, levels);
    if (change.noWrite || !change.label) return say(run, 'runner.priority.noWrite', { to, reason: tr(`main.runner.priority.noWrite.${change.noWrite ?? 'unmapped'}`) }, end.stage.id);
    const commands = await provider.planWrite({ op: 'setIssueLabels', project: issue, iid: run.issue.iid, add: change.add ? [change.add] : [], remove: change.remove });
    if (!commands.length) return say(run, 'runner.priority.unsupported', { to: change.label }, end.stage.id);
    const summary = tr('main.runner.priority.summary', { label: change.label, ref: run.issue.ref });
    const detail = [tr('main.runner.priority.detail', { agent: end.agent.id, label: change.label }), end.output.milestone ? tr('main.runner.priority.detailMilestone', { milestone: end.output.milestone }) : '', end.output.summary].filter(Boolean).join('\n\n');
    // One proposal per stage and attempt: the key a stage's earlier proposal (or another stage's) holds is not the next one's.
    const attempt = run.stages.find((x) => x.stage === end.stage.id)?.attempts ?? 1;
    const created = door.propose({ key: `priority:${runId}:${end.stage.id}:${attempt}`, issue: run.issue.iid, issueTitle: run.issue.title, summary, detail, unit: { runId, purpose: 'priority', key: 'priority', stage: end.stage.id }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
    say(run, created ? 'runner.priority.proposed' : 'runner.priority.duplicate', created ? { label: change.label, agent: end.agent.id } : { to: change.label }, end.stage.id);
  }

  // ---- what a waiting run waits for -----------------------------------------------------------------------------------------------

  /** The pull request of the run, in any state: the recorded one, else one from its branch that the issue links to. */
  async function prState(run: Run, provider: VcsProvider): Promise<'open' | 'merged' | 'closed' | null> {
    const known = run.comments.pr;
    const { issue, repo } = projects(run);
    if (known && known.status === 'published' && known.noteId !== null && /^\d+$/.test(String(known.noteId))) return (await provider.getMr(repo, Number(known.noteId))).state;
    if (run.docs) return null;
    const found = (await provider.linkedMrs(issue, run.issue.iid)).find((m) => m.sourceBranch === run.branch);
    return found ? found.state : null;
  }

  async function waitOver(runId: string): Promise<{ over: boolean; reply?: string }> {
    const run = deps.runs.get(runId);
    const w = run?.wait;
    if (!run || !w) return { over: false };
    try {
      if (w.kind === 'time') return { over: Date.parse(w.since) + (w.minutes ?? 0) * 60_000 <= (deps.now?.() ?? new Date()).getTime() };
      // The runs a run waits on are the runner's to know (it holds the runs, and the issues' state is read by it): the runner resolves `linked-done` itself.
      if (w.kind === 'linked-done') return { over: false };
      const provider = door.provider();
      if (!provider) return { over: false };
      const { issue } = projects(run);
      if (w.kind === 'pr-merged') return { over: (await prState(run, provider)) === 'merged' };
      if (w.kind === 'release-approved') return { over: await releaseMerged(run, provider) };
      if (w.kind === 'beta-age') return { over: await betaAged(run, provider, w) };
      if (w.kind === 'beta-out') return { over: await betaOut(run, provider) };
      if (w.kind === 'stable-out') return { over: await stableOut(run) };
      // What is left is read from the issue (its label, a reply to it): a documentation run has none, so such a wait is never over by itself and the person skips it.
      if (run.docs) return { over: false };
      if (w.kind === 'label') {
        const want = (w.label ?? '').trim().toLowerCase();
        return { over: !!want && (await provider.getIssue(issue, run.issue.iid)).labels.some((l) => l.toLowerCase() === want) };
      }
      // A reply is a comment of a person written after the wait began: anything the app itself posted carries its marker, and a note of the system is not one.
      const since = Date.parse(w.since);
      const reply = (await provider.listIssueComments(issue, run.issue.iid))
        .filter((c) => !c.system && !readMarker(c.body) && Date.parse(c.createdAt) > since)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .at(0);
      return reply ? { over: true, reply: redact(reply.body).slice(0, 4000) } : { over: false };
    } catch (e) {
      console.error('[runner] could not look for what the run waits for', runId, message(e));
      return { over: false };
    }
  }

  // ---- the label a stage sets on the tracker ----------------------------------------------------------------------------------------

  async function stageEntered(runId: string, e: { stage: FlowStage; previous: FlowStage | null; autonomous: boolean }): Promise<void> {
    const add = e.stage.trackerStatus;
    const remove = e.previous?.trackerStatus && e.previous.trackerStatus !== add ? e.previous.trackerStatus : null;
    if ((!add || add === e.previous?.trackerStatus) && !remove) return;
    const run = need(runId);
    // A documentation run has no issue to carry a status label.
    if (run.docs) return;
    const refusal = door.refusal();
    if (refusal) return say(run, 'runner.status.refused', { label: add ?? remove ?? '' }, e.stage.id);
    const provider = door.provider();
    if (!provider) return;
    const { issue } = projects(run);
    const commands = await provider.planWrite({ op: 'setIssueLabels', project: issue, iid: run.issue.iid, add: add && add !== e.previous?.trackerStatus ? [add] : [], remove: remove ? [remove] : [] });
    if (!commands.length) return;
    const attempt = run.stages.find((s) => s.stage === e.stage.id)?.attempts ?? 1;
    const key = `status:${runId}:${e.stage.id}:${attempt}`;
    const summary = tr('main.runner.status.summary', { label: add ?? remove ?? '', stage: stageName(e.stage.label) });
    // The agent of the stage lets it go out by itself; a gate or a wait has no agent to speak for it, so it waits for a "yes".
    if (!e.autonomous) {
      const created = door.propose({ key, issue: run.issue.iid, issueTitle: run.issue.title, summary, unit: { runId, purpose: 'status', stage: e.stage.id }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
      if (created) say(run, 'runner.status.proposed', { label: add ?? remove ?? '' }, e.stage.id);
      return;
    }
    try {
      await door.post({ issue: run.issue.iid, key, summary, by: e.stage.agent ?? 'app' }, commands);
      say(run, 'runner.status.set', { label: add ?? remove ?? '' }, e.stage.id);
    } catch (err) {
      say(run, 'runner.status.failed', { label: add ?? remove ?? '', reason: message(err) }, e.stage.id);
    }
  }

  // ---- the issue another squad's request becomes ----------------------------------------------------------------------------------

  async function requestIssue(runId: string, e: { key: string; squad: string; title: string; body: string; label: string | null; by: string; autonomous: boolean }): Promise<IssueMade> {
    const run = need(runId);
    // A documentation run has no tracker project of its own to open an issue in for another squad.
    if (run.docs) return { status: 'no-host', reason: '' };
    const refusal = door.refusal();
    if (refusal) {
      say(run, 'runner.request.refused', { title: e.title });
      return { status: 'refused', reason: refusal };
    }
    const provider = door.provider();
    if (!provider) return { status: 'no-host', reason: '' };
    const { issue } = projects(run);
    const commands = await provider.planWrite({ op: 'createIssue', project: issue, title: e.title, body: e.body, labels: e.label?.trim() ? [e.label.trim()] : [] });
    const summary = tr('main.runner.request.issueSummary', { title: e.title, squad: e.squad });
    const key = `request:${runId}:${e.key}`;
    if (!e.autonomous) {
      const created = door.propose({ key, issue: run.issue.iid, issueTitle: run.issue.title, summary, detail: e.body, unit: { runId, purpose: 'request-issue', key: e.key }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
      if (created) say(run, 'runner.request.proposed', { title: e.title, squad: e.squad });
      return { status: 'proposed' };
    }
    try {
      const responses = await door.post({ issue: run.issue.iid, key, summary, by: e.by, bodyHash: hashOf(e.body) }, commands);
      const made = prRefOf(responses[0]);
      if (made.iid === null) {
        say(run, 'runner.request.issueFailed', { title: e.title, reason: tr('main.runner.comment.noId') });
        return { status: 'failed', reason: tr('main.runner.comment.noId') };
      }
      return { status: 'created', iid: made.iid, url: made.url };
    } catch (err) {
      say(run, 'runner.request.issueFailed', { title: e.title, reason: message(err) });
      return { status: 'failed', reason: message(err) };
    }
  }

  // ---- the label of the squad ---------------------------------------------------------------------------------------------------

  async function squadRouted(runId: string, e: { squad: string; label: string; by: string; autonomous: boolean }): Promise<void> {
    const label = e.label.trim();
    if (!label) return;
    const run = need(runId);
    // A documentation run has no issue to label with a squad.
    if (run.docs) return;
    if (door.refusal()) return say(run, 'runner.squad.refused', { label });
    const provider = door.provider();
    if (!provider) return;
    const { issue } = projects(run);
    const commands = await provider.planWrite({ op: 'setIssueLabels', project: issue, iid: run.issue.iid, add: [label], remove: [] });
    if (!commands.length) return;
    const key = `squad:${runId}:${e.squad}`;
    const summary = tr('main.runner.squad.summary', { label, squad: e.squad });
    if (!e.autonomous) {
      const created = door.propose({ key, issue: run.issue.iid, issueTitle: run.issue.title, summary, unit: { runId, purpose: 'squad', squad: e.squad }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
      if (created) say(run, 'runner.squad.proposed', { label });
      return;
    }
    try {
      await door.post({ issue: run.issue.iid, key, summary, by: e.by }, commands);
      say(run, 'runner.squad.set', { label });
    } catch (err) {
      say(run, 'runner.squad.failed', { label, reason: message(err) });
    }
  }

  // ---- a release run -----------------------------------------------------------------------------------------------------------------
  // A release run has no issue: it has a version. Its comments go to a tracking issue "Release X.Y.Z" (made, or adopted when one is open with that title); the
  // steps of the release are asked through the `ReleaseAction` tool and leave the machine only through the door, a push never by itself; and what the host says
  // (the pull requests aimed at the branch, the release a tag was published as) is read here and nowhere else.

  /** The agent that speaks for the release (the first work stage's), and whether it runs by itself: what decides the tracking issue and the app's own comments. */
  const releaseAgentOf = (run: Run): { by: string; autonomous: boolean } => {
    const config = deps.config();
    const stage = flowOfRun(run, config).find((s) => s.type === 'work' && s.agent);
    const agent = stage ? config.agents.team.find((a) => a.id === stage.agent) : undefined;
    return { by: agent?.id ?? 'app', autonomous: !!agent && autonomousOf(config, agent) };
  };

  const releaseRepos = (repo: string): { repo: string; issue: string } => {
    const env = deps.env();
    return { repo: env.repos.find((r) => r.id === repo)?.projectPath || env.issueProject, issue: env.issueProject };
  };

  async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    return out;
  }

  const checksPass = (ci: { status: string } | null): boolean => !ci || ci.status === 'success' || ci.status === 'skipped';

  /** The pull requests aimed at the release branch (open and merged), with approvals for the open ones, and the open issues of the milestone that none of them carries. */
  async function readActivities(provider: VcsProvider, where: { repo: string; issue: string }, version: string): Promise<{ activities: ReleaseActivity[]; milestone: MilestoneIssue[] }> {
    const listed = await provider.listMrsByTarget(where.repo, releaseBranchOf(version), { limit: 100 });
    const mrs = await inChunks(listed, 5, async (m) => (m.state === 'open' ? provider.getMr(where.repo, m.iid, { approvals: true }).catch(() => m) : m));
    // The only maintainer's own pull requests are ready on their "sim": the account is read only when the workspace says so, and one that cannot be read makes none ready.
    const me = soleMaintainerOf(deps.config().runner) && mrs.some((m) => m.state === 'open') ? await provider.currentUser().then((u) => u.username.trim().toLowerCase(), () => '') : '';
    const activities = mrs
      .map((m): ReleaseActivity => {
        const approved = m.state === 'merged' || (m.approvals?.approved === true && !m.draft && checksPass(m.ci));
        // approvals null: the detail read failed, and nothing is known of the reviews
        const selfReview = !approved && !!me && m.state === 'open' && m.author.trim().toLowerCase() === me && !!m.approvals && !m.approvals.changesRequestedBy.length && !m.draft && checksPass(m.ci);
        return { pr: m.iid, title: m.title, url: m.webUrl, head: m.sha, state: m.state === 'merged' ? 'merged' : 'open', approved, ...(selfReview ? { selfReview } : {}), issue: m.issueRefs[0] ?? null };
      })
      .sort((a, b) => a.pr - b.pr);
    let milestone: MilestoneIssue[] = [];
    try {
      if (provider.caps.issues) {
        const carried = new Set(activities.map((a) => a.issue));
        milestone = (await provider.listIssues({ project: where.issue, scope: 'all', limit: 100 }))
          .filter((i) => i.state === 'open' && i.milestone?.trim() === version && !carried.has(i.iid))
          .map((i) => ({ iid: i.iid, title: i.title, url: i.webUrl }));
      }
    } catch (e) {
      console.error('[runner] could not read the milestone of a release', message(e));
    }
    return { activities, milestone };
  }

  async function releaseBrief(i: { version: string; repo: string; branch: BranchState; from: string | null }): Promise<{ brief: ReleaseBrief; text: string }> {
    const empty: ReleaseBrief = { version: i.version, from: i.from, branch: i.branch, activities: [], milestone: [], read: false };
    const provider = door.provider();
    let brief = empty;
    if (provider) {
      try {
        brief = { ...empty, ...(await readActivities(provider, releaseRepos(i.repo), i.version)), read: true };
      } catch (e) {
        console.error('[runner] could not read what a release is made of', message(e));
      }
    }
    const { issue } = releaseRepos(i.repo);
    return { brief, text: releaseRecord(brief, lang(), (n) => (provider ? provider.issueUrl(issue, n) : null), crMarkOf(provider?.kind ?? null)) };
  }

  const issueLink = (provider: VcsProvider, run: Run) => (n: number): string | null => provider.issueUrl(projects(run).issue, n);

  /** A comment the app writes itself on the tracking issue, through a template of the cycle: it is a draft until the issue exists, and edited in place after. */
  async function appComment(runId: string, e: { key: string; template: string; body: string }): Promise<void> {
    const config = deps.config();
    const tpl = config.devCycle.comments[e.template];
    if (!tpl) return;
    const run = need(runId);
    const marker = markerOf(run.id, e.key);
    const content: StageComment = { sections: [{ heading: '', body: e.body }], technical: '' };
    const rendered = renderComment(tpl, { language: lang(), ref: run.issue.ref, stage: '' }, content, { marker });
    const checked = checkComment(rendered.body, { ...checkOptions(run, config), status: rendered.status, marker, technicalDetail: false });
    const agent = releaseAgentOf(run);
    await deliver(runId, { key: e.key, stage: e.key, kinds: ['post'], target: 'issue', body: checked.body, headline: rendered.status, title: titleOf(tpl), problems: checked.problems, by: agent.by, autonomous: agent.autonomous, announce: false });
  }

  /** The template a record key of the run is written with: the key of a stage is the template's, a beta's comment has its own. */
  const templateKeyOf = (key: string): string => (/^beta-\d+$/.test(key) ? 'beta-published' : key);

  /** The comments that were written before the tracking issue existed go out now. */
  async function flushTracking(runId: string): Promise<void> {
    const run = deps.runs.get(runId);
    if (!run?.subject?.tracking) return;
    const config = deps.config();
    for (const [key, rec] of Object.entries(run.comments)) {
      if (rec.status !== 'draft' || rec.target !== 'issue' || !rec.body) continue;
      const tpl = config.devCycle.comments[templateKeyOf(key)];
      const marker = markerOf(run.id, key);
      const checked = checkComment(rec.body, { ...checkOptions(run, config), status: rec.headline ?? '', marker, technicalDetail: tpl?.technicalDetail ?? true });
      const kinds: ForumMessage['kind'][] = key.startsWith('decision-') ? ['decision'] : key.startsWith('question-') ? ['question'] : ['post'];
      const app = !run.stages.some((s) => s.stage === key);
      await deliver(runId, { key, stage: key, kinds, target: 'issue', body: checked.body, headline: rec.headline ?? '', title: rec.title ?? key, problems: checked.problems, by: app ? releaseAgentOf(run).by : stageAgent(run, key), autonomous: app ? releaseAgentOf(run).autonomous : stageAutonomy(run, key), announce: false });
    }
  }

  /** Reads the activities again: the run keeps the list, and the comment of the tracking issue that shows it is edited when it says something new. */
  async function refreshActivities(runId: string): Promise<void> {
    const run = need(runId);
    if (!run.subject) return;
    const provider = door.provider();
    if (!provider) return;
    let read: { activities: ReleaseActivity[]; milestone: MilestoneIssue[] };
    try {
      read = await readActivities(provider, projects(run), run.subject.version);
    } catch (e) {
      console.error('[runner] could not read the activities of a release', runId, message(e));
      return;
    }
    if (JSON.stringify(read.activities) !== JSON.stringify(run.subject.activities)) moveRun(d, runId, (r) => recordSubject(r, { activities: read.activities }, now()));
    await appComment(runId, { key: 'activities', template: 'activities', body: activitiesText(run.subject.version, read.activities, read.milestone, lang(), issueLink(provider, run), crMarkOf(provider.kind)) });
  }

  /** The tracking issue exists: the run knows where it is, the drafts that waited go out, and the activities are listed on it. */
  async function trackingKnown(runId: string, tracking: { iid: number; url: string | null }): Promise<void> {
    const run = need(runId);
    if (!run.subject || run.subject.tracking) return;
    moveRun(d, runId, (r) => recordSubject(r, { tracking: { iid: tracking.iid, url: tracking.url } }, now()));
    await flushTracking(runId);
    await refreshActivities(runId);
  }

  /** The issue "Release X.Y.Z": adopted when one is open with that title, else made through the door (by itself for an autonomous agent, as a proposal otherwise). */
  async function ensureTracking(runId: string): Promise<void> {
    const run = need(runId);
    if (!run.subject || run.subject.tracking) return;
    if (door.refusal()) return say(run, 'runner.release.trackingRefused');
    const provider = door.provider();
    if (!provider) return say(run, 'runner.release.trackingNoHost');
    const { issue: project } = projects(run);
    const title = releaseTitle(run.subject.version);
    try {
      // An open issue with the title is taken only when it is the person's own (its author is the user the app acts as) or carries the label that names this version (the
      // cycle's `releaseLabelPattern`): somebody else's issue of that title is not where a release reports, and a new one is made.
      const same = (await provider.listIssues({ project, scope: 'all', limit: 100 })).filter((i) => i.state === 'open' && i.title.trim().toLowerCase() === title.toLowerCase());
      const me = await provider.currentUser().catch(() => null);
      let pattern: RegExp | null = null;
      try {
        pattern = new RegExp(deps.config().devCycle.releaseLabelPattern, 'i');
      } catch {
        pattern = null;
      }
      const version = run.subject.version;
      const ours = (i: (typeof same)[number]): boolean => (!!me && !!i.author && i.author.toLowerCase() === me.username.toLowerCase()) || i.labels.some((l) => pattern?.exec(l)?.[1] === version);
      const found = same.find(ours);
      for (const other of same.filter((i) => !ours(i))) say(run, 'runner.release.trackingNotAdopted', { url: other.webUrl, author: other.author ?? '—' });
      if (found) {
        say(run, 'runner.release.trackingAdopted', { url: found.webUrl });
        return trackingKnown(runId, { iid: found.iid, url: found.webUrl || null });
      }
    } catch (e) {
      return say(run, 'runner.release.trackingFailed', { reason: message(e) });
    }
    const body = tr('main.runner.release.trackingBody', { version: run.subject.version });
    const key = `release:${runId}:tracking`;
    const summary = tr('main.runner.release.summary.tracking', { version: run.subject.version });
    const who = releaseAgentOf(run);
    try {
      const commands = await provider.planWrite({ op: 'createIssue', project, title, body, labels: [] });
      if (!who.autonomous) {
        const created = door.propose({ key, issue: 0, issueTitle: run.issue.title, summary, detail: body, unit: { runId, purpose: 'release-tracking' }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
        if (created) say(run, 'runner.release.trackingProposed', { title });
        return;
      }
      const responses = await door.post({ issue: 0, key, summary, by: who.by, bodyHash: hashOf(body) }, commands);
      const made = prRefOf(responses[0]);
      if (made.iid === null) return say(run, 'runner.release.trackingFailed', { reason: tr('main.runner.comment.noId') });
      say(run, 'runner.release.trackingCreated', { url: made.url ?? '' });
      await trackingKnown(runId, { iid: made.iid, url: made.url });
    } catch (e) {
      say(run, 'runner.release.trackingFailed', { reason: message(e) });
    }
  }

  /** How many betas of one version the wait looks for on the host. */
  const MAX_BETAS = 30;

  const stepKey = (u: ReleaseUnit): string => [u.op, u.pr, u.branch, u.channel, u.from].filter((x) => x !== undefined).join(':');

  function stepSummary(u: ReleaseUnit): string {
    const p = { version: u.version, pr: u.pr ?? '', tag: u.from ?? '' };
    if (u.op === 'open') return tr(u.from ? 'main.runner.release.summary.open.from' : 'main.runner.release.summary.open', p);
    if (u.op === 'push-branch') return tr(u.branch === 'main' ? 'main.runner.release.summary.push-branch.main' : 'main.runner.release.summary.push-branch', p);
    if (u.op === 'push-tag') return tr(`main.runner.release.summary.push-tag.${u.channel ?? 'stable'}`, p);
    return tr(`main.runner.release.summary.${u.op}`, p);
  }

  /**
   * One step of the release, asked by an agent's tool call. The answer is plain text for the model. A push always waits in Actions for a "sim"; a local step runs by itself
   * only when the agent that asked does (audited, as that agent) and waits in Actions otherwise. The unit is judged here and again when it runs.
   */
  async function releaseStep(runId: string, input: unknown, who: { by: string; autonomous: boolean; stage: string; attempt: number }): Promise<string> {
    const run = need(runId);
    if (!run.subject) return 'This run is not a release: there is nothing to ask for.';
    let unit: ReleaseUnit;
    try {
      unit = parseReleaseUnit({ ...rec(input), runId });
    } catch (e) {
      say(run, 'runner.release.stepRefused', { reason: message(e) }, who.stage);
      return `Refused, nothing was done: ${message(e)}.`;
    }
    if (unit.version !== run.subject.version) {
      say(run, 'runner.release.stepRefused', { reason: `version ${unit.version}` }, who.stage);
      return `Refused, nothing was done: this run releases ${run.subject.version}, not ${unit.version}.`;
    }
    const summary = stepSummary(unit);
    // Each time a stage runs (the person may send it back for another beta) is its own step: the proposal of an earlier attempt that was carried out is not this one.
    const key = `release:${runId}:${who.stage}:${who.attempt}:${stepKey(unit)}`;
    // A push, a beta and a stable wait for the person whatever the agent's autonomy (D6, D18); `open` and `merge-pr` follow it, except a merge for an only maintainer,
    // whose "sim" is the review.
    const waits = releaseWaits(unit.op, soleMaintainerOf(deps.config().runner));
    if (waits || !who.autonomous) {
      const created = door.proposeRelease({ key, issue: trackIid(run), issueTitle: run.issue.title, summary, unit, group: `${runId}:${who.stage}:${who.attempt}`, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } });
      if (created) say(run, waits ? (alwaysWaits(unit.op) ? 'runner.release.alwaysWaits' : 'runner.release.soleMaintainerWaits') : 'runner.release.proposed', { summary }, who.stage);
      return created ? `Waiting for the person: "${summary}" is in Actions and happens when they say yes. Nothing was done yet.` : `Already waiting in Actions (or already done): "${summary}".`;
    }
    try {
      const out = await door.release({ issue: trackIid(run), key, summary, by: who.by }, unit);
      say(run, 'runner.release.done', { summary }, who.stage);
      await refreshActivities(runId).catch(() => undefined);
      return `Done: ${summary}.\n${out.slice(-1500)}`;
    } catch (e) {
      say(run, 'runner.release.failed', { summary, reason: message(e) }, who.stage);
      return `Did not happen: ${summary}. ${message(e)}`;
    }
  }

  async function releaseStarted(runId: string, e: { branchExists: boolean }): Promise<void> {
    const run = need(runId);
    if (!run.subject) return;
    await ensureTracking(runId);
    const who = releaseAgentOf(run);
    if (!e.branchExists) await releaseStep(runId, { op: 'open', version: run.subject.version, ...(run.subject.from ? { from: run.subject.from } : {}) }, { by: who.by, autonomous: who.autonomous, stage: 'start', attempt: 1 });
    await refreshActivities(runId);
  }

  /** A step of the release that waited in Actions was carried out. */
  async function releaseStepDone(a: ReleaseAction): Promise<void> {
    const runId = String(a.unit?.runId ?? '');
    const run = deps.runs.get(runId);
    if (!run?.subject) return;
    // A push that found the remote already holding what it would send moved nothing on the host: the thread says so, and the waits for the host go on waiting.
    if (a.nothingSent) say(run, 'runner.release.nothingSent', { summary: a.summary ?? '', detail: a.output ?? '' });
    else say(run, 'runner.release.stepDone', { summary: a.summary ?? '' });
    await refreshActivities(runId);
  }

  /** A step of the release that the person said yes to was refused before it ran: one it needs, asked in the same stage, is not done yet. */
  async function releaseStepRefused(a: ReleaseAction, reason: string): Promise<void> {
    const run = deps.runs.get(String(a.unit?.runId ?? ''));
    if (!run?.subject || a.kind !== 'release-git') return;
    say(run, 'runner.release.stepWaits', { reason });
  }

  /** The tracking issue a proposal made: the run learns where it is. */
  async function trackingMade(runId: string, responses: unknown[]): Promise<void> {
    const run = need(runId);
    const made = prRefOf(responses[0]);
    if (made.iid === null) return say(run, 'runner.release.trackingFailed', { reason: tr('main.runner.comment.noId') });
    say(run, 'runner.release.trackingCreated', { url: made.url ?? '' });
    await trackingKnown(runId, { iid: made.iid, url: made.url });
  }

  /** The release is published: the tracking issue is closed (by itself for an autonomous agent, as a proposal otherwise). */
  async function closeTracking(runId: string): Promise<void> {
    const run = need(runId);
    const tracking = run.subject?.tracking;
    if (!run.subject || !tracking || tracking.closed) return;
    if (door.refusal()) return;
    const provider = door.provider();
    if (!provider) return;
    const { issue: project } = projects(run);
    const key = `release:${runId}:close`;
    const summary = tr('main.runner.release.summary.close', { version: run.subject.version });
    const commands = await provider.planWrite({ op: 'closeIssue', project, iid: tracking.iid });
    const who = releaseAgentOf(run);
    if (!who.autonomous) {
      const created = door.propose({ key, issue: tracking.iid, issueTitle: run.issue.title, summary, unit: { runId, purpose: 'release-close' }, notify: { title: tr('main.runner.comment.proposalTitle', { ref: run.issue.ref }), body: summary } }, commands);
      if (created) say(run, 'runner.release.closeProposed', { summary });
      return;
    }
    try {
      await door.post({ issue: tracking.iid, key, summary, by: who.by }, commands);
      moveRun(d, runId, (r) => recordSubject(r, { tracking: { ...tracking, closed: true } }, now()));
      say(run, 'runner.release.closed', { url: tracking.url ?? '' });
    } catch (e) {
      say(run, 'runner.release.closeFailed', { reason: message(e) });
    }
  }

  const betaTagsOf = async (run: Run): Promise<string[]> => {
    const version = run.subject?.version ?? '';
    const names = (await deps.localTags?.(run)) ?? [];
    return names.filter((n) => new RegExp(`^v${version.replace(/\./g, '\\.')}-beta\\.[1-9][0-9]*$`).test(n)).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
  };

  /** The release the host published for a tag, or null when it is a draft, unknown or unreadable. */
  const publishedRelease = async (provider: VcsProvider, run: Run, tag: string) => {
    const rel = await provider.getRelease(projects(run).repo, tag).catch(() => null);
    return rel && !rel.draft && rel.publishedAt ? rel : null;
  };

  const blockingLabelOf = (run: Run, wait?: { label?: string }): string => {
    const stage = flowOfRun(run, deps.config()).find((s) => s.waitsFor?.kind === 'beta-age');
    return (wait?.label ?? stage?.waitsFor?.label ?? '').trim() || 'beta-blocker';
  };

  /**
   * The betas of the version: the highest number there is (the clone's tags and what the host has published, the host asked tag by tag from beta.1 on, so a beta cut elsewhere
   * counts too) and the published release of each beta the host shows.
   */
  async function betasOf(run: Run, provider: VcsProvider): Promise<{ latest: number; published: Map<number, NonNullable<Awaited<ReturnType<typeof publishedRelease>>>> }> {
    const version = run.subject?.version ?? '';
    const local = await betaTagsOf(run);
    const localMax = local.length ? Number(local[local.length - 1].split('.').pop()) : 0;
    const published = new Map<number, NonNullable<Awaited<ReturnType<typeof publishedRelease>>>>();
    for (let n = 1; n <= MAX_BETAS; n++) {
      const rel = await publishedRelease(provider, run, `v${version}-beta.${n}`);
      if (rel) published.set(n, rel);
      else if (n > localMax) break;
    }
    return { latest: Math.max(localMax, ...published.keys()), published };
  }

  async function releaseTick(runId: string): Promise<void> {
    const run = deps.runs.get(runId);
    if (!run?.subject || run.status === 'cancelled' || run.subject.tracking?.closed) return;
    const provider = door.provider();
    if (!provider) return;
    // The tracking issue was not made at the start (the host was down, or the proposal was skipped): it is looked for, and made, again.
    if (!run.subject.tracking) await ensureTracking(runId);
    await refreshActivities(runId);
    await flushTracking(runId);
    for (const [n, rel] of (await betasOf(run, provider)).published) {
      if (need(runId).comments[`beta-${n}`]?.status === 'published') continue;
      await appComment(runId, { key: `beta-${n}`, template: 'beta-published', body: `${tr('main.runner.release.betaLine', { tag: `v${run.subject.version}-beta.${n}`, url: rel.webUrl })}\n\n${tr('main.runner.release.betaWait', { label: blockingLabelOf(run) })}` });
    }
    const stable = await publishedRelease(provider, run, releaseTagOf(run.subject.version));
    if (stable && !stable.prerelease) {
      await appComment(runId, { key: 'stable-published', template: 'stable-published', body: tr('main.runner.release.stableLine', { version: run.subject.version, url: stable.webUrl }) });
      await closeTracking(runId);
    }
  }

  /** Whether no pull request is open against the release branch any more: what a wait for `release-approved` ends on. */
  async function releaseMerged(run: Run, provider: VcsProvider): Promise<boolean> {
    if (!run.subject) return false;
    const list = await provider.listMrsByTarget(projects(run).repo, releaseBranchOf(run.subject.version), { limit: 100 });
    return !list.some((m) => m.state === 'open');
  }

  /** Whether the latest beta has been published for `minutes` and no issue with the blocking label is open: what a wait for `beta-age` ends on. */
  async function betaAged(run: Run, provider: VcsProvider, w: WaitState): Promise<boolean> {
    if (!run.subject || !w.minutes) return false;
    const { latest, published } = await betasOf(run, provider);
    // The latest beta there is must be the one that is out: a newer one the host does not show yet starts the wait over.
    const rel = latest ? published.get(latest) : undefined;
    if (!rel?.publishedAt || Date.parse(rel.publishedAt) + w.minutes * 60_000 > (deps.now?.() ?? new Date()).getTime()) return false;
    // The blocking report is an open issue with the label: where the host cannot say (no labels on issues), nothing is known, and the wait goes on.
    const blocking = await provider.listIssues({ project: projects(run).issue, scope: 'labels', labels: [blockingLabelOf(run, w)], limit: 20 });
    return !blocking.some((i) => i.state === 'open');
  }

  /**
   * Whether the latest beta of the version is on the host: its tag on the remote (not only in this clone) and its pre-release published. What a wait for `beta-out` ends on;
   * a cut whose push sent nothing, or a tag that is still the previous beta's, keeps it waiting.
   */
  async function betaOut(run: Run, provider: VcsProvider): Promise<boolean> {
    if (!run.subject) return false;
    const { latest, published } = await betasOf(run, provider);
    if (!latest || !published.has(latest)) return false;
    const remote = await deps.remoteRelease?.(run);
    return !!remote?.tags[`v${run.subject.version}-beta.${latest}`];
  }

  /** Whether the stable is on the host: the `vX.Y.Z` tag on the remote, and its commit on the remote's main. What a wait for `stable-out` ends on. */
  async function stableOut(run: Run): Promise<boolean> {
    if (!run.subject) return false;
    const remote = await deps.remoteRelease?.(run);
    return !!remote?.tags[releaseTagOf(run.subject.version)] && remote.stableOnMain;
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
        await sealSeen(runId);
        if (end.kind === 'review') await review(runId, end);
        else await stageComment(runId, end);
        if (end.output.priority) await proposePriority(runId, end);
        if (end.kind === 'work' && pushesAt(deps.config(), flowOfRun(need(runId), deps.config()), end.stage.id)) await pushStage(runId, end);
      }),
    asked: (runId, e) => guarded(runId, () => question(runId, e)),
    gateDecided: (runId, e) => guarded(runId, () => gate(runId, e)),
    actionDone: (a, responses) => guarded(String(a.unit?.runId ?? ''), () => done(a, responses)),
    actionRefused: (a, reason) => guarded(String(a.unit?.runId ?? ''), () => releaseStepRefused(a, reason)),
    flushReviews: (runId) => guarded(runId, () => flush(runId)),
    waitOver,
    undo: (runId, key) => undo(runId, key),
    stageEntered: (runId, e) => guarded(runId, () => stageEntered(runId, e)),
    squadRouted: (runId, e) => guarded(runId, () => squadRouted(runId, e)),
    requestIssue: (runId, e) => requestIssue(runId, e).catch((err) => ({ status: 'failed' as const, reason: message(err) })),
    releaseBrief,
    releaseStarted: (runId, e) => guarded(runId, () => releaseStarted(runId, e)),
    releaseStep: (runId, input, who) => releaseStep(runId, input, who).catch((e) => `Did not happen: ${message(e)}`),
    releaseTick: (runId) => guarded(runId, () => releaseTick(runId)),
  };
}

