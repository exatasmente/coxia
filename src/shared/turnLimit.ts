// The question an agent or a sub-agent leaves when it uses its last turn: what it looks like on the wire. The work waits in memory for the person's answer, so the record
// is never written to the run's file or to disk; only the list of the waiting ones travels, whole, on a module event. Pure: shared by the main process, the screens and the tests.

/** The module event carrying the questions that wait for the person, the whole list each time. */
export const TURN_ASKS_EVENT = 'turn-asks';

/** The two answers: another round of the same size, or end the work now with what it has. There is no third and no free text. */
export const TURN_DECISIONS = ['continue', 'finish'] as const;
export type TurnDecision = (typeof TURN_DECISIONS)[number];

export const isTurnDecision = (v: unknown): v is TurnDecision => typeof v === 'string' && (TURN_DECISIONS as readonly string[]).includes(v);

/** Who gave the answer. A third value is the persona of a later issue; nothing here produces it. */
export type TurnAnswerer = 'window' | 'paired';

export interface PendingTurnAsk {
  id: string;
  /** `stage`: the agent of the stage used its last turn. `sub`: a sub-agent it started did. */
  of: 'stage' | 'sub';
  /** The run the work belongs to; null for an answer in a conversation outside a run. */
  run: string | null;
  /** The conversation whose lines say it (`run-<id>` for a run). */
  thread: string;
  /** The run's issue reference, null outside a run. */
  ref: string | null;
  /** For the audit line only. */
  issue?: number;
  stage: string | null;
  /** The agent's id. */
  agent: string;
  /** The name the team gives it. */
  name: string;
  /** `explore`, `edit`, `shell` or `screen`; null for a plain sub-agent and for a stage. */
  kind: string | null;
  /** What the sub-agent was asked to do, masked and clipped like an activity line; empty for a stage. */
  task: string;
  /** Turns used so far. */
  used: number;
  /** Turns "continue" adds. */
  round: number;
  /** Rounds already granted. */
  granted: number;
  /** False only where the engine cannot go on past its limit (the Claude engine, if it turns out not to). */
  canContinue: boolean;
  /** ISO time the question was left. */
  since: string;
}

/** What a caller files: the store gives it the id and the time. */
export type TurnAskInput = Omit<PendingTurnAsk, 'id' | 'since'>;

/** `gone`: the question no longer waits (answered, or the work ended). `decision`: not one of the two, or `continue` where the engine cannot. */
export type TurnAnswerResult = { ok: true } | { ok: false; reason: 'gone' | 'decision' };
