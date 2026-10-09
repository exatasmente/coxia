import { type AskDecision, type ConfirmKind, type OpenScreenInfo, type PendingAsk } from '../../../../shared/browser';

// What the card of a question shows and offers, without a DOM. One table row per kind of question, so a kind added later adds a row and not a branch in the card.

/** The reason a step was held, as the catalog words it (a table, so each key is written out where a search finds it). */
export const WHY_KEY: Record<PendingAsk['why'], string> = {
  submit: 'main.browser.why.submit',
  name: 'main.browser.why.name',
  shortcut: 'main.browser.why.shortcut',
  dialog: 'main.browser.why.dialog',
  unclassified: 'main.browser.why.unclassified',
  agent: 'main.browser.why.agent',
};

/** What an agent says it wants confirmed, as a verb. */
export const CONFIRM_KIND_KEY: Record<ConfirmKind, string> = {
  send: 'main.browser.confirmKind.send',
  save: 'main.browser.confirmKind.save',
  delete: 'main.browser.confirmKind.delete',
  publish: 'main.browser.confirmKind.publish',
  pay: 'main.browser.confirmKind.pay',
  other: 'main.browser.confirmKind.other',
};

/**
 * The answers a question offers. "Yes for the rest of this screen on this site" only for a step the app could not read: a step it called irreversible asks every time, and a
 * confirmation the agent asked for has nothing to pass.
 */
export function choicesOf(ask: PendingAsk): AskDecision[] {
  // A request to hand the screen over has no yes/no/site: it is taken, given back or declined through its own channels (HandoffCard).
  if (ask.kind === 'handoff') return [];
  if (ask.kind === 'hold' && ask.why === 'unclassified' && ask.site) return ['yes', 'site', 'no'];
  return ['yes', 'no'];
}

/** The requests to hand a screen over among these questions: they are shown where the agent works and in the viewer's warning, not with the other questions. */
export const isHandoff = (ask: PendingAsk): boolean => ask.kind === 'handoff';

/** Every question waiting on these screens, oldest first. */
export function asksOf(screens: readonly OpenScreenInfo[]): PendingAsk[] {
  return screens.flatMap((s) => s.pending).sort((a, b) => a.since.localeCompare(b.since));
}
