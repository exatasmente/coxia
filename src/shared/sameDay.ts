import { sortCards } from './priority';
import type { Card, CardSeen, CardsResult } from './types';

// Pure rules for the meetings of one day: what moved on a card since an earlier meeting, and how the agenda of a later meeting is ordered.

export type SeenChange =
  | { kind: 'stage'; from: string | null; to: string | null }
  | { kind: 'phase'; from: string | null; to: string | null }
  | { kind: 'blocker-added' | 'blocker-removed' | 'pending-added' | 'pending-removed' | 'mr-added' | 'mr-removed' | 'change'; text: string }
  | { kind: 'note'; from: string | null; to: string | null }
  | { kind: 'files'; paths: string[] };

export interface SameDayMark {
  kind: 'new' | 'unchanged' | 'changed';
  // When the earlier meeting's turn was prepared (ISO); absent for a card not covered earlier today.
  since?: string;
  version?: number | null;
}

// What the app itself wrote after an earlier meeting (the decision in the plan's log, the note on the card): not news for the next one.
export interface SelfWrites {
  files: Record<string, number>;
  notes: Record<string, string>;
}

export const NO_SELF_WRITES: SelfWrites = { files: {}, notes: {} };

export function seenOf(card: Card, fp: string, artifacts: { path: string; mtime: number }[], at: string): CardSeen {
  return {
    at,
    fp,
    stage: card.stage,
    blockers: [...card.blockers],
    pending: [...card.pending],
    mrs: [...card.mrs],
    changes: [...card.changes],
    note: card.note,
    phase: card.spec?.phase ?? null,
    artifacts: artifacts.map((a): [string, number] => [a.path, Math.floor(a.mtime)]),
  };
}

const added = (now: string[], before: string[]): string[] => now.filter((x) => !before.includes(x));

/**
 * What moved between what the earlier meeting saw and what the card looks like now. The report's history window rolls, so an entry that left
 * `changes` is not news; a new one is.
 */
export function diffSeen(prev: CardSeen, cur: CardSeen, own: SelfWrites = NO_SELF_WRITES, specFolder: string | null = null): SeenChange[] {
  const out: SeenChange[] = [];
  if (prev.stage !== cur.stage) out.push({ kind: 'stage', from: prev.stage, to: cur.stage });
  if (prev.phase !== cur.phase) out.push({ kind: 'phase', from: prev.phase, to: cur.phase });
  for (const text of added(cur.blockers, prev.blockers)) out.push({ kind: 'blocker-added', text });
  for (const text of added(prev.blockers, cur.blockers)) out.push({ kind: 'blocker-removed', text });
  for (const text of added(cur.pending, prev.pending)) out.push({ kind: 'pending-added', text });
  for (const text of added(prev.pending, cur.pending)) out.push({ kind: 'pending-removed', text });
  for (const text of added(cur.mrs, prev.mrs)) out.push({ kind: 'mr-added', text });
  for (const text of added(prev.mrs, cur.mrs)) out.push({ kind: 'mr-removed', text });
  for (const text of added(cur.changes, prev.changes)) out.push({ kind: 'change', text });
  if (prev.note !== cur.note && !(cur.note !== null && Object.values(own.notes).includes(cur.note))) out.push({ kind: 'note', from: prev.note, to: cur.note });
  const before = new Map(prev.artifacts);
  const moved: string[] = [];
  for (const [path, mtime] of cur.artifacts) {
    if (before.get(path) === mtime) continue;
    // The file the app wrote itself after that meeting, untouched since.
    if (specFolder !== null && own.files[`${specFolder}/${path}`] === mtime) continue;
    moved.push(path);
  }
  for (const [path] of prev.artifacts) if (!cur.artifacts.some(([p]) => p === path)) moved.push(path);
  if (moved.length) out.push({ kind: 'files', paths: moved.sort() });
  return out;
}

/** Cards that moved or are blocked go first; the ones nothing happened to wait at the end. The order inside each group is kept. */
export function orderAgenda(cards: Card[], marks: Record<string, SameDayMark>): Card[] {
  const rest = (c: Card): number => (marks[c.ref]?.kind === 'unchanged' && !c.blockers.length ? 1 : 0);
  return cards.map((c, i) => ({ c, i })).sort((a, b) => rest(a.c) - rest(b.c) || a.i - b.i).map((x) => x.c);
}

/** The order every screen lists the agenda in: the comparator Today and the call share (blocked, priority, last update), then the same-day rule. */
export function agendaOrder(cards: Card[], marks: Record<string, SameDayMark>): Card[] {
  return orderAgenda(sortCards(cards), marks);
}

/**
 * A card the call left out joins the agenda right after the one in progress (at the end when the call has not started, `callIdx` < 0), so
 * nothing already visited shifts. A ref that is not among the left out cards changes nothing.
 */
export function bringIntoAgenda(result: CardsResult, ref: string, callIdx: number): CardsResult {
  const card = result.rest?.find((c) => c.ref === ref);
  if (!card) return result;
  const at = callIdx < 0 ? result.cards.length : Math.min(result.cards.length, callIdx + 1);
  return { ...result, cards: [...result.cards.slice(0, at), card, ...result.cards.slice(at)], rest: result.rest?.filter((c) => c.ref !== ref) };
}

/** Local "HH:MM" of an ISO instant. */
export function clockOf(iso: string, language: string): string {
  return new Date(iso).toLocaleTimeString(language === 'en' ? 'en-GB' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
}
