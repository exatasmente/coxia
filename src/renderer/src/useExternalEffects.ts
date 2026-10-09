import { useEffect, useState } from 'react';
import type { WebSession } from '../../shared/webAccess';
import { isWeb } from './platform';

// Whether the paired browser this page runs in was given the switch for actions with external effects. The server says so in its session answer; the desktop window does not need
// it (it is not a paired browser), and the server refuses an answer the switch does not allow whatever this page believes.

/** The switch as the session answer says it; null when the server could not be asked. */
export async function readExternalEffects(fetcher: typeof fetch = fetch, base: string = document.baseURI): Promise<boolean | null> {
  try {
    const res = await fetcher(new URL('api/session', base).href, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<WebSession>;
    return body.allowExternalEffects === true;
  } catch {
    return null;
  }
}

/** True on the desktop; in a paired browser the switch once the server answered, null until then. */
export function useExternalEffects(): boolean | null {
  const web = isWeb();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!web) return;
    let live = true;
    const read = (): void => {
      void readExternalEffects().then((v) => live && setOn(v));
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
    };
  }, [web]);
  return web ? on : true;
}
