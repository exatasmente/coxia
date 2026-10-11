import type { PendingTurnAsk } from '../../shared/turnLimit';

// What a question at a turn limit says on a card. DOM-free: the card is only the markup of these lines, and the words come from the catalogs through `say`.

type Say = (key: string, params?: Record<string, string | number>) => string;

export interface TurnAskLines {
  /** Who waits, and for which task when it is a sub-agent. */
  title: string;
  /** Where it waits, how many rounds were already granted and since when. */
  details: string[];
  /** Null where the engine cannot go on past its limit: only "finish now" is offered. */
  continueLabel: string | null;
  finishLabel: string;
}

const TASK_MAX = 160;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function turnAskLines(ask: PendingTurnAsk, say: Say, time: (iso: string) => string | null): TurnAskLines {
  const agent = ask.name || ask.agent;
  // The work stopped at its limit, so the turns it used are the turns it had.
  const counts = { used: ask.used, limit: ask.used };
  let title: string;
  if (ask.of === 'stage') title = say('ui.turnAsk.title.stage', { agent, ...counts });
  else {
    const task = clip(ask.task.trim() || say('ui.turnAsk.noTask'), TASK_MAX);
    title = ask.kind ? say('ui.turnAsk.title.sub', { kind: ask.kind, task, ...counts }) : say('ui.turnAsk.title.subPlain', { task, ...counts });
  }
  const where = ask.ref ? (ask.stage ? say('ui.turnAsk.where.stage', { ref: ask.ref, stage: ask.stage }) : ask.ref) : say('ui.turnAsk.where.thread');
  const details = [say('ui.turnAsk.detail', { agent, where })];
  if (ask.granted > 0) details.push(say('ui.turnAsk.rounds', { granted: ask.granted }));
  // A time that cannot be read is left out, not drawn as a placeholder.
  const at = time(ask.since);
  if (at) details.push(say('ui.turnAsk.since', { time: at }));
  return {
    title,
    details,
    continueLabel: ask.canContinue ? say('ui.turnAsk.continue', { round: ask.round }) : null,
    finishLabel: say('ui.turnAsk.finish'),
  };
}

/** The same questions in the same order, so a list that only came again does not draw the stack again. */
export function sameTurnAsks(a: readonly PendingTurnAsk[], b: readonly PendingTurnAsk[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.used === b[i].used && x.granted === b[i].granted && x.canContinue === b[i].canContinue);
}
