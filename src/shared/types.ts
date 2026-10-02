export interface SpecInfo {
  folder: string;
  phase: string;
  planFile: string | null;
}

export interface Card {
  ref: string;
  iid: string;
  title: string;
  stage: string | null;
  spec: SpecInfo | null;
  mrs: string[];
  mrPaths: { ref: string; project: string; iid: number }[];
  blockers: string[];
  pending: string[];
  changes: string[];
  note: string | null;
  url: string;
}

export interface CardsResult {
  generatedAt: string;
  total: number;
  cards: Card[];
}

export interface Voice {
  voice: string;
  rate: string;
  pitch: string;
  label: string;
}

export interface AgentTurn {
  ref: string;
  sessionId: string | null;
  speech: string;
  did: string;
  next: string;
  blocker: string | null;
  question: string | null;
}

export type DecisionTarget = 'spec' | 'daily-report' | 'ata';

export interface Decision {
  ref: string;
  text: string;
  target: DecisionTarget;
  dest: string;
}

export interface Effect {
  ref: string;
  text: string;
  repo: string;
}

export interface ReplyResult {
  ack: string;
  decision: Decision | null;
  effect: Effect | null;
  needsDeepDive: boolean;
}

export interface DeepAnswer {
  sessionId: string;
  speech: string;
  sources: string[];
}

export interface DeepOption {
  title: string;
  consequence: string;
  effect: string | null;
  decision: string;
  recommended: boolean;
}

export interface Minutes {
  startedAt: string;
  endedAt: string;
  decisions: Decision[];
  effects: Effect[];
  unanswered: { ref: string; question: string }[];
  transcript: { who: string; text: string; at: string }[];
}

export interface SaveResult {
  ataPath: string;
  written: { ref: string; dest: string; ok: boolean; detail: string }[];
}

export interface LogLine {
  who: string;
  text: string;
  at: string;
  color: string;
}

export interface DeepState {
  sessionId: string | null;
  msgs: { me: boolean; text: string; at: string }[];
  sources: string[];
  options: DeepOption[] | null;
  pick: number | null;
  saved: boolean;
}

export interface SavedCeremony {
  version: 1;
  id: string;
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
  date: string;
  startedAt: number | null;
  endedAt: number | null;
  activities: number;
  decisions: number;
  effects: number;
  unanswered: number;
  deepDives: number;
  ataSaved: boolean;
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
  talk: { me: boolean; text: string; at: string }[];
  recorded: string | null;
}

export interface Talk {
  me: boolean;
  text: string;
  at: string;
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

export interface Improvement {
  title: string;
  dimension: string;
  problem: string;
  proposal: string;
}

export interface Retro {
  id: string;
  from: string;
  to: string;
  sessionId: string | null;
  speech: string;
  numbers: { label: string; value: string }[];
  worked: RetroItem[];
  stuck: RetroItem[];
  rework: RetroItem[];
  improvements: Improvement[];
  talk: Talk[];
  createdAt: string;
}

// A GitLab write proposed by a module and run only after "seguir" + confirmation.
export interface GitlabCommand {
  via: 'glab' | 'curl';
  method: 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  fields: Record<string, string>;
}

export type ActionKind = 'sync' | 'qa-comment' | 'conflict' | 'gitlab';
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
  msgs: { me: boolean; text: string; at: string }[];
  unit: Record<string, unknown> | null;
  summary: string | null;
  command: GitlabCommand | null;
}

export type AppEvent =
  | { type: 'navigate'; to: 'today' | 'call' | 'settings' | 'history' | 'actions' | 'retro' }
  | { type: 'conflict'; id: string }
  | { type: 'actions'; actions: ReleaseAction[] }
  | { type: 'open'; screen: { name: string; [key: string]: unknown } }
  | { type: 'module'; name: string; payload: unknown }
  | { type: 'deep'; card: Card }
  | { type: 'status'; result: CardsResult; checkedAt: string };

export interface Api {
  // Generic channel for modules: each one keeps its typed wrapper next to its screen.
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  loadState(): Promise<SavedCeremony | null>;
  saveState(state: SavedCeremony): Promise<void>;
  listHistory(): Promise<HistoryEntry[]>;
  getHistory(id: string): Promise<SavedCeremony | null>;
  loadCards(limit: number): Promise<CardsResult>;
  prepareTurn(card: Card): Promise<AgentTurn>;
  reply(card: Card, turn: AgentTurn, text: string): Promise<ReplyResult>;
  deepAsk(card: Card, question: string, sessionId: string | null): Promise<DeepAnswer>;
  deepOptions(card: Card, sessionId: string): Promise<DeepOption[]>;
  teamsText(minutes: Minutes, cards: Card[]): Promise<string>;
  saveMinutes(minutes: Minutes, teams: string, selected: number[]): Promise<SaveResult>;
  speak(text: string, voice: Voice): Promise<ArrayBuffer>;
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
  prepareRetro(): Promise<Retro>;
  latestRetro(): Promise<Retro | null>;
  askRetro(id: string, question: string): Promise<Retro>;
  onEvent(cb: (event: AppEvent) => void): () => void;
}
