import type { PushTarget } from '../../shared/push';
import type { Screen } from './App';
import { HOME, OVERVIEW } from './home';

/**
 * The screen a notification target opens; the call needs the cards loaded, so without them it lands on the home (a pre-daily notice made before the update says `call`).
 * `noPersona`: the workspace has no persona, so the home would be the wizard that makes one, which is not what a notice about a ceremony is for: it lands on the Overview,
 * where the pre-daily card is.
 */
export function targetToScreen(t: PushTarget, hasCards: boolean, noPersona = false): Screen | null {
  switch (t.to) {
    case 'call':
      return hasCards ? { name: 'call' } : noPersona ? OVERVIEW : HOME;
    case 'chat':
      return noPersona ? OVERVIEW : { name: 'chat' };
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
      // A merge request named by project and number opens without a card; otherwise the card's ref, as before.
      if (t.project && t.number) return { name: 'discussions', project: t.project, number: t.number };
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
