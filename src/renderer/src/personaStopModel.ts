import type { PersonaState } from '../../shared/personaStop';

// The decisions of the persona's Stop above the markup (#248), as plain functions: what the one control says and does, the banner over the box, and the small indicator the shell
// shows on the other screens. The state itself is the main process's (the latch); a device only reads it.

export interface Control {
  /** What pressing it asks of the main process. */
  action: 'stop' | 'resume';
  /** The catalog keys of its label and of the sentence under it. */
  label: string;
  title: string;
}

/** The one control: Stop while the persona may act, Resume while it is stopped. */
export const controlOf = (state: PersonaState): Control =>
  state.stopped ? { action: 'resume', label: 'ui.persona.resume.button', title: 'ui.persona.resume.title' } : { action: 'stop', label: 'ui.persona.stop.button', title: 'ui.persona.stop.title' };

/** The banner over the box: shown while the persona is stopped, with the count of messages waiting for Resume. */
export function bannerView(state: PersonaState): { shown: boolean; waiting: number } {
  return state.stopped ? { shown: true, waiting: state.waiting } : { shown: false, waiting: 0 };
}

/**
 * The indicator of the shell: on a screen other than the chat, while the persona works or is stopped. Never on the chat (its header has the control), and never when the persona
 * is idle and may act.
 */
export function indicatorView(o: { state: PersonaState; working: boolean; screen: string }): 'hidden' | 'working' | 'stopped' {
  if (o.screen === 'chat') return 'hidden';
  if (o.state.stopped) return 'stopped';
  return o.working ? 'working' : 'hidden';
}

/** The catalog key of the line under a message that waits: for its turn behind an answer, or for Resume. */
export const queuedKey = (stopped: boolean): string => (stopped ? 'ui.chat.queuedStopped' : 'ui.chat.queued');
