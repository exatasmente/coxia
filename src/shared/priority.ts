import type { Card, CardPriority, PriorityChange } from './types';

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

/** The label name a level stands for, when it is a plain one (a leading ^ and a trailing $ are allowed); null for a pattern. */
export function literalLabel(level: string): string | null {
  const bare = level.replace(/^\^/, '').replace(/\$$/, '');
  return bare && !/[\\^$.*+?()[\]{}|]/.test(bare) ? bare : null;
}

/** The labels a priority can be written to: the literal ones, from the highest level to the lowest. */
export function writableLabels(levels: readonly string[]): string[] {
  return levels.map(literalLabel).filter((l): l is string => l !== null);
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * What a request to change a card's priority means for the tracker. `to` is "first" (the highest level), "later" (the lowest) or one of the
 * configured labels. A level can be written only when it is a plain label name; the others, no levels at all, a label the card already has
 * and a card whose issue is not known leave the decision in the minutes, with the reason. Every priority label the issue has is taken off
 * the way to the new one; its other labels are not touched.
 */
export function resolvePriority(card: Pick<Card, 'labels' | 'priority' | 'project' | 'iid' | 'title'>, to: string, levels: readonly string[]): PriorityChange {
  const base: PriorityChange = { to, from: card.priority?.label ?? null, label: null, add: null, remove: [], noWrite: null, project: card.project ?? null, iid: /^\d+$/.test(card.iid) ? Number(card.iid) : null, title: card.title };
  if (!levels.length) return { ...base, noWrite: 'unconfigured' };
  const names = levels.map(literalLabel);
  const at = to === 'first' ? 0 : to === 'later' ? levels.length - 1 : names.findIndex((n) => n !== null && same(n, to));
  const label = at >= 0 ? names[at] : null;
  if (label === null) return { ...base, noWrite: 'unmapped' };
  if (!base.project || base.iid === null) return { ...base, label, add: label, noWrite: 'unidentified' };
  const matchers = levels.map(matcher);
  const have = (card.labels ?? []).filter((l) => matchers.some((re) => re?.test(l)));
  const remove = have.filter((l) => !same(l, label));
  if (!remove.length && have.some((l) => same(l, label))) return { ...base, label, noWrite: 'same' };
  return { ...base, label, add: have.some((l) => same(l, label)) ? null : label, remove };
}
