import type { StageKind, StageType, WaitFor, WaitKind } from '../config/types';
import type { ForumDraft } from '../forum';

// A run: one issue going through the agent cycle. This file is the shape; the moves are in transitions.ts, the file format check in schema.ts.

export const RUN_VERSION = 1;
export const RUN_ID = /^r-[a-z0-9]{1,12}-[a-z0-9]{2,8}$/;

/**
 * working: an agent works `stage`. gate: the person decides. question: waiting for an answer. failed: waiting for a retry or a cancel.
 * to-start: the stage's agent is not autonomous, so the stage waits for the person to start it.
 * to-accept: that agent finished, and its result waits for the person to accept it (or send it back with a note).
 * waiting: the stage is a wait (or an agent asked the person who reported the issue): the run goes on when the event it waits for happens (`Run.wait`).
 */
export const RUN_STATUSES = ['working', 'gate', 'question', 'failed', 'to-start', 'to-accept', 'waiting', 'done', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STAGE_STATUSES = ['running', 'waiting', 'done', 'rejected', 'skipped', 'failed', 'cancelled'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export interface StageRecord {
  stage: string;
  /** The agent that works (or worked) it; null for a gate. */
  agent: string | null;
  status: StageStatus;
  /** Files of the cycle folder this stage has produced, by name. */
  artifacts: string[];
  /** Start of the latest attempt. */
  startedAt: string | null;
  endedAt: string | null;
  attempts: number;
  /** Whether the agent was autonomous when the stage was entered: a change of the flag never applies in the middle of a stage. */
  autonomous: boolean;
  /** What its model calls used, over all attempts; absent for a stage that ran before this was recorded (and for a gate). */
  usage?: StageUsage;
}

/** What the model calls of a stage used, over all its attempts. `costUsd` is what a provider or the SDK reported, null when none did. */
export interface StageUsage {
  promptTokens: number;
  completionTokens: number;
  /** Of the prompt tokens, the ones served from the provider's cache. */
  cachedTokens: number;
  /** Model calls. */
  calls: number;
  costUsd: number | null;
}

export const QUESTION_KINDS = ['agent', 'review-limit', 'squad'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** How many agents a question may pass through before it goes to the person, whatever the agents say. */
export const MAX_QUESTION_HOPS = 4;

/** How the person answers a command an agent set to `shell: host` wants to run: this one, every one of the rest of the stage, or none. */
export const COMMAND_DECISIONS = ['once', 'stage', 'deny'] as const;
export type CommandDecision = (typeof COMMAND_DECISIONS)[number];

/** A command an agent set to `shell: host` waits to run until the person says yes. Lives only while the stage does: it is never saved with the run. */
export interface PendingCommand {
  id: string;
  stage: string;
  agent: string;
  command: string;
  since: string;
}

export interface PendingQuestion {
  /** The agent id that asked, or "app". */
  by: string;
  /** The agent the question is with now (an agent of the chain); null: the person. Absent in a run written before agents talked first. */
  holder?: string | null;
  /** How many times the question has been passed on. */
  hops?: number;
  kind: QuestionKind;
  text: string;
  askedAt: string;
  stage: string;
}

export interface RunFailure {
  code: 'no-agent' | 'stage-failed' | 'no-event';
  stage: string;
  detail: string | null;
}

export const HISTORY_TYPES = ['link', 'link-updated', 'squad-routed', 'squad-asked', 'review', 'qa', 'comment', 'flow-migrated', 'wait-started', 'wait-done', 'wait-skipped', 'started', 'stage-waiting', 'stage-ready', 'stage-accepted', 'stage-returned', 'stage-started', 'stage-done', 'question-passed', 'gate-approved', 'gate-rejected', 'gate-skipped', 'question', 'answer', 'handback', 'sent-back', 'memory-edited', 'reopened', 'failed', 'retried', 'interrupted', 'cancelled', 'completed'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

export interface HistoryEntry {
  at: string;
  type: HistoryType;
  stage: string | null;
  /** An agent id, "person" or "app". */
  by: string;
  detail: string | null;
}

export const COMMENT_TARGETS = ['issue', 'mr'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];
export const COMMENT_STATUSES = ['draft', 'proposed', 'published', 'refused', 'removed'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
/** The key of the pull request's comment in `Run.comments`; the other keys are stage ids. */
export const PR_COMMENT = 'pr';

/** What a run knows about the tracker comment of a stage (or of the pull request): enough to edit it in place instead of posting another. */
export interface CommentRecord {
  target: CommentTarget;
  /** The id the host returned when the comment was published; null until then. */
  noteId: string | number | null;
  url: string | null;
  /** Hash of the body last proposed or published, to tell whether an edit changes anything. */
  bodyHash: string | null;
  status: CommentStatus;
  updatedAt: string;
  /** The text last written for it, as it goes (or went) to the tracker: what Actions shows for a proposal and what a deferred comment posts later. */
  body?: string | null;
  /** The first line of the body (its status): what tells that an edit changed what the comment says. */
  headline?: string | null;
  /** The pull request's title, for the `pr` record. */
  title?: string | null;
}

/** What a transition may record about a comment besides where it stands. */
export interface CommentDetails {
  body?: string;
  headline?: string;
  title?: string;
}

/** What a non-autonomous agent finished and the person has not accepted yet. */
export interface PendingResult {
  /** done: the stage's work is complete. return: the agent hands the work back to an earlier stage (review findings, or a hand back). */
  kind: 'done' | 'return';
  /** The agent id. */
  by: string;
  /** The findings (for a return); empty for done. */
  text: string;
  /** What the next stage (or the one handed back to) is to do. */
  handoff: string;
  /** The stage the work goes back to; null for done. */
  toStage: string | null;
  /** The return is a review pass: it counts toward the limit. */
  countRound: boolean;
  /** The question the person gets when this return reaches the limit, written from the rounds' records; absent: the findings as text. */
  limit?: string;
}

export const SEVERITIES = ['blocking', 'suggestion'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One point of a review, as the reviewer gave it: where it is, how much it matters and what to do. The tracker comments are built from these. */
export interface Finding {
  /** File path relative to the repository root. */
  path: string;
  /** First line it is about, 1-based; null for a finding about the whole file. */
  line: number | null;
  /** Last line of a range; null for a single line. */
  endLine: number | null;
  /** new: the code after the change; old: a line the change removes. */
  side: 'new' | 'old';
  severity: Severity;
  body: string;
  /** A complete replacement for exactly the lines named, when the fix is that concrete; null otherwise. */
  suggestion: string | null;
}

export const VERDICTS = ['approved', 'changes'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One review pass of the reviewer agent. */
export interface ReviewRecord {
  /** 1 for the first pass of the run. */
  round: number;
  stage: string;
  by: string;
  at: string;
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  /** The commit the pass looked at (the diff positions are those of this commit); null when the branch has none yet. */
  head: string | null;
}

export const SCENARIO_RESULTS = ['pass', 'fail', 'not-run'] as const;
export type ScenarioResult = (typeof SCENARIO_RESULTS)[number];

/** Whether a failed scenario sends the work back (`blocking`) or is only reported (`non-blocking`). A scenario recorded before the field existed blocks. */
export const SCENARIO_SEVERITIES = ['blocking', 'non-blocking'] as const;
export type ScenarioSeverity = (typeof SCENARIO_SEVERITIES)[number];

/** What a QA scenario rests on: the agent ran something in its sandbox to check it (`executed`), or only looked at code, documents and results (`read`). */
export const SCENARIO_EVIDENCE = ['executed', 'read'] as const;
export type ScenarioEvidence = (typeof SCENARIO_EVIDENCE)[number];

export interface Scenario {
  name: string;
  result: ScenarioResult;
  detail: string;
  severity?: ScenarioSeverity;
  /** Absent in a pass recorded before the field existed (it was read, as nothing could be run). */
  evidence?: ScenarioEvidence;
  /** The agent claimed `executed` and the app found nothing of the stage's commands behind it: it is recorded as `read` and labelled. */
  unbacked?: boolean;
  /** The numbers (in the stage's command list) of the commands an `executed` scenario rests on. */
  commands?: number[];
}

/** What the QA agent checked. */
export interface QaRecord {
  stage: string;
  by: string;
  at: string;
  summary: string;
  scenarios: Scenario[];
  head: string | null;
  /** The commands the app ran in the worktree before this pass, with how each ended. Absent in a pass recorded before the app ran any. */
  commands?: QaCommand[];
}

/** One command the app ran for a QA pass: the exit code (null when it did not run to one) and whether it was stopped for taking too long. The output is not kept. */
export interface QaCommand {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Its number in the stage's list, when the stage ran in a sandbox (the app's own commands first, then the agent's). */
  n?: number;
  /** Who ran it, in that case. */
  by?: 'app' | 'agent';
  /** The command could not be started (not found, not executable): not a result of the code, and not a pass. Absent in a pass recorded before it was told apart. */
  notRun?: boolean;
}

export interface RunIssue {
  /** As the cards write it ("app#101" or "101"): what identifies the issue for "one run at a time". */
  ref: string;
  iid: number;
  title: string;
  url: string | null;
}

/** Why the scope rules did not pick a squad for an issue: more than one matched, or none did. */
export const ROUTING_WHY = ['several', 'none'] as const;
export type RoutingWhy = (typeof ROUTING_WHY)[number];

/** The rules of a squad's scope, in the order they narrow the squads. */
export const SCOPE_RULES = ['repo', 'label', 'path', 'unclaimed'] as const;
export type ScopeRule = (typeof SCOPE_RULES)[number];

/** How a run came to be in its squad: by the scope rules (and which one), by the front door's proposal, by the person, or because another squad asked for it. */
export const ROUTED_BY = [...SCOPE_RULES, 'agent', 'person', 'request'] as const;
export type RoutedBy = (typeof ROUTED_BY)[number];

/** A run linked to another: `requested` (this run asked another squad for something and waits for it) or `origin` (this run exists because another squad asked). */
export const LINK_ROLES = ['requested', 'origin'] as const;
export type LinkRole = (typeof LINK_ROLES)[number];
export const LINK_KINDS = ['question', 'change'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
/** proposed: the issue waits for a "yes" in Actions. open: the other run exists and is not over. done: it ended (or its issue was closed). refused: it will not exist. */
export const LINK_STATUSES = ['proposed', 'open', 'done', 'refused'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export interface RunLink {
  /** Unique in the run: what an update names. */
  key: string;
  role: LinkRole;
  kind: LinkKind;
  /** The other squad, by id. */
  squad: string | null;
  /** The other run, once it exists. */
  run: string | null;
  /** The issue of the other run ("app#102"), once it exists. */
  issue: string | null;
  /** What was asked, in a line: the title of the issue it became. */
  title: string;
  status: LinkStatus;
  at: string;
}

/**
 * A run whose squad is not decided yet: the scope rules left several squads (or none), so the run starts in the workspace's flow at its front door, whose
 * agent proposes the squad as part of its answer; the run goes on in the squad when that agent runs by itself, and waits for the person's choice otherwise.
 */
export interface RoutingState {
  /** The squads the issue may belong to: those the scope rules could not tell apart, or every squad when none matched. */
  candidates: string[];
  why: RoutingWhy;
  /** The squad the front-door agent proposed, once it did. */
  proposal: { squad: string; by: string; reason: string } | null;
  /** What the front door produced when it ended, held until the squad is chosen: the run goes on from it in the squad's flow. */
  result: { by: string; summary: string; handoff: string; artifacts: string[] } | null;
}

/** One activity of a release: a pull request that goes into (or was merged into) the release branch, as the run last read it. */
export interface ReleaseActivity {
  /** The pull request's number. */
  pr: number;
  title: string;
  url: string;
  /** The commit it was at when the run read it. */
  head: string;
  /** open, merged or closed on the host. */
  state: 'open' | 'merged' | 'closed';
  /** The host's approval (and, when it has checks, their result) when it was read. */
  approved: boolean;
  /**
   * Not approved, but the workspace says the person is the repository's only maintainer and this open pull request is theirs (opened by the account the app uses on the
   * host, no changes asked, not a draft, checks passing): ready to merge on their "sim" in Actions, which stands for the review. Absent: no.
   */
  selfReview?: boolean;
  /** The issue it closes, when the host says so. */
  issue: number | null;
}

/**
 * What a run is about when it is not one issue: a release of a version (`kind: 'release'`). Such a run has a synthesized `issue` (`release:X.Y.Z`, number 0) that
 * keeps "one run at a time" working, a tracking issue on the tracker (`tracking`, once it exists), and the activities of the version as last read. A run with no
 * subject is an issue run, as before.
 */
export interface RunSubject {
  kind: 'release';
  /** `X.Y.Z`. */
  version: string;
  /** The stable tag a patch is cut from (`vA.B.C`); null for a version cut from main. */
  from: string | null;
  /** The issue "Release X.Y.Z" on the tracker: the stage comments go there; `closed` once the app closed it (the stable was published). Null until it exists (it may wait for a "yes" in Actions). */
  tracking: { iid: number; url: string | null; closed?: boolean } | null;
  /** The pull requests of the version, as the run last read them (the plan's list; the waits and the tracking issue's list are worked out from them). */
  activities: ReleaseActivity[];
  /**
   * The head of each pull request (by number) as the run had read it when it ENTERED the plan gate, the commits the person is shown there. Taken once on entry and never
   * rewritten by a later read of the host (`activities` is, every sweep): a push made during the wait is therefore not in it. Absent until the plan gate is first entered.
   */
  seen?: Record<string, string>;
  /**
   * The head of each pull request (by number) the person accepted with the plan: a copy of `seen` made by the gate at its first gate: the only commits a `merge-pr` may bring in.
   * Absent until that gate is accepted. A pull request added, or pushed to, after it needs a new plan.
   */
  planned?: Record<string, string>;
}

export interface Run {
  version: typeof RUN_VERSION;
  /** Grows by one on every save of the store. */
  rev: number;
  id: string;
  issue: RunIssue;
  /** A `projects.repos` id. */
  repo: string;
  branch: string;
  /** Absolute path of the run's worktree. */
  worktree: string;
  /** Folder of the cycle documents, relative to the worktree (docs/cycles/<n>-<slug>). */
  cycleFolder: string;
  /** The template the run follows. */
  cycleId: string;
  status: RunStatus;
  /** The stage the run is in. */
  stage: string;
  /** One record per stage the run has entered, in the order first entered. */
  stages: StageRecord[];
  question: PendingQuestion | null;
  /** The command the working stage waits for the person to allow (`shell: host`). Filled in by the runner when it hands a run out, never written to the file. */
  command?: PendingCommand | null;
  /** The result of a non-autonomous agent, waiting for the person (status `to-accept`). */
  pending: PendingResult | null;
  /** How many times each stage sent the work back (by the stage that sent it: review and QA have a budget each) since the person last answered the limit's question. */
  returns: Record<string, number>;
  /** What the run waits for while its status is `waiting`; null otherwise. */
  wait: WaitState | null;
  /** The squad the run works in (a `squads` id); absent or null: no squad, the run follows the workspace's flow with the whole team. */
  squad?: string | null;
  /** How the run came to be in its squad; absent when it has none. */
  routedBy?: RoutedBy | null;
  /** Set while the squad is not decided (see `RoutingState`); null or absent once it is, and for a workspace with no squads. */
  routing?: RoutingState | null;
  /** The runs this one asked something of (and may wait for), and the run it was made for, when another squad's request made it. */
  links?: RunLink[];
  /**
   * The flow the run started with, and keeps following when the cycle is edited afterwards (`runs:migrateFlow` moves it to the current one). Absent in a run
   * written before flows were copied: it follows the current flow.
   */
  flow?: FlowSnapshot;
  error: RunFailure | null;
  history: HistoryEntry[];
  /** The tracker comments of this run, by stage id (and `pr`). The record is where publishing keeps what it needs to edit a comment in place. */
  comments: Record<string, CommentRecord>;
  /** Every review pass, in order, with its findings as given: what the tracker's line comments are built from. */
  reviews: ReviewRecord[];
  /** Every QA pass, with its scenarios. */
  qa: QaRecord[];
  /** The commit the branch was cut from; what the review's diff starts at. Null for a run made before it was recorded. */
  base: string | null;
  /** What the run is about when it is not an issue: a release. Absent for an issue run. */
  subject?: RunSubject;
  /** The run drafts the documentation of its repository. Absent for an issue run. */
  docs?: RunDocs;
  createdAt: string;
  updatedAt: string;
}

/**
 * A run that drafts or updates the documentation of a repository (`.coxia/`): it starts from a repository and not from an issue (its `issue` is the synthesized
 * `docs:<repo>`, number 0, which keeps "one at a time" per repository), writes only inside `.coxia/` and ends in a pull request that closes nothing. A run with no
 * `docs` is an issue run (or a release run: see `subject`).
 */
export interface RunDocs {
  mode: 'create' | 'update';
}

/** What a run in status `waiting` waits for, and since when. */
export interface WaitState {
  kind: WaitKind;
  label?: string;
  minutes?: number;
  since: string;
  /** The agent that asked the reporter, when an agent's question (not a wait stage) is what the run waits on; the stage goes on with that agent when the reply comes. */
  by?: string;
  /** For `budget`: the provider whose key ran out of budget, as the workspace names it in `llm.providers`. */
  provider?: string;
  /** For `budget`: the reason in words, with the provider's own (already masked) text. */
  detail?: string;
}

/** A stage of the flow a run follows, resolved from the config: every default filled in. */
export interface FlowStage {
  id: string;
  label: string;
  /** What the stage means to the ceremonies; it also says how an agent's answer is read (a review finds, QA verifies). */
  kind: StageKind;
  type: StageType;
  /** The agent id that works it; null for a gate, a wait, and an end stage that has no agent. */
  agent: string | null;
  /** The agent runs by itself (`AgentDef.autonomous`); false when there is no agent. */
  autonomous: boolean;
  /** The files the stage must produce. */
  artifacts: string[];
  /** The artifacts the stage is given; null: every earlier one. */
  reads: string[] | null;
  /** The stage that follows; null: the run ends after this one. */
  next: string | null;
  /** Where the work goes back to; null when there is no work stage before. */
  returnsTo: string | null;
  roundLimit: number;
  waitsFor: WaitFor | null;
  /** The key of its comment template in `devCycle.comments`; null: none. */
  comment: string | null;
  trackerStatus: string | null;
}

/** The flow a run follows: a copy of its stages and a short hash that says which version it is. */
export interface FlowSnapshot {
  hash: string;
  stages: FlowStage[];
}

/** What a move produces: the run as it is now, and what the forum is to record about it, in order. */
export interface Transition {
  run: Run;
  messages: ForumDraft[];
}

export const isTerminal = (r: Pick<Run, 'status'>): boolean => r.status === 'done' || r.status === 'cancelled';
