// The stop of the persona (#248): what every device knows of it. The latch itself lives in the main process (a file in the workspace's folder, outside the configuration); this is the
// shape of its state on the wire, the event that publishes it, and the words about its door. No Electron, no DOM.

/** The module event carrying the state of the stop to the window and to every paired browser. */
export const PERSONA_LATCH_EVENT = 'persona:latch';

/** The channels of the stop: the person's, open to a paired browser, and in no tool of the persona. */
export const PERSONA_STOP_CHANNELS = ['persona:stop', 'persona:resume', 'persona:state'] as const;

/** Where the stop came from: the window or a paired browser. Open to a later door. */
export type StopDoor = 'window' | 'paired' | (string & {});

export interface PersonaState {
  /** The persona may not act and does not begin an answer. */
  stopped: boolean;
  /** When it was stopped (ISO), when known: an unreadable latch file stops it with no date. */
  since: string | null;
  /** The door the stop came by. */
  door: StopDoor | null;
  /** The messages written while it is stopped, waiting for Resume. */
  waiting: number;
}

export const NOT_STOPPED: PersonaState = { stopped: false, since: null, door: null, waiting: 0 };

/** What a device holds from the wire, or null for a payload that is not a state. */
export function readPersonaState(raw: unknown): PersonaState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.stopped !== 'boolean') return null;
  return {
    stopped: o.stopped,
    since: typeof o.since === 'string' ? o.since : null,
    door: typeof o.door === 'string' ? o.door : null,
    waiting: typeof o.waiting === 'number' && Number.isFinite(o.waiting) && o.waiting > 0 ? Math.floor(o.waiting) : 0,
  };
}
