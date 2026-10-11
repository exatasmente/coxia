import { join } from 'node:path';
import type { LiveEvent } from '../../shared/persona';
import type { PersonaState } from '../../shared/personaStop';
import { personaOf } from '../../shared/config/team';
import { agentThreadId } from '../../shared/forum';
import { t } from '../../shared/i18n';
import { recordWrite } from '../auditoria';
import { callStops } from '../mentions/stop';
import { ATAS } from '../env';
import { viaOf } from '../rpc';
import { ceremonyLabel } from '../cyclePrompts';
import { listActions } from '../actions';
import { workspaceProjects } from '../agents';
import { loadCards } from '../cards';
import { cycleView } from '../cycle-core';
import { redact } from '../errorlog-core';
import { ensureAgentThread } from '../forum-channels';
import { forumStore } from '../forum';
import { runStore } from '../runs';
import { getConfig } from '../workspaceConfig';
import { type PersonaLive, createPersonaLive } from './live';
import { inflightLabels } from './inflight';
import { LATCH_FILE, createLatch } from './latch';
import type { ScreenFacts } from './openScreen';
import { createPersonaStop, type PersonaStop } from './stop';

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
    projects: workspaceProjects,
  };
}

/** The persona's conversation exists whenever the persona does: the chat reads it by its id. Idempotent. */
export function ensurePersonaThread(): void {
  const config = getConfig();
  const persona = personaOf(config.agents.team);
  if (persona) ensureAgentThread(forumStore(), persona, config.language);
}

let latchEmitter: ((state: PersonaState) => void) | null = null;
let stop: PersonaStop | null = null;

/** The module hands over the way to publish the state of the stop; until then nothing is published. */
export function setLatchEmitter(fn: ((state: PersonaState) => void) | null): void {
  latchEmitter = fn;
}

/** The thread of the persona the workspace has now (never its test copy), or null. */
export const personaThreadNow = (): string | null => {
  const persona = personaOf(getConfig().agents.team);
  return persona ? agentThreadId(persona.id) : null;
};

/**
 * The stop of the persona: one latch for the workspace, read from its file the first time anything asks. The mentions module holds its messages in it, the channels of the
 * stop drive it, and the persona's door will refuse by it.
 */
export function personaStop(): PersonaStop {
  stop ??= createPersonaStop({
    latch: createLatch(join(ATAS, LATCH_FILE)),
    thread: personaThreadNow,
    running: (thread) => callStops.running(thread),
    abort: (thread, agent) => callStops.stop(thread, agent),
    inflight: inflightLabels,
    post: (thread, code, params) => void forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params }),
    messages: (thread) => forumStore().read(thread, 0, 2000)?.messages ?? [],
    pending: (thread, seq) => answerIsPending(thread, seq),
    audit: (op, door, detail) =>
      recordWrite({
        kind: 'persona',
        issue: 0,
        target: `persona:${op}`,
        via: viaOf(),
        fields: { door, ...(op === 'stop' ? { ended: String(detail.ended), inflight: String(detail.inflight) } : {}) },
        ok: true,
        code: null,
        result: op,
        origin: { actionId: '', kind: 'persona', key: op, summary: null },
      }),
    emit: (state) => latchEmitter?.(state),
    words: (text) => redact(text),
  });
  return stop;
}

/** Whether the answer to a message of the person is still to come; the mentions module fills this in (it owns the lines of the calls). */
let answerIsPending: (thread: string, seq: number) => boolean = () => false;
export function setAnswerPending(fn: (thread: string, seq: number) => boolean): void {
  answerIsPending = fn;
}
