import { useEffect, useSyncExternalStore } from 'react';
import { EVENTS_RECONNECTED } from '../../shared/activity';
import { NOT_STOPPED, PERSONA_LATCH_EVENT, type PersonaState, readPersonaState } from '../../shared/personaStop';
import { api, moduleEvents } from './api';

// The state of the persona's Stop as this device knows it: the main process publishes it on a module event (the window and every paired browser hear it) and answers a read, which
// puts right a device that joined late, lost an event or reconnected. Stopping and resuming are channels open to the phone; what they answer is the new state.

let state: PersonaState = NOT_STOPPED;
const subscribers = new Set<() => void>();
const publish = (next: PersonaState): void => {
  if (next.stopped === state.stopped && next.waiting === state.waiting && next.since === state.since && next.door === state.door) return;
  state = next;
  for (const fn of [...subscribers]) fn();
};

/** Reads the state; a failed read leaves what the device has (the next event or read puts it right). */
export async function readPersonaStateNow(): Promise<void> {
  try {
    const read = readPersonaState(await api.invoke<unknown>('persona:state'));
    if (read) publish(read);
  } catch {
    // keep what the device knows
  }
}

moduleEvents.addEventListener(PERSONA_LATCH_EVENT, (e) => {
  const next = readPersonaState((e as CustomEvent<unknown>).detail);
  if (next) publish(next);
});
window.addEventListener(EVENTS_RECONNECTED, () => void readPersonaStateNow());
window.addEventListener('focus', () => void readPersonaStateNow());

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
};

/** The state of the stop; the first screen to ask reads it once. */
export function usePersonaState(): PersonaState {
  useEffect(() => void readPersonaStateNow(), []);
  return useSyncExternalStore(subscribe, () => state);
}

/** Stop or resume, as the control asks; the new state is taken in as it comes back. */
export async function pressPersonaControl(action: 'stop' | 'resume'): Promise<void> {
  const next = readPersonaState(await api.invoke<unknown>(action === 'stop' ? 'persona:stop' : 'persona:resume'));
  if (next) publish(next);
}
