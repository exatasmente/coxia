import type { Card, CardPriority } from './types';

// Pure rules for the priority of a card: how the tracker's labels become a rank, and the one order Today and the call share.

function matcher(entry: string): RegExp | null {
  try {
    return new RegExp(entry, 'i');
  } catch {
    return null;
  }
}

/** The first configured level that matches one of the issue's labels (the level's index is the rank); null when none does. */
export function priorityOf(labels: readonly string[] | undefined, levels: readonly string[]): CardPriority | null {
  if (!labels?.length) return null;
  for (let rank = 0; rank < levels.length; rank++) {
    const re = matcher(levels[rank]);
    const label = re ? labels.find((l) => re.test(l)) : undefined;
    if (label !== undefined) return { rank, label };
  }
  return null;
}

const time = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};

/**
 * The order of the cards everywhere: blocked first, then priority (a card with none last), then the most recently updated (a card with no
 * update time last). Cards that tie keep their incoming order: the ref is not a tie-break.
 */
export function compareCards(a: Card, b: Card): number {
  const blocked = Number(!a.blockers.length) - Number(!b.blockers.length);
  if (blocked) return blocked;
  const rank = (c: Card) => c.priority?.rank ?? Infinity;
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
  const [ta, tb] = [time(a.updatedAt), time(b.updatedAt)];
  return ta === tb ? 0 : ta > tb ? -1 : 1;
}

/** A sorted copy; the sort is stable. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
