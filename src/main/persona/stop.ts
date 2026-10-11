import type { ForumMessage } from '../../shared/forum';
import type { PersonaState, StopDoor } from '../../shared/personaStop';
import type { Latch } from './latch';

// The stop of the persona (#248). `stop` is one synchronous stretch before the channel returns: it sets the latch, aborts every call registered in the persona's thread (its own
// answer and the agents it called, which register in the same thread), names the acts still running and says it in the thread. It undoes nothing that is already happening: a
// push or a write that had begun finishes and is audited. Messages written while it is stopped are held, in order, and `resume` starts them. Asks that wait for the person are
// not touched: stopping answers nothing on their behalf. Pure of Electron and of the forum module: every port comes in, so a test drives it with fakes.

/** A message waiting for Resume: the place it holds in its thread and the way to start its answer. */
export interface HeldAnswer {
  thread: string;
  seq: number;
  start(): void;
}

export interface StopPorts {
  latch: Latch;
  /** The persona's conversation, or null when there is no persona. */
  thread(): string | null;
  /** The calls registered in a thread, and the abort of one of them. */
  running(thread: string): { thread: string; agent: string }[];
  abort(thread: string, agent: string): boolean;
  /** The acts running now, described. */
  inflight(): string[];
  /** A line of the app in the persona's thread, worded at display time by its code. */
  post(thread: string, code: string, params: Record<string, string | number>): void;
  /** The messages of a thread, oldest first. */
  messages(thread: string): ForumMessage[];
  /** Whether the answer to a message is still to come (going, or waiting its turn): the module that answers knows. */
  pending(thread: string, seq: number): boolean;
  audit(op: 'stop' | 'resume', door: StopDoor, detail: { ended: number; inflight: number }): void;
  emit(state: PersonaState): void;
  /** Shortens and masks a description before it is said in the thread. */
  words?(text: string): string;
}

export interface PersonaStop {
  state(): PersonaState;
  stopped(): boolean;
  stop(door: StopDoor): PersonaState;
  resume(door: StopDoor): PersonaState;
  /** A message written while stopped, or reached by its turn while stopped: it waits for Resume. */
  hold(item: HeldAnswer): void;
  /** Whether a message of the thread waits for Resume. */
  holds(thread: string): boolean;
}

/** The two doors the line is worded for: the window, and a paired browser (anything else reads as the window). */
const doorWord = (door: StopDoor): 'window' | 'paired' => (door === 'paired' ? 'paired' : 'window');

/** The most the thread's line says of what is still running. */
const INFLIGHT_MAX = 300;

export function createPersonaStop(ports: StopPorts): PersonaStop {
  const held: HeldAnswer[] = [];
  const words = ports.words ?? ((text: string) => text);

  const state = (): PersonaState => {
    const latch = ports.latch.state();
    return { stopped: latch.stopped, since: latch.since, door: latch.door, waiting: held.length };
  };
  const publish = (): PersonaState => {
    const now = state();
    try {
      ports.emit(now);
    } catch (e) {
      console.error('[persona] could not publish the state of the stop', e instanceof Error ? e.message : e);
    }
    return now;
  };
  const say = (code: string, params: Record<string, string | number>): void => {
    const thread = ports.thread();
    if (!thread) return;
    try {
      ports.post(thread, code, params);
    } catch (e) {
      console.error('[persona] could not record the stop in the conversation', e instanceof Error ? e.message : e);
    }
  };
  const audit = (op: 'stop' | 'resume', door: StopDoor, detail: { ended: number; inflight: number }): void => {
    try {
      ports.audit(op, door, detail);
    } catch (e) {
      console.error('[persona] could not audit the stop', e instanceof Error ? e.message : e);
    }
  };

  return {
    state,
    stopped: () => ports.latch.stopped(),

    stop(door) {
      // The latch first: from here no new tool call starts and no new answer begins, whatever else this stretch does.
      ports.latch.set(true, door);
      const thread = ports.thread();
      let ended = 0;
      if (thread) {
        for (const call of ports.running(thread)) if (ports.abort(call.thread, call.agent)) ended += 1;
      }
      const running = ports.inflight();
      const inflight = words(running.join('; ')).slice(0, INFLIGHT_MAX);
      say(`${running.length ? 'persona.stoppedInflight' : 'persona.stopped'}.${doorWord(door)}`, running.length ? { inflight } : {});
      audit('stop', door, { ended, inflight: running.length });
      return publish();
    },

    resume(door) {
      const was = ports.latch.state();
      ports.latch.set(false, door);
      const thread = ports.thread();
      // In the order they were written: one that was queued behind the stopped answer reaches the list after one written while stopped, but its place is earlier.
      const waiting = held.splice(0).sort((a, b) => a.seq - b.seq);
      say(`persona.resumed.${doorWord(door)}`, {});
      audit('resume', door, { ended: 0, inflight: 0 });
      // The held answers begin in the order they were written, through the same chain every answer goes through.
      for (const item of waiting) {
        try {
          item.start();
        } catch (e) {
          console.error('[persona] could not start a held answer', e instanceof Error ? e.message : e);
        }
      }
      if (thread && was.stopped) {
        const lost = unansweredSince(ports.messages(thread), (seq) => ports.pending(thread, seq));
        if (lost > 0) say('persona.notAnswered', { count: lost });
      }
      return publish();
    },

    hold(item) {
      if (held.some((h) => h.thread === item.thread && h.seq === item.seq)) return;
      held.push(item);
      publish();
    },

    holds: (thread) => held.some((h) => h.thread === thread),
  };
}

/**
 * The messages of the person written after the last stop that nothing answers and nothing is going to: the app was restarted while stopped (the waiting list is in memory), so
 * these are for the person to write again. An answer that arrived, or one still to come, is not counted.
 */
export function unansweredSince(messages: readonly ForumMessage[], pending: (seq: number) => boolean): number {
  const stop = messages.findLast((m) => m.kind === 'system' && typeof m.code === 'string' && /^persona\.stopped(?:Inflight)?\./.test(m.code));
  if (!stop) return 0;
  const answered = new Set(messages.filter((m) => m.answersTo !== undefined).map((m) => m.answersTo));
  return messages.filter((m) => m.seq > stop.seq && m.author.type === 'person' && m.kind === 'post' && !answered.has(m.seq) && !pending(m.seq)).length;
}
