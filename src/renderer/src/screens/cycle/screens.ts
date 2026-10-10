import type { OpenScreenInfo } from '../../../../shared/browser';

// What the conversation shows of the agents' open screens, without a DOM: when one closes, which one belongs to a call, and whether a list read again changed.

/** Whole minutes until the screen closes by itself (at least 1 while it is still open); null while something keeps it open. */
export function closesInMinutes(closesAt: string | null, now: number): number | null {
  if (!closesAt) return null;
  const at = Date.parse(closesAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(1, Math.ceil((at - now) / 60_000));
}

/** The screen an agent has in a conversation: the one a live call line offers to watch. A stage's own screen is the stage card's. */
export function screenOfCall(screens: readonly OpenScreenInfo[], thread: string, agent: string): OpenScreenInfo | undefined {
  return screens.find((s) => s.place === 'conversation' && s.thread === thread && s.agent === agent);
}

/** Whether two reads of the list say the same, so the screen is not drawn again for a read that found nothing new. */
export function sameScreens(a: readonly OpenScreenInfo[], b: readonly OpenScreenInfo[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}
