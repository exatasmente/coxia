// The persona's chat, shared by the main process and the renderer: the wire of an answer being written. No Electron, no DOM.
// The text of an answer reaches every device as events of this shape, and a read (`persona:live-read`) gives a device that joined late, or lost an event, the text so far.
// The live text is never a message of its own: the answer is stored once, whole, by the pipeline that answers, and replaces the bubble by arriving.

/** The module event that carries the text of an answer being written, to the window and to every paired browser. */
export const PERSONA_LIVE_EVENT = 'persona:live';

/** The read that gives the text so far of every answer being written in a thread. */
export const PERSONA_LIVE_READ = 'persona:live-read';

/**
 * One step of the text being written. `to` is the `seq` of the message of the person it answers (the pair thread and `to` is one answer). `rev` counts the events of the
 * answer from 1. `offset` is where `text` goes in the text so far: 0 replaces it (the first event, a restart, a rewrite by the masking), anything else appends.
 */
export interface LiveEvent {
  thread: string;
  to: number;
  agent: string;
  rev: number;
  offset: number;
  text: string;
  /** The answer is over (posted, stopped or failed): the bubble goes. */
  end?: true;
}

/** The text of an answer as a device holds it, at a revision. */
export interface LiveAnswer {
  thread: string;
  to: number;
  agent: string;
  rev: number;
  text: string;
}

/**
 * The client's assembly of one answer. `resync`: the event cannot be placed (the device joined in the middle, or missed one), so the caller reads the text so far.
 * The state is the answer of one pair (thread, `to`); the caller picks it by that key.
 */
export function applyLive(state: LiveAnswer | null, e: LiveEvent): { state: LiveAnswer | null; resync: boolean } {
  if (e.end) return { state: null, resync: false };
  // A replacement carries the whole text: it needs nothing before it.
  if (e.offset === 0) {
    if (state && e.rev <= state.rev) return { state, resync: false };
    return { state: { thread: e.thread, to: e.to, agent: e.agent, rev: e.rev, text: e.text }, resync: false };
  }
  if (!state) return { state: null, resync: true };
  if (e.rev <= state.rev) return { state, resync: false };
  if (e.rev !== state.rev + 1 || e.offset !== state.text.length) return { state, resync: true };
  return { state: { ...state, rev: e.rev, text: state.text + e.text }, resync: false };
}

/** The answer a read gave, taken in only if it is newer than what the device holds. */
export function applyRead(state: LiveAnswer | null, read: LiveAnswer): LiveAnswer {
  return state && state.rev >= read.rev ? state : read;
}
