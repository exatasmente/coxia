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

export interface Api {
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
}
