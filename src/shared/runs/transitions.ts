import type { ArtifactRef, ForumDraft } from '../forum';
import { t } from '../i18n';
import { flowProblems, producerOf } from './flow';
import { MAX_REVIEW_ROUNDS, RUN_VERSION, isTerminal, type CommentRecord, type CommentStatus, type CommentTarget, type FlowStage, type HistoryEntry, type HistoryType, type PendingResult, type QaRecord, type ReviewRecord, type Run, type RunIssue, type StageRecord, type Transition } from './types';

// Every move of a run is a pure function: (run, flow, input, at) -> { run, messages }. The input run is never changed. `messages` are what the
// forum is to record about the move, in order; the caller saves the run first and then appends them. `at` is an ISO time.

export const RUN_ERROR_CODES = ['no-flow', 'no-agent', 'wrong-state', 'empty-reason', 'empty-text', 'duplicate', 'unknown-stage', 'not-active', 'unknown-run', 'newer-version', 'invalid', 'unknown-comment'] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(t(`main.runs.error.${code}`, params));
    this.name = 'RunError';
  }
}

const HISTORY_MAX = 1000;
const person = { type: 'person' } as const;
const app = { type: 'app' } as const;
const agent = (id: string) => ({ type: 'agent', id }) as const;
const refsOf = (names: string[]): ArtifactRef[] => names.map((path) => ({ path }));
const unique = (list: string[]): string[] => [...new Set(list)];

function log(run: Run, at: string, type: HistoryType, stage: string | null, by: string, detail: string | null = null): void {
  const entry: HistoryEntry = { at, type, stage, by, detail };
  run.history.push(entry);
  if (run.history.length > HISTORY_MAX) run.history.splice(1, run.history.length - HISTORY_MAX);
}

const record = (run: Run, stage: string): StageRecord | undefined => run.stages.find((r) => r.stage === stage);

function need(run: Run, ...statuses: Run['status'][]): void {
  if (!statuses.includes(run.status)) throw new RunError('wrong-state', { status: run.status });
}

function finishStage(run: Run, at: string, status: StageRecord['status'], artifacts: string[] = []): StageRecord {
  const r = record(run, run.stage) as StageRecord;
  r.status = status;
  r.endedAt = at;
  r.artifacts = unique([...r.artifacts, ...artifacts]);
  return r;
}

/**
 * The run enters a stage: a gate waits for the person, the last stage ends the run, a stage with no agent fails (and says so), any other starts
 * its agent. Entering a stage again (after a rejection, a hand back, a restart or a retry) is a new attempt.
 */
function enter(run: Run, flow: FlowStage[], stageId: string, at: string, messages: ForumDraft[], start = false): void {
  const i = flow.findIndex((s) => s.id === stageId);
  if (i < 0) throw new RunError('unknown-stage', { stage: stageId });
  const stage = flow[i];
  const last = i === flow.length - 1;
  let rec = record(run, stageId);
  if (!rec) {
    rec = { stage: stageId, agent: null, status: 'running', artifacts: [], startedAt: null, endedAt: null, attempts: 0, autonomous: false };
    run.stages.push(rec);
  }
  rec.agent = stage.agent;
  rec.autonomous = stage.autonomous;
  rec.attempts += 1;
  rec.startedAt = at;
  rec.endedAt = null;
  run.stage = stageId;
  run.error = null;
  const base = { author: app, stage: stageId } as const;
  if (stage.human) {
    run.status = 'gate';
    rec.status = 'waiting';
    log(run, at, 'stage-started', stageId, 'app');
    messages.push({ ...base, kind: 'system', code: 'run.stage.gate', params: { stage: stage.label } });
  } else if (last) {
    run.status = 'done';
    rec.status = 'done';
    rec.endedAt = at;
    log(run, at, 'completed', stageId, 'app');
    messages.push({ ...base, kind: 'system', code: 'run.completed', params: { stage: stage.label } });
  } else if (!stage.agent) {
    run.status = 'failed';
    rec.status = 'failed';
    rec.endedAt = at;
    run.error = { code: 'no-agent', stage: stageId, detail: null };
    log(run, at, 'failed', stageId, 'app', 'no-agent');
    messages.push({ ...base, kind: 'system', code: 'run.stage.noAgent', params: { stage: stage.label } });
  } else if (!stage.autonomous && !start) {
    // The agent does not run by itself: the stage is entered and waits for the person to start it.
    run.status = 'to-start';
    rec.status = 'waiting';
    rec.startedAt = null;
    log(run, at, 'stage-waiting', stageId, 'app', stage.agent);
    messages.push({ ...base, kind: 'system', code: 'run.stage.waitStart', params: { stage: stage.label, agent: stage.agent } });
  } else {
    run.status = 'working';
    rec.status = 'running';
    log(run, at, 'stage-started', stageId, 'app', stage.agent);
    messages.push({ ...base, kind: 'system', code: 'run.stage.started', params: { stage: stage.label, agent: stage.agent } });
  }
}

const next = (flow: FlowStage[], stageId: string): FlowStage => {
  const i = flow.findIndex((s) => s.id === stageId);
  if (i < 0 || i >= flow.length - 1) throw new RunError('unknown-stage', { stage: stageId });
  return flow[i + 1];
};

const labelOf = (flow: FlowStage[], stageId: string): string => flow.find((s) => s.id === stageId)?.label ?? stageId;
const clone = (run: Run, at: string): Run => ({ ...structuredClone(run), updatedAt: at });

export interface StartInput {
  id: string;
  issue: RunIssue;
  repo: string;
  branch: string;
  worktree: string;
  cycleFolder: string;
  cycleId: string;
  /** The commit the branch was cut from. */
  base?: string | null;
}

/** A run is created at the first stage. It does not start when the flow is empty or a stage that must have an agent has none: nothing is created then. */
export function startRun(input: StartInput, flow: FlowStage[], at: string): Transition {
  const problems = flowProblems(flow);
  if (problems.length) {
    const [p] = problems;
    throw new RunError(p.code === 'empty' ? 'no-flow' : 'no-agent', { stage: p.stage ? labelOf(flow, p.stage) : '' });
  }
  const run: Run = {
    version: RUN_VERSION,
    rev: 0,
    id: input.id,
    issue: structuredClone(input.issue),
    repo: input.repo,
    branch: input.branch,
    worktree: input.worktree,
    cycleFolder: input.cycleFolder,
    cycleId: input.cycleId,
    status: 'working',
    stage: flow[0].id,
    stages: [],
    question: null,
    pending: null,
    review: { rounds: 0, max: MAX_REVIEW_ROUNDS },
    error: null,
    history: [],
    comments: {},
    reviews: [],
    qa: [],
    base: input.base ?? null,
    createdAt: at,
    updatedAt: at,
  };
  log(run, at, 'started', null, 'person');
  const messages: ForumDraft[] = [{ kind: 'system', author: app, code: 'run.started', params: { issue: input.issue.ref } }];
  // The person who starts the run starts its first stage too.
  enter(run, flow, flow[0].id, at, messages, true);
  return { run, messages };
}

export interface StageDoneInput {
  /** What the agent did, for the thread. */
  summary: string;
  /** What the next one is to do. Empty: no handoff message. */
  handoff: string;
  /** Files of the cycle folder the stage wrote. */
  artifacts: string[];
}

/**
 * The working stage is finished. An autonomous agent's post and handoff go to the thread and the run enters the next stage; the result of an agent
 * that is not autonomous waits for the person to accept it (status `to-accept`) before the handoff and the next stage.
 */
export function stageDone(run: Run, flow: FlowStage[], done: StageDoneInput, at: string): Transition {
  need(run, 'working');
  const out = clone(run, at);
  const from = flow.find((s) => s.id === run.stage);
  const by = from?.agent ?? 'app';
  const post: ForumDraft = { kind: 'post', author: agent(by), text: done.summary, refs: refsOf(done.artifacts), stage: run.stage, public: true };
  if (!(record(run, run.stage) as StageRecord).autonomous) {
    park(out, { kind: 'done', by, text: '', handoff: done.handoff, toStage: null, countRound: false }, done.artifacts, at);
    return { run: out, messages: [post, waitAccept(flow, run.stage)] };
  }
  const to = next(flow, run.stage);
  finishStage(out, at, 'done', done.artifacts);
  log(out, at, 'stage-done', run.stage, by);
  const messages: ForumDraft[] = [post];
  if (done.handoff.trim()) messages.push({ kind: 'handoff', author: agent(by), text: done.handoff, to: to.human || !to.agent ? 'person' : to.agent, stage: run.stage });
  enter(out, flow, to.id, at, messages);
  return { run: out, messages };
}

// A non-autonomous agent's result is kept until the person accepts it: the stage is over for the agent, not yet for the run.
function park(out: Run, pending: PendingResult, artifacts: string[], at: string): void {
  finishStage(out, at, 'waiting', artifacts);
  out.status = 'to-accept';
  out.pending = pending;
  log(out, at, 'stage-ready', out.stage, pending.by);
}

const waitAccept = (flow: FlowStage[], stageId: string): ForumDraft => ({ kind: 'system', author: app, code: 'run.stage.waitAccept', params: { stage: labelOf(flow, stageId) }, stage: stageId });

// Sends the run back to an earlier stage with the reason as a handoff from `from` to that stage's agent. The stage it leaves is marked rejected.
// `start`: the person asked for it, so the stage starts at once even when its agent is not autonomous.
function sendBack(out: Run, flow: FlowStage[], toStage: FlowStage, from: ForumDraft['author'], text: string, at: string, messages: ForumDraft[], start: boolean): void {
  finishStage(out, at, 'rejected');
  messages.push({ kind: 'handoff', author: from, text, to: toStage.agent, stage: out.stage });
  enter(out, flow, toStage.id, at, messages, start);
}

/** The person approves the gate: the run goes on to the next stage. `note` is optional and goes in the decision. */
export function gateApprove(run: Run, flow: FlowStage[], at: string, note = ''): Transition {
  need(run, 'gate');
  const out = clone(run, at);
  finishStage(out, at, 'done');
  log(out, at, 'gate-approved', run.stage, 'person', note.trim() || null);
  const messages: ForumDraft[] = [{ kind: 'decision', author: person, code: 'gate.approved', params: { stage: labelOf(flow, run.stage) }, text: note.trim(), stage: run.stage, public: true }];
  enter(out, flow, next(flow, run.stage).id, at, messages);
  return { run: out, messages };
}

/** The person rejects the gate with a reason: the run goes back to the stage that produced the artifact, and the reason is the handoff. */
export function gateReject(run: Run, flow: FlowStage[], reason: string, at: string): Transition {
  need(run, 'gate');
  const why = reason.trim();
  if (!why) throw new RunError('empty-reason');
  const producer = producerOf(flow, run.stage);
  if (!producer) throw new RunError('unknown-stage', { stage: run.stage });
  const out = clone(run, at);
  log(out, at, 'gate-rejected', run.stage, 'person', why);
  const messages: ForumDraft[] = [{ kind: 'decision', author: person, code: 'gate.rejected', params: { stage: labelOf(flow, run.stage) }, text: why, stage: run.stage, public: true }];
  sendBack(out, flow, producer, person, why, at, messages, true);
  return { run: out, messages };
}

/** The person skips the gate with a reason: recorded as a decision, and the run goes on. */
export function gateSkip(run: Run, flow: FlowStage[], reason: string, at: string): Transition {
  need(run, 'gate');
  const why = reason.trim();
  if (!why) throw new RunError('empty-reason');
  const out = clone(run, at);
  finishStage(out, at, 'skipped');
  log(out, at, 'gate-skipped', run.stage, 'person', why);
  const messages: ForumDraft[] = [{ kind: 'decision', author: person, code: 'gate.skipped', params: { stage: labelOf(flow, run.stage) }, text: why, stage: run.stage, public: true }];
  enter(out, flow, next(flow, run.stage).id, at, messages);
  return { run: out, messages };
}

/** The working agent cannot go on without the person: the stage waits, the run shows as blocked. */
export function ask(run: Run, question: { by: string; text: string }, at: string): Transition {
  need(run, 'working');
  const text = question.text.trim();
  if (!text) throw new RunError('empty-text');
  const out = clone(run, at);
  out.status = 'question';
  out.question = { by: question.by, kind: 'agent', text, askedAt: at, stage: run.stage };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'question', run.stage, question.by, text);
  return { run: out, messages: [{ kind: 'question', author: agent(question.by), text, stage: run.stage, public: true }] };
}

/**
 * The person answers. A question from an agent resumes the same attempt of the stage. The review limit sends the run back to the stage
 * that produced the work, with the answer as the handoff and a fresh budget of review rounds.
 */
export function answer(run: Run, flow: FlowStage[], text: string, at: string): Transition {
  need(run, 'question');
  const said = text.trim();
  if (!said) throw new RunError('empty-text');
  const q = run.question;
  const out = clone(run, at);
  out.question = null;
  log(out, at, 'answer', run.stage, 'person', said);
  const messages: ForumDraft[] = [{ kind: 'answer', author: person, text: said, stage: run.stage, public: true }];
  if (q?.kind === 'review-limit') {
    const producer = producerOf(flow, run.stage);
    if (!producer) throw new RunError('unknown-stage', { stage: run.stage });
    out.review.rounds = 0;
    sendBack(out, flow, producer, person, said, at, messages, true);
  } else {
    out.status = 'working';
    (record(out, run.stage) as StageRecord).status = 'running';
  }
  return { run: out, messages };
}

// The work goes back to an earlier stage. A review pass counts toward the limit: at the limit the run stops and asks the person instead.
function applyReturn(out: Run, flow: FlowStage[], p: PendingResult, at: string, messages: ForumDraft[]): void {
  const target = flow.find((x) => x.id === p.toStage);
  if (!target) throw new RunError('unknown-stage', { stage: p.toStage ?? '' });
  if (p.countRound) {
    out.review.rounds += 1;
    if (out.review.rounds >= out.review.max) {
      out.status = 'question';
      out.question = { by: 'app', kind: 'review-limit', text: p.text, askedAt: at, stage: out.stage };
      (record(out, out.stage) as StageRecord).status = 'waiting';
      log(out, at, 'question', out.stage, 'app', 'review-limit');
      messages.push({ kind: 'question', author: app, code: 'review.limit', params: { rounds: out.review.rounds }, stage: out.stage, public: true });
      return;
    }
  }
  log(out, at, 'handback', out.stage, p.by, target.id);
  sendBack(out, flow, target, agent(p.by), p.handoff.trim() || p.text, at, messages, false);
}

// What an agent hands back is its stage's result: an autonomous agent's goes at once, the other's waits for the person to accept it.
function returnWork(run: Run, flow: FlowStage[], p: PendingResult, post: ForumDraft | null, at: string): Transition {
  const out = clone(run, at);
  const messages: ForumDraft[] = post ? [post] : [];
  if (!(record(run, run.stage) as StageRecord).autonomous) {
    park(out, p, [], at);
    messages.push(waitAccept(flow, run.stage));
  } else {
    applyReturn(out, flow, p, at, messages);
  }
  return { run: out, messages };
}

/** The agent hands the work back to an earlier stage. */
export function handBack(run: Run, flow: FlowStage[], input: { by: string; toStage: string; text: string; /** The hand back counts toward the review limit (QA that failed). */ countRound?: boolean }, at: string): Transition {
  need(run, 'working');
  const i = flow.findIndex((s) => s.id === run.stage);
  const j = flow.findIndex((s) => s.id === input.toStage);
  if (j < 0 || j >= i || flow[j].human) throw new RunError('unknown-stage', { stage: input.toStage });
  const text = input.text.trim();
  if (!text) throw new RunError('empty-text');
  return returnWork(run, flow, { kind: 'return', by: input.by, text: input.countRound ? text : '', handoff: text, toStage: input.toStage, countRound: !!input.countRound }, null, at);
}

export interface ReviewReturnInput {
  by: string;
  /** What the review found. */
  findings: string;
  /** What must change; defaults to the findings. */
  handoff?: string;
}

/**
 * The review ended with findings. With review passes left the work goes back to the stage that produced it; once the limit is reached the run
 * stops and asks the person. A reviewer that is not autonomous waits for the person to accept its findings first.
 */
export function reviewReturn(run: Run, flow: FlowStage[], input: ReviewReturnInput, at: string): Transition {
  need(run, 'working');
  const findings = input.findings.trim();
  if (!findings) throw new RunError('empty-text');
  const producer = producerOf(flow, run.stage);
  if (!producer) throw new RunError('unknown-stage', { stage: run.stage });
  const post: ForumDraft = { kind: 'post', author: agent(input.by), text: findings, stage: run.stage, public: true };
  return returnWork(run, flow, { kind: 'return', by: input.by, text: findings, handoff: input.handoff?.trim() || findings, toStage: producer.id, countRound: true }, post, at);
}

/** The person starts a stage whose agent is not autonomous. The flag counts as it is now: a change takes effect at a stage start. */
export function startStage(run: Run, flow: FlowStage[], at: string): Transition {
  need(run, 'to-start');
  const stage = flow.find((s) => s.id === run.stage);
  if (!stage?.agent) throw new RunError('no-agent', { stage: stage?.label ?? run.stage });
  const out = clone(run, at);
  const rec = record(out, run.stage) as StageRecord;
  rec.agent = stage.agent;
  rec.autonomous = stage.autonomous;
  rec.status = 'running';
  rec.startedAt = at;
  rec.endedAt = null;
  out.status = 'working';
  log(out, at, 'stage-started', run.stage, 'person', stage.agent);
  return { run: out, messages: [{ kind: 'system', author: app, code: 'run.stage.started', params: { stage: stage.label, agent: stage.agent }, stage: run.stage }] };
}

/** The person accepts the result of a non-autonomous agent: its handoff goes out and the run moves on (or the work goes back, for a return). */
export function acceptStage(run: Run, flow: FlowStage[], at: string, note = ''): Transition {
  need(run, 'to-accept');
  const p = run.pending as PendingResult;
  const out = clone(run, at);
  out.pending = null;
  log(out, at, 'stage-accepted', run.stage, 'person', note.trim() || null);
  const messages: ForumDraft[] = [{ kind: 'decision', author: person, code: 'stage.accepted', params: { stage: labelOf(flow, run.stage) }, text: note.trim(), stage: run.stage, public: true }];
  if (p.kind === 'return') {
    applyReturn(out, flow, p, at, messages);
  } else {
    const to = next(flow, run.stage);
    (record(out, run.stage) as StageRecord).status = 'done';
    if (p.handoff.trim()) messages.push({ kind: 'handoff', author: agent(p.by), text: p.handoff, to: to.human || !to.agent ? 'person' : to.agent, stage: run.stage });
    enter(out, flow, to.id, at, messages);
  }
  return { run: out, messages };
}

/** The person does not accept the result: the same stage does it again, with the note as the handoff. A note is required. */
export function returnStage(run: Run, flow: FlowStage[], note: string, at: string): Transition {
  need(run, 'to-accept');
  const why = note.trim();
  if (!why) throw new RunError('empty-reason');
  const p = run.pending as PendingResult;
  const out = clone(run, at);
  out.pending = null;
  log(out, at, 'stage-returned', run.stage, 'person', why);
  const messages: ForumDraft[] = [
    { kind: 'decision', author: person, code: 'stage.returned', params: { stage: labelOf(flow, run.stage) }, text: why, stage: run.stage, public: true },
    { kind: 'handoff', author: person, text: why, to: p.by, stage: run.stage },
  ];
  finishStage(out, at, 'rejected');
  enter(out, flow, run.stage, at, messages, true);
  return { run: out, messages };
}

/** The stage's agent failed (model error, a result nobody can read): the run waits for a retry or a cancel. */
export function stageFailed(run: Run, detail: string, at: string): Transition {
  need(run, 'working');
  const out = clone(run, at);
  finishStage(out, at, 'failed');
  out.status = 'failed';
  out.error = { code: 'stage-failed', stage: run.stage, detail: detail.trim() || null };
  log(out, at, 'failed', run.stage, 'app', out.error.detail);
  return { run: out, messages: [{ kind: 'system', author: app, code: 'run.stage.failed', params: { stage: run.stage, detail: out.error.detail ?? '—' }, stage: run.stage }] };
}

/** Another attempt at the stage that failed (or had no agent: the team may have changed since). */
export function retry(run: Run, flow: FlowStage[], at: string): Transition {
  need(run, 'failed');
  const out = clone(run, at);
  log(out, at, 'retried', run.stage, 'person');
  const messages: ForumDraft[] = [{ kind: 'system', author: app, code: 'run.stage.retried', params: { stage: labelOf(flow, run.stage) }, stage: run.stage }];
  enter(out, flow, run.stage, at, messages, true);
  return { run: out, messages };
}

/** Nothing is deleted: the worktree, the branch and the thread stay. */
export function cancel(run: Run, by: 'person' | 'app', at: string): Transition {
  if (isTerminal(run)) throw new RunError('not-active', { status: run.status });
  const out = clone(run, at);
  const rec = record(out, run.stage);
  if (rec && (rec.status === 'running' || rec.status === 'waiting' || rec.status === 'failed')) {
    rec.status = 'cancelled';
    rec.endedAt = at;
  }
  out.status = 'cancelled';
  out.question = null;
  out.pending = null;
  log(out, at, 'cancelled', run.stage, by);
  return { run: out, messages: [{ kind: 'system', author: by === 'person' ? person : app, code: 'run.cancelled', stage: run.stage }] };
}

/**
 * The app started again. A run whose agent was in the middle of a stage starts that stage over (a new attempt); a run waiting for the person,
 * a failed run and a finished one are left as they are.
 */
export function resumeAfterRestart(run: Run, flow: FlowStage[], at: string): Transition {
  if (run.status !== 'working') return { run, messages: [] };
  const out = clone(run, at);
  log(out, at, 'interrupted', run.stage, 'app');
  const messages: ForumDraft[] = [{ kind: 'system', author: app, code: 'run.stage.restarted', params: { stage: labelOf(flow, run.stage) }, stage: run.stage }];
  enter(out, flow, run.stage, at, messages, true);
  return { run: out, messages };
}

// ---- tracker comments --------------------------------------------------------------------------------------------------------------------
// A stage keeps ONE comment on the tracker and edits it in place; the run only records where that comment stands. Nothing here publishes: phase 2
// proposes and executes, then calls these to say what happened. They apply to a run in any status (the pull request comment comes after `done`).

function noteComment(run: Run, key: string, at: string, status: CommentStatus, change: (c: CommentRecord | undefined) => CommentRecord): Transition {
  const out = clone(run, at);
  out.comments[key] = change(out.comments[key]);
  log(out, at, 'comment', key, 'app', status);
  return { run: out, messages: [] };
}

const fresh = (target: CommentTarget, status: CommentStatus, at: string): CommentRecord => ({ target, noteId: null, url: null, bodyHash: null, status, updatedAt: at });

/** A body was written but nothing was asked of the person yet. */
export function recordCommentDraft(run: Run, key: string, input: { target: CommentTarget; bodyHash: string }, at: string): Transition {
  return noteComment(run, key, at, 'draft', (c) => ({ ...(c ?? fresh(input.target, 'draft', at)), target: input.target, bodyHash: input.bodyHash, status: c?.status === 'published' ? 'published' : 'draft', updatedAt: at }));
}

/** The comment (or its edit) waits in Actions for its own "yes". A comment already published keeps its note id, so the proposal is an edit. */
export function recordCommentProposal(run: Run, key: string, input: { target: CommentTarget; bodyHash: string }, at: string): Transition {
  return noteComment(run, key, at, 'proposed', (c) => ({ ...(c ?? fresh(input.target, 'proposed', at)), target: input.target, bodyHash: input.bodyHash, status: 'proposed', updatedAt: at }));
}

/** The host accepted the comment and returned its id. */
export function recordCommentPublished(run: Run, key: string, input: { target: CommentTarget; noteId: string | number; url: string | null; bodyHash: string }, at: string): Transition {
  return noteComment(run, key, at, 'published', () => ({ target: input.target, noteId: input.noteId, url: input.url, bodyHash: input.bodyHash, status: 'published', updatedAt: at }));
}

/** The published comment was edited in place: same note id, new body. Refused when there is no published comment to edit. */
export function recordCommentEdited(run: Run, key: string, input: { bodyHash: string; url?: string | null }, at: string): Transition {
  const current = run.comments[key];
  if (!current || current.noteId === null) throw new RunError('unknown-comment', { key });
  return noteComment(run, key, at, 'published', (c) => ({ ...(c as CommentRecord), bodyHash: input.bodyHash, url: input.url === undefined ? (c as CommentRecord).url : input.url, status: 'published', updatedAt: at }));
}

/** The proposal was refused or skipped (a test workspace, or the person said no). A comment already published stays published. */
export function recordCommentRefused(run: Run, key: string, target: CommentTarget, at: string): Transition {
  return noteComment(run, key, at, 'refused', (c) => ({ ...(c ?? fresh(target, 'refused', at)), status: c?.noteId !== null && c?.noteId !== undefined ? 'published' : 'refused', updatedAt: at }));
}

// ---- what the agents found --------------------------------------------------------------------------------------------------------------
// The structured result of a review or a QA pass is kept in the run, as given, so publishing it (line comments on the pull request, the stage's
// comment) is a matter of reading it back. Like the comment records, these apply in any status.

/** A review pass ended. The round number is the next one; the record is kept even when the pass approved. */
export function recordReview(run: Run, input: Omit<ReviewRecord, 'round' | 'at'>, at: string): Transition {
  const out = clone(run, at);
  const round = out.reviews.length + 1;
  out.reviews.push({ ...structuredClone(input), round, at });
  log(out, at, 'review', input.stage, input.by, `${round}: ${input.verdict}`);
  return { run: out, messages: [] };
}

/** A QA pass ended. */
export function recordQa(run: Run, input: Omit<QaRecord, 'at'>, at: string): Transition {
  const out = clone(run, at);
  out.qa.push({ ...structuredClone(input), at });
  log(out, at, 'qa', input.stage, input.by, input.scenarios.every((s) => s.result === 'pass') ? 'pass' : 'fail');
  return { run: out, messages: [] };
}
