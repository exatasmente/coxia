import type { ArtifactRef, ForumDraft } from '../forum';
import { t } from '../i18n';
import { flowProblems, producerOf, snapshotOf } from './flow';
import { RUN_VERSION, isTerminal, type CommentDetails, type CommentRecord, type CommentStatus, type CommentTarget, type FlowStage, type HistoryEntry, type HistoryType, type PendingResult, type QaRecord, type ReviewRecord, type Run, type RunIssue, type StageRecord, type Transition } from './types';

// Every move of a run is a pure function: (run, flow, input, at) -> { run, messages }. The input run is never changed. `messages` are what the
// forum is to record about the move, in order; the caller saves the run first and then appends them. `at` is an ISO time.

export const RUN_ERROR_CODES = ['no-flow', 'no-agent', 'wrong-state', 'empty-reason', 'empty-text', 'duplicate', 'unknown-stage', 'not-active', 'unknown-run', 'newer-version', 'invalid', 'unknown-comment', 'invalid-flow', 'flow-mismatch', 'not-waiting'] as const;
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
 * The run enters a stage: a gate waits for the person, a wait stage waits for its event, a stage where the run ends and that has no agent ends it, a work stage
 * with no agent fails (and says so), any other starts its agent. Entering a stage again (after a rejection, a hand back, a restart or a retry) is a new attempt.
 */
function enter(run: Run, flow: FlowStage[], stageId: string, at: string, messages: ForumDraft[], start = false): void {
  const stage = flow.find((s) => s.id === stageId);
  if (!stage) throw new RunError('unknown-stage', { stage: stageId });
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
  run.wait = null;
  const base = { author: app, stage: stageId } as const;
  if (stage.type === 'gate') {
    run.status = 'gate';
    rec.status = 'waiting';
    log(run, at, 'stage-started', stageId, 'app');
    messages.push({ ...base, kind: 'system', code: 'run.stage.gate', params: { stage: stage.label } });
  } else if (stage.type === 'wait') {
    if (!stage.waitsFor) {
      run.status = 'failed';
      rec.status = 'failed';
      rec.endedAt = at;
      run.error = { code: 'no-event', stage: stageId, detail: null };
      log(run, at, 'failed', stageId, 'app', 'no-event');
      messages.push({ ...base, kind: 'system', code: 'run.stage.noEvent', params: { stage: stage.label } });
    } else {
      run.status = 'waiting';
      rec.status = 'waiting';
      run.wait = { ...stage.waitsFor, since: at };
      log(run, at, 'wait-started', stageId, 'app', stage.waitsFor.kind);
      messages.push({ ...base, kind: 'system', code: `run.stage.wait.${stage.waitsFor.kind}`, params: { stage: stage.label, label: stage.waitsFor.label ?? '', minutes: stage.waitsFor.minutes ?? 0 } });
    }
  } else if (stage.next === null && !stage.agent) {
    // A stage that was meant to produce something and has no agent any more: the run ends there, and says that nothing was done at it.
    complete(run, stage, at, messages, stage.artifacts.length > 0);
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

// The run ends at this stage.
function complete(run: Run, stage: FlowStage, at: string, messages: ForumDraft[], unstaffed = false): void {
  const rec = record(run, stage.id) as StageRecord;
  run.status = 'done';
  rec.status = 'done';
  rec.endedAt = at;
  log(run, at, 'completed', stage.id, 'app');
  messages.push({ author: app, stage: stage.id, kind: 'system', code: unstaffed ? 'run.completed.noAgent' : 'run.completed', params: { stage: stage.label } });
}

/** The stage after `from`, or null when the run ends there. A `next` that names a stage the flow lacks is a refusal. */
const followOf = (flow: FlowStage[], from: FlowStage): FlowStage | null => {
  if (from.next === null) return null;
  const to = flow.find((s) => s.id === from.next);
  if (!to) throw new RunError('unknown-stage', { stage: from.next });
  return to;
};

const stageOf = (flow: FlowStage[], stageId: string): FlowStage => {
  const s = flow.find((x) => x.id === stageId);
  if (!s) throw new RunError('unknown-stage', { stage: stageId });
  return s;
};

// The run goes on from a stage that has been finished: to the stage after it, or to its end.
function advance(out: Run, flow: FlowStage[], from: FlowStage, at: string, messages: ForumDraft[]): void {
  const to = followOf(flow, from);
  if (to) enter(out, flow, to.id, at, messages);
  else complete(out, from, at, messages);
}

/** Who a handoff to `to` goes to: its agent, or the person when the stage is not one an agent works. */
const handoffTo = (to: FlowStage | null): string => (!to || to.type !== 'work' || !to.agent ? 'person' : to.agent);

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

/** What keeps a run from starting: an empty flow, or a stage that must have an agent and has none. Throws the refusal `startRun` gives. */
export function assertStartable(flow: FlowStage[]): void {
  const [problem] = flowProblems(flow);
  if (problem) throw new RunError(problem.code === 'empty' ? 'no-flow' : 'no-agent', { stage: problem.stage ? labelOf(flow, problem.stage) : '' });
}

/** A run is created at the first stage. It does not start when the flow is empty or a stage that must have an agent has none: nothing is created then. */
export function startRun(input: StartInput, flow: FlowStage[], at: string): Transition {
  assertStartable(flow);
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
    returns: {},
    wait: null,
    flow: snapshotOf(flow),
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
  const to = followOf(flow, stageOf(flow, run.stage));
  finishStage(out, at, 'done', done.artifacts);
  log(out, at, 'stage-done', run.stage, by);
  const messages: ForumDraft[] = [post];
  if (done.handoff.trim() && to) messages.push({ kind: 'handoff', author: agent(by), text: done.handoff, to: handoffTo(to), stage: run.stage });
  advance(out, flow, stageOf(flow, run.stage), at, messages);
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
  advance(out, flow, stageOf(flow, run.stage), at, messages);
  return { run: out, messages };
}

/** The person rejects the gate with a reason: the run goes back to the stage that produced the artifact, and the reason is the handoff. */
export function gateReject(run: Run, flow: FlowStage[], reason: string, at: string): Transition {
  need(run, 'gate');
  const why = reason.trim();
  if (!why) throw new RunError('empty-reason');
  const producer = flow.find((s) => s.id === stageOf(flow, run.stage).returnsTo);
  if (!producer || producer.type !== 'work') throw new RunError('unknown-stage', { stage: run.stage });
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
  advance(out, flow, stageOf(flow, run.stage), at, messages);
  return { run: out, messages };
}

/** The working agent cannot go on without the person: the stage waits, the run shows as blocked. */
export function ask(run: Run, question: { by: string; text: string; /** The agent the asker turns to; absent or null: the person. */ holder?: string | null }, at: string): Transition {
  need(run, 'working');
  const text = question.text.trim();
  if (!text) throw new RunError('empty-text');
  const holder = question.holder || null;
  const out = clone(run, at);
  out.status = 'question';
  out.question = { by: question.by, holder, hops: 0, kind: 'agent', text, askedAt: at, stage: run.stage };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'question', run.stage, question.by, text);
  // A question that goes to another agent first is the team talking: it stays in the thread and is not a public record until it reaches the person.
  return { run: out, messages: [{ kind: 'question', author: agent(question.by), text, to: holder, stage: run.stage, public: holder === null }] };
}

/**
 * The agent a question is with cannot answer it (or it is not its to answer): it goes on to the next agent, or to the person, with the reason said in the thread.
 * `to` null: the person. Every step is a message, so the thread shows who asked whom and why it reached whoever finally answers.
 */
export function passQuestion(run: Run, input: { from: string; to: string | null; text: string; reason: string }, at: string): Transition {
  need(run, 'question');
  const q = run.question;
  if (!q || q.kind !== 'agent' || (q.holder ?? null) !== input.from) throw new RunError('wrong-state', { status: run.status });
  const out = clone(run, at);
  const text = input.text.trim() || q.text;
  const hops = (q.hops ?? 0) + 1;
  out.question = { ...(out.question as NonNullable<Run['question']>), holder: input.to, hops, text };
  log(out, at, 'question-passed', run.stage, input.from, input.to ?? 'person');
  const messages: ForumDraft[] = [];
  if (input.reason.trim()) messages.push({ kind: 'post', author: agent(input.from), text: input.reason.trim(), stage: run.stage, public: false });
  messages.push({ kind: 'question', author: agent(input.from), text, to: input.to ?? 'person', stage: run.stage, public: input.to === null });
  return { run: out, messages };
}

/** The agent the question is with answers it: the stage of the asker goes on with the answer, without the person. */
export function answerByAgent(run: Run, input: { by: string; text: string }, at: string): Transition {
  need(run, 'question');
  const q = run.question;
  if (!q || q.kind !== 'agent' || !q.holder || q.holder !== input.by) throw new RunError('wrong-state', { status: run.status });
  const text = input.text.trim();
  if (!text) throw new RunError('empty-text');
  const out = clone(run, at);
  out.question = null;
  out.status = 'working';
  (record(out, run.stage) as StageRecord).status = 'running';
  log(out, at, 'answer', run.stage, input.by, text);
  return { run: out, messages: [{ kind: 'answer', author: agent(input.by), text, to: q.by, stage: run.stage, public: false }] };
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
    // The budget of the stage the work was going back to starts again.
    const back = stageOf(flow, run.stage).returnsTo;
    if (back) out.returns[back] = 0;
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
    const rounds = (out.returns[target.id] = (out.returns[target.id] ?? 0) + 1);
    if (rounds >= stageOf(flow, out.stage).roundLimit) {
      out.status = 'question';
      out.question = { by: 'app', kind: 'review-limit', text: p.text, askedAt: at, stage: out.stage };
      (record(out, out.stage) as StageRecord).status = 'waiting';
      log(out, at, 'question', out.stage, 'app', 'review-limit');
      messages.push({ kind: 'question', author: app, code: 'review.limit', params: { rounds }, stage: out.stage, public: true });
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
  if (i < 0 || j < 0 || j === i || flow[j].type !== 'work') throw new RunError('unknown-stage', { stage: input.toStage });
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
  const producer = flow.find((s) => s.id === stageOf(flow, run.stage).returnsTo);
  if (!producer || producer.type !== 'work') throw new RunError('unknown-stage', { stage: run.stage });
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
    const to = followOf(flow, stageOf(flow, run.stage));
    (record(out, run.stage) as StageRecord).status = 'done';
    if (p.handoff.trim() && to) messages.push({ kind: 'handoff', author: agent(p.by), text: p.handoff, to: handoffTo(to), stage: run.stage });
    advance(out, flow, stageOf(flow, run.stage), at, messages);
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
  out.wait = null;
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

// ---- waiting ---------------------------------------------------------------------------------------------------------------------------------
// A wait stage holds the run until an event happens (the runner looks for it on its tick); an agent that asked the person who reported the issue
// holds its own stage the same way and goes on with the reply.

/** The working agent asks the person who reported the issue, on the tracker: its stage waits for their reply. */
export function askReporter(run: Run, question: { by: string; text: string }, at: string): Transition {
  need(run, 'working');
  const text = question.text.trim();
  if (!text) throw new RunError('empty-text');
  const out = clone(run, at);
  out.status = 'waiting';
  out.wait = { kind: 'reporter-reply', since: at, by: question.by };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'wait-started', run.stage, question.by, 'reporter-reply');
  return { run: out, messages: [{ kind: 'question', author: agent(question.by), text, to: 'reporter', stage: run.stage, public: true }] };
}

// What goes on after the event: a wait stage is done and the run follows it; an agent's own stage goes back to work, with what came as its answer.
function resume(out: Run, flow: FlowStage[], at: string, by: 'app' | 'person', answer: ForumDraft | null, messages: ForumDraft[]): void {
  const stage = stageOf(flow, out.stage);
  out.wait = null;
  if (stage.type === 'work') {
    out.status = 'working';
    (record(out, out.stage) as StageRecord).status = 'running';
    if (answer) messages.push(answer);
    return;
  }
  finishStage(out, at, by === 'person' ? 'skipped' : 'done');
  advance(out, flow, stage, at, messages);
}

/** What the run waited for happened. For a wait stage the run goes on to the next; for an agent that asked the reporter, `reply` is its answer. */
export function waitDone(run: Run, flow: FlowStage[], input: { reply?: string }, at: string): Transition {
  need(run, 'waiting');
  const stage = stageOf(flow, run.stage);
  const out = clone(run, at);
  log(out, at, 'wait-done', run.stage, 'app', run.wait?.kind ?? null);
  const messages: ForumDraft[] = [];
  if (stage.type === 'work') {
    const text = (input.reply ?? '').trim();
    resume(out, flow, at, 'app', { kind: 'answer', author: person, text: text || undefined, code: text ? undefined : 'wait.noText', stage: run.stage, to: run.wait?.by ?? null, public: false }, messages);
  } else {
    messages.push({ kind: 'system', author: app, code: `wait.done.${run.wait?.kind ?? 'time'}`, params: { stage: stage.label }, stage: run.stage });
    resume(out, flow, at, 'app', null, messages);
  }
  return { run: out, messages };
}

/** The person does not wait any longer: recorded as a decision with its reason, and the run goes on. */
export function waitSkip(run: Run, flow: FlowStage[], reason: string, at: string): Transition {
  need(run, 'waiting');
  const why = reason.trim();
  if (!why) throw new RunError('empty-reason');
  const stage = stageOf(flow, run.stage);
  const out = clone(run, at);
  log(out, at, 'wait-skipped', run.stage, 'person', why);
  const messages: ForumDraft[] = [{ kind: 'decision', author: person, code: 'wait.skipped', params: { stage: stage.label }, text: why, stage: run.stage, public: true }];
  resume(out, flow, at, 'person', stage.type === 'work' ? { kind: 'answer', author: person, text: why, stage: run.stage, to: run.wait?.by ?? null, public: false } : null, messages);
  return { run: out, messages };
}

// ---- following another flow ------------------------------------------------------------------------------------------------------------

/**
 * The run follows `flow` from now on (the current flow of the cycle, which the person edited after the run started). Only while the run's stage still
 * exists there, and is the same kind of stage: a run that waits at a gate cannot land on a stage an agent works.
 */
export function migrateFlow(run: Run, flow: FlowStage[], at: string): Transition {
  if (isTerminal(run)) throw new RunError('not-active', { status: run.status });
  const stage = flow.find((s) => s.id === run.stage);
  if (!stage) throw new RunError('unknown-stage', { stage: run.stage });
  const was = run.flow?.stages.find((s) => s.id === run.stage);
  if (was && was.type !== stage.type) throw new RunError('flow-mismatch', { stage: stage.label });
  const out = clone(run, at);
  out.flow = snapshotOf(flow);
  log(out, at, 'flow-migrated', run.stage, 'person', out.flow.hash);
  return { run: out, messages: [{ kind: 'system', author: app, code: 'run.flow.migrated', params: { hash: out.flow.hash }, stage: run.stage }] };
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

// What the caller says about the text, kept only when it says it: an edit that does not carry a title does not lose the one it had.
const details = (input: CommentDetails): CommentDetails => Object.fromEntries(Object.entries({ body: input.body, headline: input.headline, title: input.title }).filter(([, v]) => v !== undefined));

/** A body was written but nothing was asked of the person yet. */
export function recordCommentDraft(run: Run, key: string, input: { target: CommentTarget; bodyHash: string } & CommentDetails, at: string): Transition {
  return noteComment(run, key, at, 'draft', (c) => ({ ...(c ?? fresh(input.target, 'draft', at)), ...details(input), target: input.target, bodyHash: input.bodyHash, status: c?.status === 'published' ? 'published' : 'draft', updatedAt: at }));
}

/** The comment (or its edit) waits in Actions for its own "yes". A comment already published keeps its note id, so the proposal is an edit. */
export function recordCommentProposal(run: Run, key: string, input: { target: CommentTarget; bodyHash: string } & CommentDetails, at: string): Transition {
  return noteComment(run, key, at, 'proposed', (c) => ({ ...(c ?? fresh(input.target, 'proposed', at)), ...details(input), target: input.target, bodyHash: input.bodyHash, status: 'proposed', updatedAt: at }));
}

/** The host accepted the comment and returned its id. */
export function recordCommentPublished(run: Run, key: string, input: { target: CommentTarget; noteId: string | number; url: string | null; bodyHash: string } & CommentDetails, at: string): Transition {
  return noteComment(run, key, at, 'published', (c) => ({ ...(c ?? {}), ...details(input), target: input.target, noteId: input.noteId, url: input.url, bodyHash: input.bodyHash, status: 'published', updatedAt: at }));
}

/** The published comment was edited in place: same note id, new body. Refused when there is no published comment to edit. */
export function recordCommentEdited(run: Run, key: string, input: { bodyHash: string; url?: string | null } & CommentDetails, at: string): Transition {
  const current = run.comments[key];
  if (!current || current.noteId === null) throw new RunError('unknown-comment', { key });
  return noteComment(run, key, at, 'published', (c) => ({ ...(c as CommentRecord), ...details(input), bodyHash: input.bodyHash, url: input.url === undefined ? (c as CommentRecord).url : input.url, status: 'published', updatedAt: at }));
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

/** A comment the runner posted was deleted from the tracker (after the person said yes to the proposal). The run keeps the record. */
export function recordCommentRemoved(run: Run, key: string, at: string): Transition {
  if (!run.comments[key]) throw new RunError('unknown-comment', { key });
  return noteComment(run, key, at, 'removed', (c) => ({ ...(c as CommentRecord), noteId: null, status: 'removed', updatedAt: at }));
}
