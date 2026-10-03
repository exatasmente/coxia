import type { ForumDraft } from '../forum';

// A run: one issue going through the agent cycle. This file is the shape; the moves are in transitions.ts, the file format check in schema.ts.

export const RUN_VERSION = 1;
/** Review passes that may end in findings before the run stops and asks the person. */
export const MAX_REVIEW_ROUNDS = 2;
export const RUN_ID = /^r-[a-z0-9]{1,12}-[a-z0-9]{2,8}$/;

/**
 * working: an agent works `stage`. gate: the person decides. question: waiting for an answer. failed: waiting for a retry or a cancel.
 * to-start: the stage's agent is not autonomous, so the stage waits for the person to start it.
 * to-accept: that agent finished, and its result waits for the person to accept it (or send it back with a note).
 */
export const RUN_STATUSES = ['working', 'gate', 'question', 'failed', 'to-start', 'to-accept', 'done', 'cancelled'] as const;
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
}

export const QUESTION_KINDS = ['agent', 'review-limit'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export interface PendingQuestion {
  /** The agent id that asked, or "app". */
  by: string;
  kind: QuestionKind;
  text: string;
  askedAt: string;
  stage: string;
}

export interface RunFailure {
  code: 'no-agent' | 'stage-failed';
  stage: string;
  detail: string | null;
}

export const HISTORY_TYPES = ['comment', 'started', 'stage-waiting', 'stage-ready', 'stage-accepted', 'stage-returned', 'stage-started', 'stage-done', 'gate-approved', 'gate-rejected', 'gate-skipped', 'question', 'answer', 'handback', 'failed', 'retried', 'interrupted', 'cancelled', 'completed'] as const;
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
export const COMMENT_STATUSES = ['draft', 'proposed', 'published', 'refused'] as const;
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
}

export interface RunIssue {
  /** As the cards write it ("app#101" or "101"): what identifies the issue for "one run at a time". */
  ref: string;
  iid: number;
  title: string;
  url: string | null;
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
  /** The result of a non-autonomous agent, waiting for the person (status `to-accept`). */
  pending: PendingResult | null;
  review: { rounds: number; max: number };
  error: RunFailure | null;
  history: HistoryEntry[];
  /** The tracker comments of this run, by stage id (and `pr`). Nothing is published in this change: the record is where phase 2 keeps what it needs. */
  comments: Record<string, CommentRecord>;
  createdAt: string;
  updatedAt: string;
}

/** A stage of the flow a run follows, resolved from the config. */
export interface FlowStage {
  id: string;
  label: string;
  /** A gate: waits for the person. */
  human: boolean;
  /** The agent id that works it; null for a gate and for the last stage. */
  agent: string | null;
  /** The agent runs by itself (`AgentDef.autonomous`); false for a gate and the last stage. */
  autonomous: boolean;
  artifacts: string[];
}

/** What a move produces: the run as it is now, and what the forum is to record about it, in order. */
export interface Transition {
  run: Run;
  messages: ForumDraft[];
}

export const isTerminal = (r: Pick<Run, 'status'>): boolean => r.status === 'done' || r.status === 'cancelled';
