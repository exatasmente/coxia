import type { Card, DecisionTarget } from './types';

/** Words the destination of a decision is written with; they come from the cycle (its decision-log heading) and the card source. */
export interface DestinationLabels {
  /** Heading of the plan section that records decisions; empty: decisions are never written into the plan. */
  heading: string;
  /** Name of the tool that stores a note on a card (the card source's command); null when the workspace has none. */
  noteTool: string | null;
  /** What to call the note when there is no tool, already in the language of the screen. */
  noteFallback: string;
  /** The minutes, already in the language of the screen. */
  minutes: string;
}

export function destination(card: Card, target: DecisionTarget, labels: DestinationLabels): string {
  if (target === 'spec' && card.spec && labels.heading) return `${card.spec.planFile ?? card.spec.folder} › ${labels.heading}`;
  if (target !== 'spec' && target !== 'ata' && target !== 'priority') return labels.noteTool ? `${labels.noteTool} note ${card.ref}` : `${labels.noteFallback} ${card.ref}`;
  return labels.minutes;
}
