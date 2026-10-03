import type { CardPriority } from './types';

// Pure rules for the priority of a card: how the tracker's labels become a rank, and, further down, the one order Today and the call share.

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
