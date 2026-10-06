import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AttachmentRef } from '../../../../shared/attachments';
import { EVENTS_RECONNECTED } from '../../../../shared/activity';
import { FORUM_EVENT, type ForumEventPayload, type ForumMessage, type ThreadRead, type ThreadSummary } from '../../../../shared/forum';
import { baselineSeen, markSeen, mergeMessages } from '../../../../shared/forumView';
import { api, moduleEvents } from '../../api';

// The forum as the screens see it: the channels (`forum:*`, open to a paired browser), the list of threads every screen shares, what the person has read, and
// one thread kept live through the `forum:message` events.

export const forumApi = {
  list: (squad?: string) => api.invoke<ThreadSummary[]>('forum:list', squad),
  read: (thread: string, afterSeq?: number, limit?: number) => api.invoke<ThreadRead | null>('forum:read', thread, afterSeq, limit),
  post: (thread: string, text: string) => api.invoke<ForumMessage>('forum:post', thread, text),
  create: (title: string) => api.invoke<ThreadSummary>('forum:create', title),
  // The files of a message: one call each, so the body of the RPC stays small; the message is written after the bytes are in.
  attachmentPut: (thread: string, name: string, dataBase64: string) => api.invoke<AttachmentRef>('forum:attachment-put', thread, name, dataBase64),
  attachmentPost: (thread: string, text: string, ids: string[]) => api.invoke<ForumMessage>('forum:attachment-post', thread, text, ids),
  attachmentDrop: (thread: string, ids: string[]) => api.invoke<void>('forum:attachment-drop', thread, ids),
  attachmentGet: (thread: string, message: number, id: string) => api.invoke<{ data: string; ref: AttachmentRef } | null>('forum:attachment-get', thread, message, id),
};

// ---- the list of threads ---------------------------------------------------------------------------------------------------------------

const REFRESH_MS = 30_000;
const BURST_MS = 250;
let threads: readonly ThreadSummary[] | null = null;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

const emit = (): void => {
  for (const fn of subscribers) fn();
};

export function reloadThreads(): void {
  void forumApi.list().then(
    (list) => {
      threads = list;
      firstVisit(list);
      emit();
    },
    () => undefined,
  );
}

function soon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    reloadThreads();
  }, BURST_MS);
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(FORUM_EVENT, soon);
  window.addEventListener('focus', soon);
  setInterval(() => {
    if (!document.hidden) reloadThreads();
  }, REFRESH_MS);
  reloadThreads();
}

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/** Every thread of the workspace (the filter by squad is the screen's), null until the first read. */
export function useThreads(): readonly ThreadSummary[] | null {
  start();
  return useSyncExternalStore(subscribe, () => threads);
}

// ---- what the person has read ----------------------------------------------------------------------------------------------------------

const SEEN_KEY = 'cerimonias.forum.seen';
let seen: Record<string, number> | null = null;

function readSeen(): Record<string, number> {
  if (seen) return seen;
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>;
    seen = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  } catch {
    seen = {};
  }
  return seen;
}

// A device that has never kept the count starts from what is there now: the first look at the forum does not announce its whole history as new.
function firstVisit(list: readonly ThreadSummary[]): void {
  try {
    if (localStorage.getItem(SEEN_KEY) !== null) return;
    seen = baselineSeen(list);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage is unavailable: every thread then counts as unread, which is the honest answer
  }
}

/** The person has read `thread` up to `seq` on this device. */
export function markThreadSeen(thread: string, seq: number): void {
  const next = markSeen(readSeen(), thread, seq);
  if (next[thread] === readSeen()[thread]) return;
  seen = next;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // the count then starts again next time; nothing else depends on it
  }
  emit();
}

/** The last message of each thread this device has read. */
export function useSeen(): Readonly<Record<string, number>> {
  return useSyncExternalStore(subscribe, readSeen);
}

// ---- one thread, live ------------------------------------------------------------------------------------------------------------------

export interface LiveThread {
  loading: boolean;
  missing: boolean;
  summary: ThreadSummary | null;
  messages: readonly ForumMessage[];
}

/** A thread's messages: read once, then followed through the events (and read again from the last one after the event stream came back). */
export function useThread(id: string | null): LiveThread {
  const [state, setState] = useState<LiveThread>({ loading: true, missing: false, summary: null, messages: [] });
  useEffect(() => {
    if (!id) return;
    let live = true;
    setState({ loading: true, missing: false, summary: null, messages: [] });
    const merge = (messages: readonly ForumMessage[], summary?: ThreadSummary) =>
      setState((s) => ({ loading: false, missing: false, summary: summary ?? s.summary, messages: mergeMessages(s.messages, messages) }));
    void forumApi.read(id).then(
      (r) => {
        if (!live) return;
        if (r) merge(r.messages, r.thread);
        else setState({ loading: false, missing: true, summary: null, messages: [] });
      },
      () => live && setState({ loading: false, missing: true, summary: null, messages: [] }),
    );
    const onMessage = (e: Event) => {
      const p = (e as CustomEvent<ForumEventPayload>).detail;
      if (live && p?.thread === id) merge([p.message]);
    };
    const onBack = () => {
      void forumApi.read(id).then((r) => live && r && merge(r.messages, r.thread), () => undefined);
    };
    moduleEvents.addEventListener(FORUM_EVENT, onMessage);
    window.addEventListener(EVENTS_RECONNECTED, onBack);
    return () => {
      live = false;
      moduleEvents.removeEventListener(FORUM_EVENT, onMessage);
      window.removeEventListener(EVENTS_RECONNECTED, onBack);
    };
  }, [id]);
  return state;
}
