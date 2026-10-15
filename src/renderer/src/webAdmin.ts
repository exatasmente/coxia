import { useEffect, useState } from 'react';
import { api } from './api';
import { isWeb } from './platform';

/**
 * Whether this window may administer the instance: the desktop always, a paired browser when it has a passkey of its own (#210). `passkey:list` answers a paired browser with
 * its own passkeys only. Null while it is being asked. A sensitive call still asks for the passkey at that moment (webApi.ts): this only decides what is shown.
 */
export function useWebAdmin(): boolean | null {
  const web = isWeb();
  const [admin, setAdmin] = useState<boolean | null>(web ? null : true);
  useEffect(() => {
    if (!web) return;
    let live = true;
    api.invoke<unknown[]>('passkey:list').then(
      (list) => live && setAdmin(Array.isArray(list) && list.length > 0),
      () => live && setAdmin(false),
    );
    return () => {
      live = false;
    };
  }, [web]);
  return admin;
}
