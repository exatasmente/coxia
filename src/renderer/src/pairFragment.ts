import { readPairFragment } from '../../shared/webAccess';

interface PairWindow {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(data: unknown, unused: string, url?: string | null): void };
}

/** Reads the pairing code from the URL fragment and removes it from the address bar and the history entry. */
export function consumePairFragment(win: PairWindow): string | null {
  const { hash, pathname, search } = win.location;
  if (!hash.startsWith('#pair=')) return null;
  win.history.replaceState(null, '', pathname + search);
  return readPairFragment(hash);
}
