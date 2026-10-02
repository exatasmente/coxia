import type { AgentTurn, Card, Decision, Effect, SavedCeremony } from '../../src/shared/types';

// Neutral fixtures for the meetings-of-a-day tests: org "acme", people "Ana" and "Bruno".

export const card = (ref: string, over: Partial<Card> = {}): Card => ({
  ref,
  iid: ref.split('#')[1],
  title: `Activity ${ref}`,
  stage: 'Doing',
  spec: null,
  mrs: [],
  mrPaths: [],
  blockers: [],
  pending: [],
  changes: [],
  note: null,
  url: `https://git.example.test/acme/app/-/work_items/${ref.split('#')[1]}`,
  ...over,
});

export const turn = (ref: string, over: Partial<AgentTurn> = {}): AgentTurn => ({
  ref,
  sessionId: null,
  speech: `Speech about ${ref}.`,
  did: 'did',
  next: 'Open the merge request',
  blocker: null,
  question: null,
  ...over,
});

export interface CeremonyOptions {
  id: string;
  startedAt?: number | null;
  endedAt?: number | null;
  cards?: Card[];
  turns?: Record<string, AgentTurn>;
  spoken?: string[];
  answered?: string[];
  decisions?: Decision[];
  effects?: Effect[];
  log?: SavedCeremony['log'];
  callEnded?: boolean;
  teams?: string | null;
  saveResult?: SavedCeremony['saveResult'];
}

/** A saved ceremony of the day. The id is the local start time, like the app makes it: "2026-10-02T094000". */
export function ceremony(o: CeremonyOptions): SavedCeremony {
  const cards = o.cards ?? [];
  const startedAt = o.startedAt === undefined ? Date.parse(`${o.id.slice(0, 10)}T${o.id.slice(11, 13)}:${o.id.slice(13, 15)}:${o.id.slice(15, 17)}`) : o.startedAt;
  return {
    version: 1,
    id: o.id,
    kind: 'pre-daily',
    date: o.id.slice(0, 10),
    cards: { generatedAt: '2026-10-02T09:00:00Z', total: cards.length, cards },
    turns: o.turns ?? {},
    decisions: o.decisions ?? [],
    effects: o.effects ?? [],
    answered: Object.fromEntries((o.answered ?? []).map((r) => [r, true])),
    log: o.log ?? [],
    startedAt,
    endedAt: o.endedAt === undefined ? (startedAt === null ? null : startedAt + 600_000) : o.endedAt,
    callIdx: 0,
    callEnded: o.callEnded ?? true,
    spoken: Object.fromEntries((o.spoken ?? []).map((r) => [r, true])),
    deep: {},
    teams: o.teams ?? null,
    teamsKey: null,
    saveResult: o.saveResult ?? null,
  };
}
