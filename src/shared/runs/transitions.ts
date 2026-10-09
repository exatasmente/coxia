import type { AttachmentRef } from '../attachments';
import type { ArtifactRef, ForumDraft } from '../forum';
import type { EvidenceRecord } from '../evidence';
import { withStageName } from '../cycles/text';
import { t } from '../i18n';
import { flowProblems, producerOf, snapshotOf } from './flow';
import { scenarioBlocks } from './output';
import { SEND_BACK_STATUSES, canSendBack, sendBackTargets, sendBackText } from './sendBack';
import { mergeUsage } from './usage';
import type { ProcedureUse } from '../procedures';
import { HISTORY_DETAIL_MAX, PROCEDURES_PER_STAGE, isTerminal, runVersionOf, type CommentDetails, type CommentRecord, type CommentStatus, type CommentTarget, type FlowStage, type HistoryEntry, type HistoryType, type PendingResult, type QaRecord, type ReviewRecord, type RoutedBy, type RoutingWhy, type Run, type RunLink, type RunIssue, type RunDocs, type RunSubject, type StageRecord, type StageUsage, type Transition } from './types';

// Every move of a run is a pure function: (run, flow, input, at) -> { run, messages }. The input run is never changed. `messages` are what the
// forum is to record about the move, in order; the caller saves the run first and then appends them. `at` is an ISO time.

export const RUN_ERROR_CODES = ['no-flow', 'no-agent', 'wrong-state', 'empty-reason', 'empty-text', 'duplicate', 'unknown-stage', 'not-active', 'unknown-run', 'newer-version', 'invalid', 'unknown-comment', 'unknown-evidence', 'invalid-flow', 'flow-mismatch', 'not-waiting', 'unknown-squad', 'not-routing', 'unknown-link'] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    readonly params: Record<string, string | number> = {},
  ) {
    super(t(`main.runs.error.${code}`, withStageName(params)));
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
  // A long answer or reason must not make the file one the store refuses: the entry keeps its start, the thread keeps it whole.
  const entry: HistoryEntry = { at, type, stage, by, detail: detail === null ? null : detail.slice(0, HISTORY_DETAIL_MAX) };
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
  const previous = new Set(r.artifacts);
  r.artifacts = unique([...r.artifacts, ...artifacts]);
  // The timeline marks which attempt a shown artifact belongs to; a name produced again keeps its first attempt, so the badge never moves.
  if (artifacts.length) {
    const attempts = r.artifactAttempts ?? (r.artifactAttempts = {});
    for (const name of artifacts) if (!previous.has(name)) attempts[name] = r.attempts;
  }
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
  rec.autonomous = stage.cycleAutonomous || stage.autonomous;
  rec.attempts += 1;
  rec.startedAt = at;
  rec.endedAt = null;
  run.stage = stageId;
  run.error = null;
  run.wait = null;
  const base = { author: app, stage: stageId } as const;
  if (stage.type === 'gate') {
    // The plan gate of a release shows the person the heads the run had read when it got there; this snapshot is the only thing the gate freezes (see `freezeAtPlanGate`).
    if (run.subject && planGateOf(flow)?.id === stageId) run.subject.seen = headsOf(run.subject);
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
  /** The squad the scope rules picked: the run starts in it, with the flow the caller resolved for it. */
  squad?: { id: string; name: string; rule: RoutedBy } | null;
  /** The run another squad's request made: the run that asked, and what it asked. The new run starts linked to it. */
  origin?: { run: string; issue: string; squad: string | null; kind: RunLink['kind']; key: string; title: string } | null;
  /** The scope rules could not pick a squad: the run starts at the front door of the workspace's flow and the squad is decided there (see `RoutingState`). */
  routing?: { candidates: string[]; why: RoutingWhy } | null;
  id: string;
  issue: RunIssue;
  repo: string;
  branch: string;
  worktree: string;
  cycleFolder: string;
  cycleId: string;
  /** The commit the branch was cut from. */
  base?: string | null;
  /** The branch it was cut from, which its pull request aims at. */
  baseBranch?: string;
  /** The run is a release of a version (its `issue` is the synthesized `release:X.Y.Z`). */
  subject?: RunSubject;
  /** The run drafts the documentation of its repository (its `issue` is the synthesized `docs:<repo>`). */
  docs?: RunDocs;
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
    version: runVersionOf({}),
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
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    createdAt: at,
    updatedAt: at,
    ...(input.subject ? { subject: structuredClone(input.subject) } : {}),
    ...(input.docs ? { docs: { ...input.docs } } : {}),
  };
  log(run, at, 'started', null, 'person');
  const messages: ForumDraft[] = [{ kind: 'system', author: app, code: 'run.started', params: { issue: input.issue.ref } }];
  if (input.squad) {
    run.squad = input.squad.id;
    run.routedBy = input.squad.rule;
    log(run, at, 'squad-routed', null, 'app', `${input.squad.rule}:${input.squad.id}`);
    messages.push({ kind: 'system', author: app, code: `run.squad.routed.${input.squad.rule}`, params: { squad: input.squad.name } });
  }
  if (input.routing) {
    run.routing = { candidates: [...input.routing.candidates], why: input.routing.why, proposal: null, result: null };
    messages.push({ kind: 'system', author: app, code: `run.squad.triage.${input.routing.why}`, params: { squads: input.routing.candidates.join(', ') } });
  }
  if (input.origin) {
    run.links = [{ key: `origin-${input.origin.key}`.slice(0, 48), role: 'origin', kind: input.origin.kind, squad: input.origin.squad, run: input.origin.run, issue: input.origin.issue, title: input.origin.title, status: 'open', at }];
    log(run, at, 'link', null, 'app', `origin:${input.origin.run}`);
    messages.push({ kind: 'system', author: app, code: 'run.link.origin', params: { issue: input.origin.issue, run: input.origin.run, squad: input.origin.squad ?? '' } });
  }
  const front = flow[0];
  if (input.routing && !(front.type === 'work' && front.agent)) {
    // Nobody works the first stage to propose a squad: the person chooses before anything runs.
    run.stages.push({ stage: front.id, agent: null, status: 'waiting', artifacts: [], startedAt: null, endedAt: null, attempts: 0, autonomous: false });
    run.status = 'question';
    run.question = { by: 'app', holder: null, hops: 0, kind: 'squad', text: t('main.runs.squad.question', { squads: input.routing.candidates.join(', ') }), askedAt: at, stage: front.id };
    log(run, at, 'squad-asked', front.id, 'app');
    messages.push({ kind: 'question', author: app, code: 'run.squad.ask', params: { squads: input.routing.candidates.join(', ') }, to: 'person', stage: front.id, public: true });
  } else {
    // The person who starts the run starts its first stage too.
    enter(run, flow, front.id, at, messages, true);
  }
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

// The plan gate of a release run is the first gate of its flow: accepting it (approving or skipping) freezes the heads of the activities the run has read, in the same
// transition, so a call that is refused (not at a gate, no reason) freezes nothing. Sending the run back to the plan (a rejected plan gate, or a send-back to a stage before
// it) clears them, so the next acceptance of the plan freezes again; a later gate never freezes or clears.
const planGateOf = (flow: FlowStage[]): FlowStage | undefined => flow.find((s) => s.type === 'gate');

const headsOf = (subject: RunSubject): Record<string, string> => Object.fromEntries(subject.activities.map((a) => [String(a.pr), a.head]));

// What the gate freezes is what the run recorded on entering it (`seen`), never the activities as they stand at the click: a sweep rewrites those, and the click could freeze a head
// the person never saw. A pull request pushed to during the wait is not in `seen`, so it fails closed. A run with no snapshot freezes nothing (every merge is then refused).
function freezeAtPlanGate(out: Run, flow: FlowStage[]): void {
  if (!out.subject || out.subject.planned || planGateOf(flow)?.id !== out.stage) return;
  out.subject.planned = { ...(out.subject.seen ?? {}) };
}

function clearPlanBefore(out: Run, flow: FlowStage[], toStage: string): void {
  const gate = planGateOf(flow);
  if (!out.subject?.planned || !gate) return;
  const index = (id: string): number => flow.findIndex((s) => s.id === id);
  if (index(toStage) >= 0 && index(toStage) < index(gate.id)) delete out.subject.planned;
}

// Sends the run back to an earlier stage with the reason as a handoff from `from` to that stage's agent. The stage it leaves is marked rejected.
// `start`: the person asked for it, so the stage starts at once even when its agent is not autonomous.
function sendBack(out: Run, flow: FlowStage[], toStage: FlowStage, from: ForumDraft['author'], text: string, at: string, messages: ForumDraft[], start: boolean): void {
  finishStage(out, at, 'rejected');
  clearPlanBefore(out, flow, toStage.id);
  messages.push({ kind: 'handoff', author: from, text, to: toStage.agent, stage: out.stage });
  enter(out, flow, toStage.id, at, messages, start);
}

/** The person approves the gate: the run goes on to the next stage. `note` is optional and goes in the decision. */
export function gateApprove(run: Run, flow: FlowStage[], at: string, note = '', by: 'person' | 'app' = 'person'): Transition {
  need(run, 'gate');
  const out = clone(run, at);
  freezeAtPlanGate(out, flow);
  finishStage(out, at, 'done');
  log(out, at, 'gate-approved', run.stage, by, note.trim() || null);
  const messages: ForumDraft[] = [{ kind: 'decision', author: by === 'app' ? app : person, code: 'gate.approved', params: { stage: labelOf(flow, run.stage) }, text: note.trim(), stage: run.stage, public: true }];
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
  freezeAtPlanGate(out, flow);
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
export function answer(run: Run, flow: FlowStage[], text: string, at: string, attachments: AttachmentRef[] = []): Transition {
  need(run, 'question');
  const said = text.trim();
  if (!said) throw new RunError('empty-text');
  const q = run.question;
  // Which squad the run works in is decided with `routeSquad`, not answered in words.
  if (q?.kind === 'squad') throw new RunError('wrong-state', { status: run.status });
  const out = clone(run, at);
  out.question = null;
  log(out, at, 'answer', run.stage, 'person', said);
  // The files the person attached to the message answer with it: they stay on the answer message, so it shows them and the retention sees a live message.
  const messages: ForumDraft[] = [{ kind: 'answer', author: person, text: said, attachments, stage: run.stage, public: true }];
  // The move hands the same files to the turn that runs the stage: the answer message is what shows them, and the agent of the stage reads them through its tool.
  const carried = attachments.length ? { attachments: { 0: attachments } } : {};
  if (q?.kind === 'review-limit') {
    const producer = producerOf(flow, run.stage);
    if (!producer) throw new RunError('unknown-stage', { stage: run.stage });
    // The budget of the stage that stopped starts again; the other returning stage's is its own.
    out.returns[run.stage] = 0;
    sendBack(out, flow, producer, person, said, at, messages, true);
  } else {
    out.status = 'working';
    (record(out, run.stage) as StageRecord).status = 'running';
  }
  return { run: out, messages, ...carried };
}

// The work goes back to an earlier stage. A review pass counts toward the limit of the stage that sends it back (the review and QA each have their own
// budget, `roundLimit`): at the limit the run stops and asks the person instead.
function applyReturn(out: Run, flow: FlowStage[], p: PendingResult, at: string, messages: ForumDraft[]): void {
  const target = flow.find((x) => x.id === p.toStage);
  if (!target) throw new RunError('unknown-stage', { stage: p.toStage ?? '' });
  if (p.countRound) {
    const rounds = (out.returns[out.stage] = (out.returns[out.stage] ?? 0) + 1);
    if (rounds >= stageOf(flow, out.stage).roundLimit) {
      out.status = 'question';
      // The question is the readable account the runner wrote from the rounds, when it wrote one; otherwise the findings as they came.
      const text = p.limit?.trim() || p.text;
      out.question = { by: 'app', kind: 'review-limit', text, askedAt: at, stage: out.stage };
      (record(out, out.stage) as StageRecord).status = 'waiting';
      log(out, at, 'question', out.stage, 'app', 'review-limit');
      messages.push({ kind: 'question', author: app, code: 'review.limit', params: { rounds }, text: p.limit?.trim() ? text : undefined, stage: out.stage, public: true });
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
export function handBack(run: Run, flow: FlowStage[], input: { by: string; toStage: string; text: string; /** The hand back counts toward the review limit (QA that failed). */ countRound?: boolean; /** What the person is asked when it reaches the limit. */ limit?: string }, at: string): Transition {
  need(run, 'working');
  const i = flow.findIndex((s) => s.id === run.stage);
  const j = flow.findIndex((s) => s.id === input.toStage);
  if (i < 0 || j < 0 || j === i || flow[j].type !== 'work') throw new RunError('unknown-stage', { stage: input.toStage });
  const text = input.text.trim();
  if (!text) throw new RunError('empty-text');
  return returnWork(run, flow, { kind: 'return', by: input.by, text: input.countRound ? text : '', handoff: text, toStage: input.toStage, countRound: !!input.countRound, ...(input.limit ? { limit: input.limit } : {}) }, null, at);
}

export interface ReviewReturnInput {
  by: string;
  /** What the review found. */
  findings: string;
  /** What must change; defaults to the findings. */
  handoff?: string;
  /** What the person is asked when this return reaches the limit: the rounds so far as text. */
  limit?: string;
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
  return returnWork(run, flow, { kind: 'return', by: input.by, text: findings, handoff: input.handoff?.trim() || findings, toStage: producer.id, countRound: true, ...(input.limit ? { limit: input.limit } : {}) }, post, at);
}

/** The person starts a stage whose agent is not autonomous. The flag counts as it is now: a change takes effect at a stage start. */
export function startStage(run: Run, flow: FlowStage[], at: string): Transition {
  need(run, 'to-start');
  const stage = flow.find((s) => s.id === run.stage);
  if (!stage?.agent) throw new RunError('no-agent', { stage: stage?.label ?? run.stage });
  const out = clone(run, at);
  const rec = record(out, run.stage) as StageRecord;
  rec.agent = stage.agent;
  rec.autonomous = stage.cycleAutonomous || stage.autonomous;
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

export interface SendBackInput {
  /** The work stage the run goes back to: one of `sendBackTargets`. */
  toStage: string;
  /** What the person asks of it; may be empty when the review or QA left something open. */
  note: string;
}

/**
 * The person sends the run back to an earlier work stage, from a wait, a gate, a stage that waits to start or to be accepted, a failure, a question, or the end
 * (which reopens the run). The note, with what the review and QA left open, is a handoff from the person to that stage's agent; the stage starts again at once
 * as a new attempt, and the stages after it run again in order. Nothing is counted against the review limit: this is the person's decision, not a round.
 */
export function sendBackTo(run: Run, flow: FlowStage[], input: SendBackInput, at: string): Transition {
  if (run.status === 'cancelled') throw new RunError('not-active', { status: run.status });
  need(run, ...SEND_BACK_STATUSES);
  if (!canSendBack(run)) throw new RunError('wrong-state', { status: run.status });
  const target = sendBackTargets(flow, run.stage).find((s) => s.id === input.toStage);
  if (!target) throw new RunError('unknown-stage', { stage: input.toStage });
  const note = input.note.trim();
  const text = sendBackText(run, target.id, note);
  if (!text) throw new RunError('empty-reason');
  const out = clone(run, at);
  const from = stageOf(flow, run.stage);
  const rec = record(out, run.stage);
  const reopened = run.status === 'done';
  // The stage the run leaves keeps how it ended when it did end (done, failed); a wait is skipped, anything that was waiting for the person is turned down.
  if (rec && !reopened && rec.status !== 'failed') finishStage(out, at, from.type === 'wait' ? 'skipped' : 'rejected');
  out.question = null;
  out.pending = null;
  if (reopened) log(out, at, 'reopened', run.stage, 'person', note || null);
  clearPlanBefore(out, flow, target.id);
  log(out, at, 'sent-back', run.stage, 'person', `${target.id}${note ? `: ${note}` : ''}`);
  const messages: ForumDraft[] = [
    { kind: 'decision', author: person, code: reopened ? 'run.reopened' : 'run.sentBack', params: { stage: target.label }, text: note, stage: run.stage, public: true },
    { kind: 'handoff', author: person, text, to: target.agent, stage: run.stage },
  ];
  enter(out, flow, target.id, at, messages, true);
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

// ---- the squad of a run ----------------------------------------------------------------------------------------------------------------------
// A run the scope rules could not place starts at the front door of the workspace's flow. When that stage ends, the squad is decided: by the agent's proposal
// when it runs by itself, by the person's choice otherwise, and the run goes on in the squad's flow from the stage after the front door.

export interface FrontDoorResult {
  by: string;
  summary: string;
  handoff: string;
  artifacts: string[];
}

/** The front door ended and the person is to choose the squad: the agent proposed none, or it does not run by itself. What it produced waits for the choice. */
export function askSquad(run: Run, input: FrontDoorResult & { proposal: { squad: string; reason: string } | null }, at: string): Transition {
  need(run, 'working');
  if (!run.routing) throw new RunError('wrong-state', { status: run.status });
  const out = clone(run, at);
  const squads = run.routing.candidates.join(', ');
  const proposal = input.proposal ? { squad: input.proposal.squad, by: input.by, reason: input.proposal.reason } : null;
  out.routing = { ...run.routing, proposal, result: { by: input.by, summary: input.summary, handoff: input.handoff, artifacts: [...input.artifacts] } };
  out.status = 'question';
  out.question = { by: input.by, holder: null, hops: 0, kind: 'squad', text: t('main.runs.squad.question', { squads }), askedAt: at, stage: run.stage };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'squad-asked', run.stage, input.by, proposal?.squad ?? null);
  const post: ForumDraft = { kind: 'post', author: agent(input.by), text: input.summary, refs: refsOf(input.artifacts), stage: run.stage, public: true };
  const ask: ForumDraft = { kind: 'question', author: agent(input.by), code: proposal ? 'run.squad.ask.proposal' : 'run.squad.ask', params: { squads, proposal: proposal?.squad ?? '', reason: proposal?.reason ?? '' }, to: 'person', stage: run.stage, public: true };
  return { run: out, messages: [post, ask] };
}

export interface RouteSquadInput {
  /** The squad the run goes on in; null: no squad (the person chose to go on without one). */
  squad: string | null;
  /** Its name, for the thread. */
  name: string;
  /** The flow of that squad, resolved by the caller (the workspace's own when the squad has none, or when there is no squad). */
  flow: FlowStage[];
  /** The agent that proposed it, or "person". */
  by: string;
  reason: string;
  how: Extract<RoutedBy, 'agent' | 'person'>;
  /** The front door's result, when the stage just ended and the agent decided by itself; absent when the run was waiting for the person (it is in `routing.result`). */
  result?: FrontDoorResult;
}

/**
 * The squad is decided: the run goes on in its flow. The stage after the front door in that flow is entered (the flow's first stage when the front door never
 * ran or the squad's flow does not have it), with the agents of the squad.
 */
export function routeSquad(run: Run, input: RouteSquadInput, at: string): Transition {
  need(run, 'working', 'question');
  if (!run.routing) throw new RunError('wrong-state', { status: run.status });
  const asked = run.status === 'question';
  if (asked && run.question?.kind !== 'squad') throw new RunError('wrong-state', { status: run.status });
  if (!input.flow.length) throw new RunError('no-flow');
  const result = input.result ?? run.routing.result;
  const out = clone(run, at);
  out.squad = input.squad;
  out.routedBy = input.squad ? input.how : null;
  out.routing = null;
  out.question = null;
  out.flow = snapshotOf(input.flow);
  log(out, at, 'squad-routed', run.stage, input.by, input.squad ? `${input.how}:${input.squad}` : `${input.how}:none`);
  const messages: ForumDraft[] = [];
  if (asked) messages.push({ kind: 'answer', author: person, code: 'run.squad.chosen', params: { squad: input.name }, text: input.reason.trim(), stage: run.stage, public: true });
  else messages.push({ kind: 'system', author: app, code: 'run.squad.proposed', params: { squad: input.name, agent: input.by, reason: input.reason }, stage: run.stage });
  const at0 = input.flow.findIndex((s) => s.id === run.stage);
  if (result) {
    if (!asked && input.result) messages.push({ kind: 'post', author: agent(result.by), text: result.summary, refs: refsOf(result.artifacts), stage: run.stage, public: true });
    finishStage(out, at, 'done', result.artifacts);
    log(out, at, 'stage-done', run.stage, result.by);
    const to = at0 >= 0 ? followOf(input.flow, input.flow[at0]) : input.flow[0];
    if (result.handoff.trim() && to) messages.push({ kind: 'handoff', author: agent(result.by), text: result.handoff, to: handoffTo(to), stage: run.stage });
    if (at0 >= 0) advance(out, input.flow, input.flow[at0], at, messages);
    else enter(out, input.flow, input.flow[0].id, at, messages);
  } else {
    // The front door never ran: the stage it was to run is not run at all.
    finishStage(out, at, 'skipped');
    enter(out, input.flow, input.flow[0].id, at, messages);
  }
  return { run: out, messages };
}

/** The squad of the run was removed (after the person confirmed): the run goes on with no squad, following the flow it has. */
export function leaveSquad(run: Run, at: string): Transition {
  if (isTerminal(run)) throw new RunError('not-active', { status: run.status });
  const out = clone(run, at);
  const was = run.squad ?? '';
  out.squad = null;
  out.routedBy = null;
  log(out, at, 'squad-routed', run.stage, 'person', `none:${was}`);
  return { run: out, messages: [{ kind: 'system', author: app, code: 'run.squad.removed', params: { squad: was }, stage: run.stage }] };
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

/**
 * The stage hit a provider whose key ran out of budget. It is a wait, not a failure: nothing is spent and no retry is offered, and the run goes on by
 * itself when the sweep finds the provider answering again. `detail` is the reason in words, already built from the provider's own (masked) text.
 */
export function stageWaitingOnBudget(run: Run, input: { provider: string; engine: string; detail: string }, at: string): Transition {
  need(run, 'working');
  const out = clone(run, at);
  out.status = 'waiting';
  out.wait = { kind: 'budget', since: at, provider: input.provider, detail: input.detail };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'wait-started', run.stage, 'app', `budget:${input.provider}`);
  return { run: out, messages: [{ kind: 'system', author: app, code: 'run.stage.wait.budget', params: { stage: run.stage, provider: input.provider, engine: input.engine, detail: input.detail }, stage: run.stage }] };
}

/**
 * A plugin of the run asked the person for something it was not allowed (its network, its write): the stage does not start until every request of the
 * run is answered. A wait, not a failure: nothing of the stage ran, and the run goes on where it was held.
 */
export function stageWaitingOnPlugin(run: Run, input: { plugin: string; need: string }, at: string): Transition {
  need(run, 'working');
  const out = clone(run, at);
  out.status = 'waiting';
  out.wait = { kind: 'plugin', since: at, plugin: input.plugin, detail: input.need };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  log(out, at, 'wait-started', run.stage, 'app', `plugin:${input.plugin}`);
  return { run: out, messages: [{ kind: 'system', author: app, code: `run.stage.wait.plugin.${input.need === 'write' ? 'write' : 'network'}`, params: { stage: run.stage, plugin: input.plugin }, stage: run.stage }] };
}

/** Every plugin request of the run was answered (allowed or refused): the held stage starts. */
export function pluginWaitDone(run: Run, at: string): Transition {
  need(run, 'waiting');
  const out = clone(run, at);
  log(out, at, 'wait-done', run.stage, 'app', 'plugin');
  out.wait = null;
  out.status = 'working';
  (record(out, run.stage) as StageRecord).status = 'running';
  return { run: out, messages: [{ kind: 'system', author: app, code: 'wait.done.plugin', params: { stage: run.stage }, stage: run.stage }] };
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

/**
 * What the run waited for happened. For a wait stage the run goes on to the next; for an agent that asked the reporter, `reply` is its answer, and the app is
 * the author of it when the event was another run's end (`from: 'app'`): nobody wrote it.
 */
export function waitDone(run: Run, flow: FlowStage[], input: { reply?: string; from?: 'person' | 'app' }, at: string): Transition {
  need(run, 'waiting');
  const stage = stageOf(flow, run.stage);
  const out = clone(run, at);
  log(out, at, 'wait-done', run.stage, 'app', run.wait?.kind ?? null);
  const messages: ForumDraft[] = [];
  if (stage.type === 'work') {
    const text = (input.reply ?? '').trim();
    resume(out, flow, at, 'app', { kind: 'answer', author: input.from === 'app' ? app : person, text: text || undefined, code: text ? undefined : 'wait.noText', stage: run.stage, to: run.wait?.by ?? null, public: false }, messages);
  } else {
    messages.push({ kind: 'system', author: app, code: `wait.done.${run.wait?.kind ?? 'time'}`, params: { stage: stage.label, provider: run.wait?.provider ?? '' }, stage: run.stage });
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

// ---- runs that ask each other ------------------------------------------------------------------------------------------------------------
// A run whose agent asked something of another squad (a change in its area) goes on only when that squad's run is over: the agent's question is answered with
// "a request was made", and the run waits on `linked-done` until every run it asked for has ended.

export interface WaitLinkedInput {
  /** The liaison that holds the question and answers it with `text`. */
  by: string;
  text: string;
  link: Omit<RunLink, 'at' | 'role'>;
}

/** The question of a run is turned into a request to another squad: it is answered ("asked, waiting") and the stage waits for the linked run. */
export function waitLinked(run: Run, input: WaitLinkedInput, at: string): Transition {
  need(run, 'question');
  const q = run.question;
  if (!q || q.kind !== 'agent' || !q.holder || q.holder !== input.by) throw new RunError('wrong-state', { status: run.status });
  const text = input.text.trim();
  if (!text) throw new RunError('empty-text');
  const out = clone(run, at);
  out.question = null;
  out.status = 'waiting';
  out.wait = { kind: 'linked-done', since: at, by: q.by };
  (record(out, run.stage) as StageRecord).status = 'waiting';
  out.links = [...(run.links ?? []), { ...structuredClone(input.link), role: 'requested', at }];
  log(out, at, 'wait-started', run.stage, q.by, 'linked-done');
  log(out, at, 'link', run.stage, input.by, `requested:${input.link.key}`);
  return { run: out, messages: [{ kind: 'answer', author: agent(input.by), text, to: q.by, stage: run.stage, public: false }] };
}

/** What a link of the run knows changes: the other run now exists, it ended, the issue was refused. Applies in any status. */
export function linkUpdate(run: Run, key: string, patch: Partial<Pick<RunLink, 'run' | 'issue' | 'status' | 'title'>>, at: string): Transition {
  const i = (run.links ?? []).findIndex((l) => l.key === key);
  if (i < 0) throw new RunError('unknown-link', { key });
  const out = clone(run, at);
  const links = out.links as RunLink[];
  links[i] = { ...links[i], ...structuredClone(patch) };
  log(out, at, 'link-updated', null, 'app', `${key}:${links[i].status}`);
  return { run: out, messages: [] };
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

/**
 * The person corrected the cycle memory on the run screen. The app writes and commits their version with the workspace's identity; the run's history and the
 * thread record it as the person's, so the next stage reads it and the authorship of the edit is not the commit's.
 */
export function memoryEdited(run: Run, at: string): Transition {
  if (isTerminal(run)) throw new RunError('not-active', { status: run.status });
  const out = clone(run, at);
  log(out, at, 'memory-edited', out.stage, 'person');
  return { run: out, messages: [{ kind: 'system', author: person, code: 'runner.memory.edited', stage: out.stage }] };
}

// ---- the subject of a release run ----------------------------------------------------------------------------------------------------------
/** What a release run learns about its subject: where its tracking issue is, and the activities of the version as last read. A run with no subject is refused. */
export function recordSubject(run: Run, patch: Partial<Pick<RunSubject, 'tracking' | 'activities' | 'seen'>>, at: string): Transition {
  if (!run.subject) throw new RunError('invalid', { id: run.id, detail: 'not a release run' });
  const out = clone(run, at);
  out.subject = { ...(out.subject as RunSubject), ...structuredClone(patch) };
  return { run: out, messages: [] };
}

/**
 * The heads the run saw on entering the plan gate (`seen`) are frozen as the plan's (once, until the run is sent back to the plan). The gates do this themselves in their own
 * transition (`gateApprove`, `gateSkip` at the plan gate); this is the same step on its own. What a merge
 * brings in is checked against them, so a commit pushed to a pull request after the plan was approved is not merged by the agent.
 */
export function freezePlan(run: Run, at: string): Transition {
  if (!run.subject) throw new RunError('invalid', { id: run.id, detail: 'not a release run' });
  if (run.subject.planned) return { run, messages: [] };
  const out = clone(run, at);
  (out.subject as RunSubject).planned = { ...(run.subject.seen ?? {}) };
  return { run: out, messages: [] };
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
const details = (input: CommentDetails): CommentDetails => Object.fromEntries(Object.entries({ body: input.body, headline: input.headline, title: input.title, evidenceIds: input.evidenceIds }).filter(([, v]) => v !== undefined));

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

/** What a stage's model calls used in one attempt is added to the stage's record. Applies in any status: the use happened whatever became of the stage. */
export function recordUsage(run: Run, stageId: string, usage: StageUsage, at: string): Transition {
  const out = clone(run, at);
  const rec = record(out, stageId);
  if (rec) rec.usage = mergeUsage(rec.usage, usage);
  return { run: out, messages: [] };
}

/**
 * The procedures a stage's agent used in an attempt are added to the stage's record, one entry per procedure (a later attempt's outcome replaces an earlier one's).
 * Applies in any status, like the usage: the use happened whatever became of the stage. A stage that used none gets no field, and the run stays at its format.
 */
export function recordProcedures(run: Run, stageId: string, uses: readonly ProcedureUse[], at: string): Transition {
  const out = clone(run, at);
  const rec = record(out, stageId);
  if (rec && uses.length) {
    const merged = [...(rec.procedures ?? [])];
    for (const u of uses) {
      const i = merged.findIndex((x) => x.id === u.id);
      if (i >= 0) merged[i] = { ...u };
      else merged.push({ ...u });
    }
    rec.procedures = merged.slice(-PROCEDURES_PER_STAGE);
  }
  return { run: out, messages: [] };
}

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
  log(out, at, 'qa', input.stage, input.by, input.scenarios.some(scenarioBlocks) ? 'fail' : 'pass');
  return { run: out, messages: [] };
}

/** A stage kept a piece of evidence: the run records it by id, so the stage and the QA view can list and cite it. */
export function recordEvidence(run: Run, record: EvidenceRecord, at: string): Transition {
  const out = clone(run, at);
  out.evidence = { ...(out.evidence ?? {}), [record.id]: structuredClone(record) };
  log(out, at, 'evidence', record.stage, record.by, `${record.id}: ${record.title}`);
  return { run: out, messages: [] };
}

/** The person removed a piece of evidence: the run drops the record; what already went to the code host is not touched. */
export function deleteEvidence(run: Run, id: string, at: string): Transition {
  const out = clone(run, at);
  if (!out.evidence?.[id]) throw new RunError('unknown-evidence', { id });
  delete out.evidence[id];
  log(out, at, 'evidence-removed', run.stage, 'person', id);
  return { run: out, messages: [] };
}

/**
 * Retention removed the file of the app's own screen recording: the run keeps the record, marked, so the stage says "removed by retention" instead of showing an
 * error. Nothing else of the run changes, and what was copied elsewhere is never touched.
 */
export function markRecordingRemoved(run: Run, id: string, at: string): Transition {
  const record = run.evidence?.[id];
  if (!record?.recording) throw new RunError('unknown-evidence', { id });
  const out = clone(run, at);
  out.evidence = { ...(out.evidence ?? {}), [id]: { ...structuredClone(record), removed: 'retention' } };
  log(out, at, 'evidence-removed', record.stage, 'app', `${id}: retention`);
  return { run: out, messages: [] };
}

/** A comment the runner posted was deleted from the tracker (after the person said yes to the proposal). The run keeps the record. */
export function recordCommentRemoved(run: Run, key: string, at: string): Transition {
  if (!run.comments[key]) throw new RunError('unknown-comment', { key });
  return noteComment(run, key, at, 'removed', (c) => ({ ...(c as CommentRecord), noteId: null, status: 'removed', updatedAt: at }));
}
