import { ACTIVITY_NODE_MAX } from '../shared/activity';
import { safeText } from './activity';
import type { TurnLimit } from './engine/contract';
import type { TurnAsks } from './turnAsks-core';

// The question an engine asks when an agent or a sub-agent uses its last turn, built once per caller. The engine stays ignorant of the app: it hands over what stopped and how
// far it got; this turns that into the record the screens show, says it in the caller's conversation, stands the caller's clocks still for as long as the question waits, and
// gives back the person's decision. The same function serves every caller: what differs is the place, the line writer, the clocks and the signal it is given.

export interface TurnAskerDeps {
  store: TurnAsks;
  /** Where the work happens: the run (null outside one), the conversation whose lines say it, and the stage and reference when there are any. */
  place: { run: string | null; thread: string; stage: string | null; ref: string | null; issue?: number };
  /** The agent of the call, as the team names it. */
  agent: { id: string; name: string };
  /** Writes a system line in the conversation: the code under `main.forum.code.` and its parameters. Never throws. */
  say(code: string, params: Record<string, string | number>): void;
  /** Stands the caller's clocks still; the function it returns starts them again (the same call a host command waiting for the person makes). */
  pause(): () => void;
  /** The work ends (a cancel, a stop, the app closing): the question ends with it. */
  signal: AbortSignal;
  isSecretPath?: (token: string) => boolean;
}

/** One signal for either of two: the engine's own and the caller's. */
function either(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b || b === a) return a;
  const ac = new AbortController();
  const stop = (): void => ac.abort();
  if (a.aborted || b.aborted) ac.abort();
  else {
    a.addEventListener('abort', stop, { once: true });
    b.addEventListener('abort', stop, { once: true });
  }
  return ac.signal;
}

export function turnAsker(d: TurnAskerDeps): TurnLimit['ask'] {
  return async (stop, signal) => {
    // What the person reads: masked and clipped like an activity line, and nothing the sub-agent read or ran.
    const task = safeText(stop.task, ACTIVITY_NODE_MAX, d.isSecretPath);
    const what = stop.kind ? (task ? `${stop.kind}: ${task}` : stop.kind) : task || '-';
    const params = { agent: d.agent.name, what, used: stop.used, round: stop.round };
    const resume = d.pause();
    try {
      d.say(`runner.turns.ask.${stop.of}`, params);
      const outcome = await d.store.ask(
        {
          of: stop.of,
          run: d.place.run,
          thread: d.place.thread,
          ref: d.place.ref,
          ...(d.place.issue !== undefined ? { issue: d.place.issue } : {}),
          stage: d.place.stage,
          agent: d.agent.id,
          name: d.agent.name,
          kind: stop.kind,
          task,
          used: stop.used,
          round: stop.round,
          granted: stop.granted,
          canContinue: stop.canContinue,
        },
        either(d.signal, signal),
      );
      // A cancel or a stop is not an answer: the conversation claims nothing the person did not choose.
      if (outcome.by === 'person') d.say(`runner.turns.${outcome.decision}.${stop.of}`, params);
      return outcome.decision;
    } finally {
      resume();
    }
  };
}
