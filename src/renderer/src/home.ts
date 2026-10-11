import type { Screen } from './App';

// Where the app opens and where every "back" returns. A screen asks for it here and never names it, so which screen is the home is decided in one place. It is the Overview,
// the screen that holds what Today held; the chat takes its place in a later step, and nothing that goes back to it has to change.

/** The screen the app opens on and every "back to the start" goes to. */
export const HOME: Screen = { name: 'overview' };

/** Where a deep dive goes back to: the pre-daily it came from, or the home. */
export type DeepBack = 'chat' | 'call';

export const deepBack = (back: DeepBack): Screen => (back === 'call' ? { name: 'call' } : HOME);
