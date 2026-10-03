import { type SameDayMark, type SeenChange, agendaOrder, clockOf, diffSeen } from '../shared/sameDay';
import { voiceText } from '../shared/cycles/text';
import type { AgentTurn, Card, CardSeen, Decision, Effect, SameDayInfo, SavedCeremony } from '../shared/types';
import { prompt as cp, language, text as word } from './cyclePrompts';
import { cardSnapshot, sessionIsAlive } from './falas';
import { ceremonyIds, readCeremony, today } from './historyFiles';
import { selfWritesOf, versionOfCeremony } from './minutesStore';

// Meetings of the same day. A card already covered in an earlier meeting today is compared with what that meeting saw: nothing moved means a
// short turn built from the earlier one (no agent call); something moved means the agent is told what, next to what was said and decided.

const REPLY_MAX = 280;
const REPLIES_MAX = 6;
const DEEP_MAX = 240;

export interface EarlierMeeting {
  state: SavedCeremony;
  version: number | null;
}

/** The meetings of today before the one being held (all of them when the id is unknown), oldest first. Only calls that started count. */
export function earlierMeetings(currentId: string | undefined, date = today()): EarlierMeeting[] {
  return ceremonyIds()
    .filter((id) => id.startsWith(date) && (!currentId || id < currentId))
    .reverse()
    .flatMap((id) => {
      const state = readCeremony(id);
      return state && state.startedAt !== null ? [{ state, version: versionOfCeremony(id) }] : [];
    });
}

/** What the person said to one card in a meeting: the "you" lines that follow the card's own line in the log, up to the next card. */
export function repliesOf(state: SavedCeremony, card: Card): string[] {
  const mine = `#${card.iid}`;
  const cards = new Set((state.cards?.cards ?? []).map((c) => `#${c.iid}`));
  const out: string[] = [];
  let on = false;
  for (const line of state.log) {
    if (line.who === 'Moderador') on = false;
    else if (cards.has(line.who)) on = line.who === mine;
    else if (on && line.who === 'Você') out.push(line.text.trim());
  }
  return out.filter(Boolean);
}

export interface SameDayContext {
  last: { turn: AgentTurn; seen: CardSeen; version: number | null; state: SavedCeremony };
  decisions: Decision[];
  effects: Effect[];
  replies: string[];
  question: string | null;
  deep: string | null;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// A turn saved before the app kept what the card looked like: the card as the meeting held it stands in, without the spec files.
function baseline(card: Card | undefined, turn: AgentTurn, state: SavedCeremony): CardSeen | null {
  if (turn.seen) return turn.seen;
  if (!card) return null;
  return { at: new Date(state.startedAt ?? Date.now()).toISOString(), fp: '', stage: card.stage, blockers: card.blockers, pending: card.pending, mrs: card.mrs, changes: card.changes, note: card.note, phase: card.spec?.phase ?? null, artifacts: [] };
}

/** What the earlier meetings of the day know about the card; null when none of them covered it. */
export function contextFor(card: Card, meetings: EarlierMeeting[]): SameDayContext | null {
  const covering = meetings.filter((m) => m.state.turns[card.ref] && (m.state.spoken?.[card.ref] || m.state.turns[card.ref].sameDay));
  const lastMeeting = covering[covering.length - 1];
  if (!lastMeeting) return null;
  const { state } = lastMeeting;
  const turn = state.turns[card.ref];
  const seen = baseline(state.cards?.cards.find((c) => c.ref === card.ref), turn, state);
  if (!seen) return null;
  const mine = <T extends { ref: string }>(items: T[]): T[] => items.filter((i) => i.ref === card.ref);
  const replies = covering.flatMap((m) => repliesOf(m.state, m.state.cards?.cards.find((c) => c.ref === card.ref) ?? card));
  const deepMsgs = state.deep?.[card.ref]?.msgs ?? [];
  const lastAgent = [...deepMsgs].reverse().find((m) => !m.me);
  return {
    last: { turn, seen, version: lastMeeting.version, state },
    decisions: covering.flatMap((m) => mine(m.state.decisions)),
    effects: covering.flatMap((m) => mine(m.state.effects)),
    replies: replies.slice(-REPLIES_MAX).map((r) => clip(r, REPLY_MAX)),
    question: turn.question && !state.answered[card.ref] ? turn.question : null,
    deep: lastAgent ? clip((lastAgent.speech ?? lastAgent.text).replace(/\s+/g, ' '), DEEP_MAX) : null,
  };
}

export function changeText(c: SeenChange): string {
  switch (c.kind) {
    case 'stage':
      return word('sameDay.change.stage', { from: c.from ?? '—', to: c.to ?? '—' });
    case 'phase':
      return word('sameDay.change.phase', { from: c.from ?? '—', to: c.to ?? '—' });
    case 'blocker-added':
      return word('sameDay.change.blockerAdded', { text: c.text });
    case 'blocker-removed':
      return word('sameDay.change.blockerRemoved', { text: c.text });
    case 'pending-added':
      return word('sameDay.change.pendingAdded', { text: c.text });
    case 'pending-removed':
      return word('sameDay.change.pendingRemoved', { text: c.text });
    case 'mr-added':
      return word('sameDay.change.mrAdded', { text: c.text });
    case 'mr-removed':
      return word('sameDay.change.mrRemoved', { text: c.text });
    case 'change':
      return word('sameDay.change.moved', { text: c.text });
    case 'note':
      return word('sameDay.change.note', { to: c.to ?? '—' });
    case 'files':
      return word('sameDay.change.files', { paths: c.paths.slice(0, 4).join(', ') + (c.paths.length > 4 ? ` (+${c.paths.length - 4})` : '') });
  }
}

export interface SameDayVerdict {
  ctx: SameDayContext;
  changes: SeenChange[];
  kind: 'unchanged' | 'changed';
  now: { fp: string; seen: CardSeen };
}

/** The earlier meeting's context for the card and what moved since; null when the card was not covered earlier today. */
export function judge(card: Card, meetings: EarlierMeeting[], now = Date.now()): SameDayVerdict | null {
  const ctx = contextFor(card, meetings);
  if (!ctx) return null;
  const snap = cardSnapshot(card, now);
  // Without a record of the spec files the earlier meeting saw, they are not compared.
  const prev = ctx.last.seen.fp === '' ? { ...ctx.last.seen, artifacts: snap.seen.artifacts } : ctx.last.seen;
  const changes = diffSeen(prev, snap.seen, selfWritesOf(today()), card.spec?.folder ?? null);
  return { ctx, changes, kind: changes.length ? 'changed' : 'unchanged', now: snap };
}

export function infoOf(v: SameDayVerdict): SameDayInfo {
  return { kind: v.kind, since: v.ctx.last.seen.at, version: v.ctx.last.version, changes: v.changes.map(changeText), decided: v.ctx.decisions.map((d) => d.text) };
}

// A sentence ends once: the catalog texts carry no final punctuation, so a question keeps its mark and a statement gets a period.
const end = (s: string): string => {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** The turn for a card nothing happened to since an earlier meeting: built from that meeting's turn, no agent call. */
export function unchangedTurn(card: Card, v: SameDayVerdict): AgentTurn {
  const lang = language();
  const t = v.ctx.last.turn;
  const time = clockOf(v.ctx.last.seen.at, lang);
  const head = voiceText('sameDay.unchanged.head', lang).replace('{time}', time);
  const decided = v.ctx.decisions.map((d) => d.text.trim().replace(/[.;]+$/, ''));
  const pending = v.ctx.question ?? t.next;
  const speech = [
    head,
    decided.length ? end(voiceText('sameDay.unchanged.decided', lang).replace('{text}', decided.join('; '))) : '',
    t.blocker ? end(voiceText('sameDay.unchanged.blocker', lang).replace('{text}', t.blocker)) : '',
    pending ? end(voiceText('sameDay.unchanged.pending', lang).replace('{text}', pending)) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    ref: card.ref,
    sessionId: sessionIsAlive(t.sessionId) ? t.sessionId : null,
    speech,
    did: head,
    next: t.next,
    blocker: t.blocker,
    question: v.ctx.question,
    options: v.ctx.question ? t.options ?? [] : [],
    seen: v.now.seen,
    sameDay: infoOf(v),
  };
}

/** The part of the changed-card prompt that says what the earlier meetings said, answered and decided. */
export function earlierText(v: SameDayVerdict): string {
  const t = v.ctx.last.turn;
  const part = (value: string | null | undefined, render: (text: string) => string) => (value ? render(value) : '');
  return [
    part(t.speech, (text) => cp('turn.sameDay.said', { text })),
    part(t.blocker, (text) => cp('turn.sameDay.blocker', { text })),
    part(v.ctx.replies.join(' / '), (text) => cp('turn.sameDay.replied', { text })),
    part(v.ctx.decisions.map((d) => d.text).join('; '), (text) => cp('turn.sameDay.decided', { text })),
    part(v.ctx.effects.map((e) => e.text).join('; '), (text) => cp('turn.sameDay.effect', { text })),
    part(v.ctx.question, (text) => cp('turn.sameDay.question', { text })),
    part(v.ctx.deep, (text) => cp('turn.sameDay.deep', { text })),
  ]
    .filter(Boolean)
    .join('\n');
}

export function deltaText(v: SameDayVerdict): string {
  return v.changes.length ? v.changes.map((c) => `- ${changeText(c)}`).join('\n') : cp('turn.sameDay.nothing');
}

export function timeOf(v: SameDayVerdict): string {
  return clockOf(v.ctx.last.seen.at, language());
}

// ---------------------------------------------------------------- the agenda

/** For each card: new today, unchanged since an earlier meeting, or changed. The agenda of a later meeting shows it and puts what moved first. */
export function agendaMarks(cards: Card[], currentId: string | undefined, now = Date.now()): Record<string, SameDayMark> {
  const meetings = earlierMeetings(currentId);
  const marks: Record<string, SameDayMark> = {};
  for (const card of cards) {
    const v = meetings.length ? judge(card, meetings, now) : null;
    marks[card.ref] = v ? { kind: v.kind, since: v.ctx.last.seen.at, version: v.ctx.last.version } : { kind: 'new' };
  }
  return marks;
}

export function agenda(cards: Card[], currentId: string | undefined): { cards: Card[]; marks: Record<string, SameDayMark> } {
  const marks = agendaMarks(cards, currentId);
  return { cards: agendaOrder(cards, marks), marks };
}
