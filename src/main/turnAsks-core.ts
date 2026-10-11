import { randomUUID } from 'node:crypto';
import { type PendingTurnAsk, type TurnAnswerResult, type TurnAnswerer, type TurnAskInput, type TurnDecision, isTurnDecision } from '../shared/turnLimit';

// The questions an agent or a sub-agent leaves when it uses its last turn. The work waits in memory, in the same process, with no timer of its own: nothing declines,
// answers or cancels a question after a while. It ends by the person's answer or by the work being stopped (the signal of the call). One entry per question, so several
// can wait at once and answering one touches no other. The answer is one call with an id and a decision, whoever gives it (the window, a paired browser, later an agent).

export interface TurnAskDeps {
  /** The list changed: the screens get it whole. */
  changed(list: PendingTurnAsk[]): void;
  /** A new question: the person is told (notification). */
  asked?(a: PendingTurnAsk): void;
  /** An answer, written to the audit log once. Not called for a question that ended with the work. */
  audit?(a: PendingTurnAsk, decision: TurnDecision, through: TurnAnswerer): void;
  now?(): Date;
  newId?(): string;
}

/** How a wait ended: `person` answered it, `abort` is the work being stopped (a cancel, a stop, the app closing). */
export interface TurnOutcome {
  decision: TurnDecision;
  by: 'person' | 'abort';
}

export interface TurnAsks {
  /** Files a question and waits for the answer, with no time limit. Aborting the signal ends it as `finish`, by `abort`; an already aborted signal files nothing. */
  ask(input: TurnAskInput, signal?: AbortSignal): Promise<TurnOutcome>;
  list(): PendingTurnAsk[];
  /** The one door. Throws `TurnAskGone` for a question that does not wait any more; never applies an answer twice. */
  answer(id: string, decision: TurnDecision, through: TurnAnswerer): TurnAnswerResult;
}

export class TurnAskGone extends Error {
  constructor() {
    super('turn-ask-gone');
    this.name = 'TurnAskGone';
  }
}

// A listener that throws must not decide an answer or leave a question waiting.
function tell(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('[turn-asks]', e instanceof Error ? e.message : e);
  }
}

export function createTurnAsks(d: TurnAskDeps): TurnAsks {
  const waiting = new Map<string, { item: PendingTurnAsk; finish: (o: TurnOutcome) => void }>();
  const publish = (): void => tell(() => d.changed([...waiting.values()].map((w) => w.item)));

  return {
    ask(input, signal) {
      if (signal?.aborted) return Promise.resolve({ decision: 'finish', by: 'abort' });
      return new Promise((resolve) => {
        const item: PendingTurnAsk = { ...input, id: d.newId?.() ?? randomUUID(), since: (d.now?.() ?? new Date()).toISOString() };
        const finish = (o: TurnOutcome): void => {
          if (!waiting.delete(item.id)) return;
          signal?.removeEventListener('abort', stopped);
          publish();
          resolve(o);
        };
        const stopped = (): void => finish({ decision: 'finish', by: 'abort' });
        signal?.addEventListener('abort', stopped, { once: true });
        waiting.set(item.id, { item, finish });
        publish();
        tell(() => d.asked?.(item));
      });
    },
    list: () => [...waiting.values()].map((w) => w.item),
    answer(id, decision, through) {
      const w = waiting.get(id);
      if (!w) throw new TurnAskGone();
      if (!isTurnDecision(decision)) return { ok: false, reason: 'decision' };
      if (decision === 'continue' && !w.item.canContinue) return { ok: false, reason: 'decision' };
      tell(() => d.audit?.(w.item, decision, through));
      w.finish({ decision, by: 'person' });
      return { ok: true };
    },
  };
}
