import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { EVENTS_RECONNECTED } from '../../shared/activity';
import { PERSONA_LIVE_EVENT, PERSONA_LIVE_READ, type LiveAnswer, type LiveEvent } from '../../shared/persona';
import { api, moduleEvents } from './api';
import { type LiveMap, liveOf, reduceLive, reduceRead } from './chatModel';

// The text of the persona's answers being written, as this device knows it. The main process publishes each step as a module event (the channel the activity lines use, so
// the window and every paired browser hear it); here the events are assembled in order, and a read of the text so far (`persona:live-read`) puts right a device that joined in
// the middle, lost an event or reconnected. The live text is never a message: the stored answer replaces the bubble by arriving (chatModel.ts, `bubblesOf`).

let live: LiveMap = new Map();
const subscribers = new Set<() => void>();
const publish = (next: LiveMap): void => {
  if (next === live) return;
  live = next;
  for (const fn of [...subscribers]) fn();
};

/** Reads the text so far of the answers being written in a thread, and takes it in. A failed read leaves what the device has; the next event or read puts it right. */
export async function readLive(thread: string): Promise<void> {
  try {
    const read = await api.invoke<LiveAnswer[]>(PERSONA_LIVE_READ, thread);
    if (Array.isArray(read)) publish(reduceRead(live, thread, read));
  } catch {
    // the stream keeps coming; only a bubble that lost its end waits for the next read
  }
}

// The threads a chat is open on: what a reconnect, a focus or the slow check reads again.
const watched = new Map<string, number>();

const readWatched = (): void => {
  for (const thread of new Set([...watched.keys(), ...[...live.values()].map((a) => a.thread)])) void readLive(thread);
};

moduleEvents.addEventListener(PERSONA_LIVE_EVENT, (e) => {
  const event = (e as CustomEvent<LiveEvent>).detail;
  if (!event || typeof event.thread !== 'string') return;
  const { map, resync } = reduceLive(live, event);
  publish(map);
  if (resync) void readLive(event.thread);
});
window.addEventListener(EVENTS_RECONNECTED, readWatched);
window.addEventListener('focus', readWatched);
// A bubble whose call died with the app never gets an end event: the read drops it on the next look. Only while one is open.
setInterval(() => {
  if (live.size > 0 && !document.hidden) readWatched();
}, 15_000);

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
};

/** Whether any answer of the persona is being written, anywhere: what an update restart would cut (the window reports it busy). */
export function useAnyLive(): boolean {
  return useSyncExternalStore(subscribe, () => live).size > 0;
}

/** The answers being written in a thread, oldest first; the chat open on it reads them once now and keeps reading when the stream cannot place an event. */
export function useLiveAnswers(thread: string): LiveAnswer[] {
  const map = useSyncExternalStore(subscribe, () => live);
  useEffect(() => {
    watched.set(thread, (watched.get(thread) ?? 0) + 1);
    void readLive(thread);
    return () => {
      const n = (watched.get(thread) ?? 1) - 1;
      if (n <= 0) watched.delete(thread);
      else watched.set(thread, n);
    };
  }, [thread]);
  return useMemo(() => liveOf(map, thread), [map, thread]);
}
