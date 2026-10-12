import { useSyncExternalStore } from 'react';

const PHONE = '(max-width: 600px)'; // i18n-ignore: media query

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Phone layout: the navigation behind the header's menu button and a single column. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}
