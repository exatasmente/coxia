import type { LiveEvent } from '../../shared/persona';
import { personaOf } from '../../shared/config/team';
import { t } from '../../shared/i18n';
import { ceremonyLabel } from '../cyclePrompts';
import { listActions } from '../actions';
import { loadCards } from '../cards';
import { cycleView } from '../cycle-core';
import { redact } from '../errorlog-core';
import { ensureAgentThread } from '../forum-channels';
import { forumStore } from '../forum';
import { runStore } from '../runs';
import { getConfig } from '../workspaceConfig';
import { type PersonaLive, createPersonaLive } from './live';
import type { ScreenFacts } from './openScreen';

// What the persona's chat shares between the module that serves it and the mentions module that answers it: the live text of the answers being written, and the facts
// the `OpenScreen` tool checks a button against. One of each per process.

let emitter: ((event: LiveEvent) => void) | null = null;
let live: PersonaLive | null = null;

/** The module hands over the way to reach the window and every paired browser; until then nothing is published (a test, or the app starting). */
export function setLiveEmitter(fn: ((event: LiveEvent) => void) | null): void {
  emitter = fn;
}

/** The answers being written, in memory. */
export function personaLive(): PersonaLive {
  live ??= createPersonaLive({ emit: (event) => emitter?.(event), redact: (text) => redact(text) });
  return live;
}

/** What the workspace has right now, for the tool that offers a button. */
export function personaScreens(): ScreenFacts {
  return {
    ceremonies: () => cycleView().ceremonies,
    ceremonyName: (id) => (id === 'preDaily' ? ceremonyLabel() : t(`main.persona.openScreen.ceremony.${id}`)),
    // The cards the app already loaded: no refresh, so a button never waits for the code host.
    cards: async () => (await loadCards(100)).cards.map((c) => c.ref),
    run: (id) => runStore().get(id) !== null,
    conflict: (id) => listActions().some((a) => a.id === id && a.kind === 'conflict'),
    thread: (id) => forumStore().summary(id) !== null,
  };
}

/** The persona's conversation exists whenever the persona does: the chat reads it by its id. Idempotent. */
export function ensurePersonaThread(): void {
  const config = getConfig();
  const persona = personaOf(config.agents.team);
  if (persona) ensureAgentThread(forumStore(), persona, config.language);
}
