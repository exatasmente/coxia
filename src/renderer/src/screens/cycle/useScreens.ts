import { useEffect, useState } from 'react';
import { EVENTS_RECONNECTED } from '../../../../shared/activity';
import { type OpenScreenInfo, SCREEN_ASKS_EVENT } from '../../../../shared/browser';
import { SCREEN_EVENT } from '../../../../shared/screen';
import { moduleEvents } from '../../api';
import { screenApi } from './screenApi';
import { sameScreens } from './screens';

// The open screens of a thread, kept fresh: read when the screen mounts, again when the main process says a screen opened, changed or closed or that a question changed
// (the events carry no pixels), when the window comes back, and on a slow timer for a missed event. `thread` null reads nothing.

const NONE: readonly OpenScreenInfo[] = [];
const BURST_MS = 250;
const REFRESH_MS = 30_000;

export function useScreens(thread: string | null): readonly OpenScreenInfo[] {
  const [list, setList] = useState<readonly OpenScreenInfo[]>(NONE);
  useEffect(() => {
    setList(NONE);
    if (thread === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = (): void => {
      void screenApi.list(thread).then(
        (next) => {
          if (live && Array.isArray(next)) setList((cur) => (sameScreens(cur, next) ? cur : next));
        },
        () => undefined,
      );
    };
    const soon = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        read();
      }, BURST_MS);
    };
    moduleEvents.addEventListener(SCREEN_EVENT, soon);
    moduleEvents.addEventListener(SCREEN_ASKS_EVENT, soon);
    window.addEventListener('focus', soon);
    window.addEventListener(EVENTS_RECONNECTED, soon);
    const every = setInterval(() => {
      if (!document.hidden) read();
    }, REFRESH_MS);
    read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      clearInterval(every);
      moduleEvents.removeEventListener(SCREEN_EVENT, soon);
      moduleEvents.removeEventListener(SCREEN_ASKS_EVENT, soon);
      window.removeEventListener('focus', soon);
      window.removeEventListener(EVENTS_RECONNECTED, soon);
    };
  }, [thread]);
  return list;
}

/** The time, drawn again every `ms` while the component is on screen: what a "closes in N minutes" text counts from. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
