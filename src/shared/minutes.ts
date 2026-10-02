import type { Minutes, SavedCeremony } from './types';

type MinutesSource = Pick<SavedCeremony, 'cards' | 'turns' | 'answered' | 'decisions' | 'effects' | 'log' | 'startedAt' | 'endedAt'>;

export function buildMinutes(s: MinutesSource): Minutes {
  const unanswered = (s.cards?.cards ?? [])
    .map((c) => ({ ref: c.ref, question: s.turns[c.ref]?.question ?? null }))
    .filter((u): u is { ref: string; question: string } => !!u.question && !s.answered[u.ref]);
  return {
    startedAt: new Date(s.startedAt ?? Date.now()).toISOString(),
    endedAt: new Date(s.endedAt ?? Date.now()).toISOString(),
    decisions: s.decisions,
    effects: s.effects,
    unanswered,
    transcript: s.log.map((l) => ({ who: l.who, text: l.text, at: l.at })),
  };
}

// What the summary text is written from; the text is generated again only when this changes.
export function teamsKey(s: MinutesSource): string {
  const m = buildMinutes(s);
  return JSON.stringify({
    decisions: m.decisions.map((d) => [d.ref, d.text]),
    effects: m.effects.map((e) => [e.ref, e.text]),
    cards: (s.cards?.cards ?? []).map((c) => [c.ref, c.stage, c.blockers, c.changes]),
  });
}
