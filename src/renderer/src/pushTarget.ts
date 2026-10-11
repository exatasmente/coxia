import type { PushTarget } from '../../shared/push';
import type { Screen } from './App';
import { HOME, OVERVIEW } from './home';

/** The screen a notification target opens; the call needs the cards loaded, so without them it lands on the home (a pre-daily notice made before the update says `call`). */
export function targetToScreen(t: PushTarget, hasCards: boolean): Screen | null {
  switch (t.to) {
    case 'call':
      return hasCards ? { name: 'call' } : HOME;
    case 'chat':
      return { name: 'chat' };
    // `today` is the old name of what the Overview holds, and stays accepted.
    case 'overview':
    case 'today':
      return OVERVIEW;
    case 'deep':
      return t.ref ? { name: 'deep', ref: t.ref, back: 'chat' } : null;
    case 'gate':
    case 'qa':
    case 'quick':
    case 'reentry':
      return t.ref ? { name: t.to, ref: t.ref } : null;
    case 'discussions':
      return t.ref ? { name: 'discussions', ref: t.ref, mr: t.mr } : null;
    case 'conflict':
      return t.id ? { name: 'conflict', id: t.id } : null;
    case 'run':
      return t.id ? { name: 'run', id: t.id } : null;
    case 'forum':
      return t.id ? { name: 'forum', thread: t.id } : { name: 'forum' };
    default:
      return { name: t.to } as Screen;
  }
}
