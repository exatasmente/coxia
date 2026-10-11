import type { PersonaState } from '../../shared/personaStop';

// The decisions of the persona's Stop above the markup (#248), as plain functions: what the one control says and does, the banner over the box, and the small indicator the shell
// shows on the other screens. The state itself is the main process's (the latch); a device only reads it.

export interface Control {
  /** What pressing it asks of the main process. */
  action: 'stop' | 'resume';
  /** The catalog keys of its label (it names the persona, so it is not read as the Stop of one answer), of its short form for a header with no room, and of the sentence under it. */
  label: string;
  short: string;
  title: string;
}

/** The one control: Stop while the persona may act, Resume while it is stopped. */
export const controlOf = (state: PersonaState): Control =>
  state.stopped ? { action: 'resume', label: 'ui.persona.resume.button', short: 'ui.persona.resume.short', title: 'ui.persona.resume.title' } : { action: 'stop', label: 'ui.persona.stop.button', short: 'ui.persona.stop.short', title: 'ui.persona.stop.title' };

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

/**
 * What the jobs dock counts while the persona is stopped: nothing of its own conversation. A message that waits for Resume keeps its call line, which the activity reads as work,
 * but nothing runs, so a spinner and a badge for it would say the opposite of the banner. Everything else is counted as before.
 */
export function withoutHeldPersona<T extends { kind: string; id: string }>(tops: readonly T[], o: { stopped: boolean; isPersonaThread: (thread: string) => boolean }): T[] {
  return o.stopped ? tops.filter((e) => !(e.kind === 'conversation' && o.isPersonaThread(e.id))) : [...tops];
}

/** Whether the composer says an answer is going: not while the persona is stopped, when what is listed is waiting for Resume and nothing runs. */
export const answerGoing = (o: { going: boolean; stopped: boolean }): boolean => o.going && !o.stopped;
