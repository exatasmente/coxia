export interface SpecInfo {
  folder: string;
  phase: string;
  planFile: string | null;
}

/** The tracker's priority of an issue, read through devCycle.priority: rank 0 is the highest configured level, label is the issue's own label. */
export interface CardPriority {
  rank: number;
  label: string;
}

export interface Card {
  ref: string;
  iid: string;
  title: string;
  stage: string | null;
  spec: SpecInfo | null;
  mrs: string[];
  mrPaths: { ref: string; project: string; iid: number }[];
  // Refs of the MRs the card source says conflict with their target; absent on a card from a source that only has the blocker text.
  mrConflicts?: string[];
  blockers: string[];
  pending: string[];
  changes: string[];
  note: string | null;
  url: string;
  // The tracker's own data, absent on a card saved before it was carried, or from a card source that does not report it.
  labels?: string[];
  milestone?: string | null;
  // ISO time of the issue's last update.
  updatedAt?: string | null;
  // The project the issue lives in, needed to write a label back.
  project?: string;
  priority?: CardPriority | null;
}

export interface CardsResult {
  generatedAt: string;
  total: number;
  cards: Card[];
  // The cards that did not fit the call, in the same order; `total` counts these too.
  rest?: Card[];
}

export type VoiceEngine = 'edge' | 'kokoro';

export interface Voice {
  voice: string;
  rate: string;
  pitch: string;
  label: string;
  // Absent means 'edge'. Kokoro has no pitch, so agents differ by voice and speed.
  engine?: VoiceEngine;
  speed?: number;
}

// One sentence of a planned speech, with everything the engine needs to synthesize it.
export interface SpeechSegment {
  text: string;
  engine: VoiceEngine;
  voice: string;
  rate: string;
  pitch: string;
  speed: number;
  // silence after this sentence
  pauseMs: number;
}

export interface AgentTurn {
  ref: string;
  sessionId: string | null;
  speech: string;
  did: string;
  next: string;
  blocker: string | null;
  question: string | null;
  // Ready-made replies the person can tap instead of speaking (absent on turns saved before they existed).
  options?: string[];
  // Set when the card did not change and the turn of an earlier day was served again, without calling the agent.
  reused?: { at: string };
  // What the card looked like when this turn was prepared; the next meeting of the day compares against it.
  seen?: CardSeen;
  // Set when the card was already covered in an earlier meeting of the same day.
  sameDay?: SameDayInfo;
}

// The part of a card the agent is told about, kept with the turn so a later meeting of the day can say what moved since.
export interface CardSeen {
  at: string;
  fp: string;
  stage: string | null;
  blockers: string[];
  pending: string[];
  mrs: string[];
  changes: string[];
  note: string | null;
  phase: string | null;
  artifacts: [string, number][];
}

export interface SameDayInfo {
  kind: 'unchanged' | 'changed';
  // When the earlier meeting's turn for this card was prepared (ISO).
  since: string;
  // Version of the day's minutes the earlier meeting became, when it has one.
  version: number | null;
  // What moved since, already worded for the person (changed only).
  changes: string[];
  // What the earlier meetings of the day decided about this card.
  decided: string[];
  // The card did not change but the person asked to go deeper, so the agent was called anyway.
  deepened?: boolean;
}

// ceremonyId: the meeting being held (earlier meetings of the day are the ones before it); deepen: the person asked to go deeper on a card that did not change.
export interface TurnOptions {
  ceremonyId?: string;
  deepen?: boolean;
}

// A ceremony saved before the card note had its own name holds another value for it: anything that is not 'spec' or 'ata' reads as a note.
// 'priority' is a change of the tracker's priority label: it is always in the minutes and, when the workspace can write it, also a proposal in Actions.
export type DecisionTarget = 'spec' | 'note' | 'ata' | 'priority';

/** Why a priority decision is not written to the tracker (it stays in the minutes). */
export type PriorityNoWrite = 'unconfigured' | 'unmapped' | 'same' | 'unidentified' | 'unsupported';

/** What a priority decision means for the tracker, resolved against the workspace's priority labels when it was taken. */
export interface PriorityChange {
  // What the person asked for: "first", "later", or one of the configured labels.
  to: string;
  // The priority label the card had (null: none).
  from: string | null;
  // The priority label the card ends up with (null when the request does not map to one).
  label: string | null;
  // What to change on the issue: the label to put on (null when it already has it) and the priority labels to take off.
  add: string | null;
  remove: string[];
  // The reason nothing is written; null when a label change can be proposed.
  noWrite: PriorityNoWrite | null;
  // The issue to change.
  project: string | null;
  iid: number | null;
  title: string;
}

export interface Decision {
  ref: string;
  text: string;
  target: DecisionTarget;
  dest: string;
  // Only on a decision of target 'priority'.
  priority?: PriorityChange;
}

export interface Effect {
  ref: string;
  text: string;
  repo: string;
}

export interface ReplyResult {
  ack: string;
  decision: Decision | null;
  // A change of priority the person asked for, as a decision of target 'priority'.
  priority?: Decision | null;
  effect: Effect | null;
  needsDeepDive: boolean;
  options?: string[];
}

export interface DeepAnswer {
  sessionId: string;
  // what the voice says; text is what the chat shows (may carry lists and mermaid diagrams)
  speech: string;
  text: string;
  sources: string[];
  partial?: boolean;
}

export interface DeepOption {
  title: string;
  consequence: string;
  effect: string | null;
  decision: string;
  recommended: boolean;
}

export interface Minutes {
  /** The squad the ceremony was held for (its runs and cards only); null or absent: the whole workspace. */
  squad?: string | null;
  startedAt: string;
  endedAt: string;
  decisions: Decision[];
  effects: Effect[];
  unanswered: { ref: string; question: string }[];
  transcript: { who: string; text: string; at: string }[];
}

export interface WrittenDecision {
  ref: string;
  dest: string;
  ok: boolean;
  detail: string;
  // The decision text, so a later version of the day can tell it was already written.
  text?: string;
  // Set when an earlier version of the day (or the document itself) already had this decision and nothing was written again.
  duplicateOf?: number | 'document';
  // Where it went: the plan's decision log, the card note, or only the minutes.
  target?: DecisionTarget;
}

export interface SaveResult {
  ataPath: string;
  written: WrittenDecision[];
  // Which version of the day's minutes this saved (absent in results saved before versions existed).
  version?: number;
}

export interface LogLine {
  who: string;
  text: string;
  at: string;
  color: string;
}

export interface DeepState {
  sessionId: string | null;
  msgs: Talk[];
  sources: string[];
  options: DeepOption[] | null;
  pick: number | null;
  saved: boolean;
}

export interface SavedCeremony {
  version: 1;
  id: string;
  /** The squad the ceremony is held for; null or absent: the whole workspace. */
  squad?: string | null;
  kind: 'pre-daily';
  date: string;
  cards: CardsResult | null;
  turns: Record<string, AgentTurn>;
  decisions: Decision[];
  effects: Effect[];
  answered: Record<string, boolean>;
  log: LogLine[];
  startedAt: number | null;
  endedAt: number | null;
  callIdx: number;
  callEnded: boolean;
  spoken: Record<string, boolean>;
  deep: Record<string, DeepState>;
  teams: string | null;
  teamsKey: string | null;
  saveResult: SaveResult | null;
}

export interface HistoryEntry {
  id: string;
  kind: 'pre-daily';
  /** The squad it was held for; null: the whole workspace. */
  squad?: string | null;
  date: string;
  startedAt: number | null;
  endedAt: number | null;
  activities: number;
  decisions: number;
  effects: number;
  unanswered: number;
  deepDives: number;
  ataSaved: boolean;
  // Version of the day's minutes this ceremony is (null: the call never started, so it has none).
  version: number | null;
  // The call was left unfinished: it cannot be deleted until it ends.
  live: boolean;
}

export interface GateOption {
  gate: 1 | 2;
  label: string;
  file: string;
}

export interface GateQuestionView {
  text: string;
  kind: string;
  options: string[];
  answer: { choice: number | null; other: string | null; correct: boolean; comment: string } | null;
  // Only after the whole round is answered:
  correct: number | null;
  section: string | null;
  explanation: string | null;
}

export interface GateRoundView {
  questions: GateQuestionView[];
  // i18n-ignore: a verdict code the screens compare
  verdict: 'assertivo' | 'não assertivo' | null;
  visual: { mermaid: string; heading: string; description: string; inserted: boolean } | null;
}

export interface GateView {
  id: string;
  ref: string;
  iid: string;
  title: string;
  gate: 1 | 2;
  label: string;
  artifact: string;
  quizFile: string;
  summary: string;
  sessionId: string | null;
  rounds: GateRoundView[];
  talk: Talk[];
  recorded: string | null;
}

export interface Talk {
  me: boolean;
  text: string;
  at: string;
  // spoken version of an agent message; absent on old messages and on the user's own
  speech?: string;
  // The agent ran out of turns and answered from what it had read: the bubble says so.
  partial?: boolean;
}

export interface QaHandoff {
  id: string;
  ref: string;
  iid: string;
  title: string;
  stage: string | null;
  sessionId: string | null;
  speech: string;
  changed: string;
  checklist: { title: string; items: string[] }[];
  risks: string[];
  environment: string;
  teams: string;
  checklistFile: string;
  checklistExists: boolean;
  written: string | null;
  talk: Talk[];
  createdAt: string;
}

export interface RetroItem {
  title: string;
  evidence: string;
}

export interface Retro {
  /** Its date; a retro held for one squad has the squad after it ("2026-10-02-core"). */
  id: string;
  /** The squad it was held for; null or absent: the whole workspace. */
  squad?: string | null;
  from: string;
  to: string;
  sessionId: string | null;
  speech: string;
  numbers: { label: string; value: string }[];
  worked: RetroItem[];
  stuck: RetroItem[];
  rework: RetroItem[];
  talk: Talk[];
  createdAt: string;
}

// A write to the code host (GitLab, GitHub or Bitbucket) proposed by a module and run only after "seguir" + confirmation.
export interface VcsCommand {
  /** Which provider validates and runs it. Absent in actions saved before providers existed: GitLab. */
  vcs?: 'gitlab' | 'github' | 'bitbucket';
  via: 'glab' | 'curl' | 'gh' | 'api';
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  fields: Record<string, string>;
  /** Request body as JSON text, for the providers that take one (GitHub and Bitbucket). */
  json?: string;
}

/** The name the type had when GitLab was the only host. */
export type GitlabCommand = VcsCommand;

// 'gitlab' is a write to GitLab (what every action saved before providers existed is); 'vcs' a write to GitHub or Bitbucket.
// 'run-push' is the push of a run's branch (the runner proposes it; it always waits for its own "sim").
// 'release-git' is one step of a release (open the branch, merge a pull request into it, cut a beta or the stable, push the branch or a tag): its `unit` is a
// `ReleaseUnit` (shared/release.ts) and nothing else.
export type ActionKind = 'sync' | 'qa-comment' | 'conflict' | 'conflict-push' | 'gitlab' | 'vcs' | 'run-push' | 'release-git';
export type ActionState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface ReleaseAction {
  id: string;
  key: string;
  kind: ActionKind;
  issue: number;
  issueTitle: string;
  stage: string;
  release: string | null;
  mrs: { ref: string; url: string; branch: string; behind: number }[];
  files: string[];
  retest: boolean;
  state: ActionState;
  createdAt: string;
  finishedAt: string | null;
  output: string | null;
  noteId: number | null;
  currentBody: string | null;
  proposedBody: string | null;
  sessionId: string | null;
  msgs: Talk[];
  unit: Record<string, unknown> | null;
  summary: string | null;
  command: VcsCommand | null;
  /** A group of writes that belong together (a review round: its comments, replies and verdict) and wait for one "sim"; `command` is the first. Absent for a single write. */
  commands?: VcsCommand[];
  /** How many of `commands` already ran: a retry after a failure goes on from there instead of posting the first ones again. */
  done?: number;
  // Release conflicts only: the in-app resolution (worktree, hunks, verification, push). Absent in files saved before it existed.
  resolve?: import('./conflict').ConflictResolve | null;
}

export type AppEvent =
  | { type: 'navigate'; to: 'today' | 'call' | 'settings' | 'history' | 'actions' | 'retro' }
  | { type: 'conflict'; id: string }
  | { type: 'actions'; actions: ReleaseAction[] }
  | { type: 'open'; screen: { name: string; [key: string]: unknown } }
  | { type: 'module'; name: string; payload: unknown }
  | { type: 'deep'; card: Card }
  | { type: 'status'; result: CardsResult; checkedAt: string }
  // every window and browser follows a settings change made in any of them
  | { type: 'settings'; settings: import('./settings').Settings };

export interface Api {
  // Generic channel for modules: each one keeps its typed wrapper next to its screen.
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  loadState(): Promise<SavedCeremony | null>;
  saveState(state: SavedCeremony): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  getHistory(id: string): Promise<SavedCeremony | null>;
  /** `squad`: only the cards of that squad (its runs and the issues its scope claims); absent or null: the whole workspace. */
  loadCards(limit: number, refresh?: boolean, squad?: string | null): Promise<CardsResult>;
  prepareTurn(card: Card, options?: TurnOptions): Promise<AgentTurn>;
  reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult>;
  deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer>;
  deepOptions(card: Card, sessionId: string): Promise<DeepOption[]>;
  teamsText(minutes: Minutes, cards: Card[]): Promise<string>;
  saveMinutes(minutes: Minutes, teams: string, selected: number[], ceremonyId?: string): Promise<SaveResult>;
  planSpeech(text: string, voice: Voice): Promise<SpeechSegment[]>;
  speakSegment(token: string, segment: SpeechSegment): Promise<ArrayBuffer>;
  cancelSpeech(token: string): Promise<void>;
  transcribe(audio: ArrayBuffer): Promise<string>;
  voices(): Promise<{ moderator: Voice; agents: Voice[] }>;
  copy(text: string): Promise<void>;
  getSettings(): Promise<import('./settings').Settings>;
  saveSettings(settings: import('./settings').Settings): Promise<import('./settings').Settings>;
  continueInClaude(sessionId: string, prompt?: string): Promise<{ ok: boolean; command: string }>;
  checkStatus(): Promise<string>;
  listActions(): Promise<ReleaseAction[]>;
  detectRelease(): Promise<string>;
  previewAction(id: string): Promise<string>;
  approveAction(id: string): Promise<ReleaseAction>;
  skipAction(id: string): Promise<ReleaseAction>;
  conflictAsk(id: string, question: string): Promise<ReleaseAction>;
  conflictFromMr(card: Card, ref: string): Promise<ReleaseAction>;
  conflictPrepare(id: string): Promise<ReleaseAction>;
  conflictPropose(id: string): Promise<ReleaseAction>;
  conflictChoose(id: string, hunkId: string, choice: import('./conflict').HunkChoice, edited?: string): Promise<ReleaseAction>;
  conflictApply(id: string, options: { skipTests: boolean }): Promise<ReleaseAction>;
  conflictCommit(id: string): Promise<ReleaseAction>;
  conflictReopen(id: string): Promise<ReleaseAction>;
  conflictDiscard(id: string): Promise<ReleaseAction>;
  gateOptions(card: Card): Promise<GateOption[]>;
  startGate(card: Card, gate: 1 | 2): Promise<GateView>;
  getGate(id: string): Promise<GateView | null>;
  answerGate(id: string, question: number, input: { choice?: number; text?: string }): Promise<GateView>;
  explainGate(id: string, question: string): Promise<GateView>;
  visualGate(id: string): Promise<GateView>;
  insertGateVisual(id: string): Promise<GateView>;
  newGateRound(id: string): Promise<GateView>;
  recordGate(id: string): Promise<GateView>;
  prepareQa(card: Card): Promise<QaHandoff>;
  getQa(iid: string): Promise<QaHandoff | null>;
  askQa(iid: string, question: string): Promise<QaHandoff>;
  writeQaChecklist(iid: string): Promise<QaHandoff>;
  /** `squad`: the retro of one squad (its ceremonies and its runs' issues); absent or null: the whole workspace. */
  prepareRetro(squad?: string | null): Promise<Retro>;
  latestRetro(squad?: string | null): Promise<Retro | null>;
  askRetro(id: string, question: string): Promise<Retro>;
  onEvent(cb: (event: AppEvent) => void): () => void;
}
