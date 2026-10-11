import { PERSONA_LIVE_EVENT, PERSONA_LIVE_READ, type LiveAnswer } from '../../shared/persona';
import type { Module } from '../module';
import { onConfigChange } from '../workspaceConfig';
import { personaClear, personaConclude, personaDelete, personaDiscard, personaFinish, personaReview, personaRound, personaSave, personaSaveDraft } from './assist';
import { ensurePersonaThread, personaLive, setLiveEmitter } from './runtime';

// The persona's chat, main side: the text of the answers being written reaches the window and every paired browser as a module event (the channel the activity lines use),
// and a read gives a device that joined late, or lost an event, the text so far. The answer itself is posted by the pipeline that answers conversations (mentions/answer.ts).

export const personaModule: Module = (ctx) => {
  setLiveEmitter((event) => ctx.emit({ type: 'module', name: PERSONA_LIVE_EVENT, payload: event }));
  // A read: it changes nothing, so it is open to a paired browser (webPolicy.ts).
  ctx.handle(PERSONA_LIVE_READ, (thread: unknown): LiveAnswer[] => (typeof thread === 'string' ? personaLive().read(thread) : []));
  // The wizard that makes the persona and the editor's writes. Open to a paired browser on purpose (webPolicy.ts): the entry is built here from the texts alone.
  ctx.handle('persona:round', (input: unknown) => personaRound(input));
  ctx.handle('persona:review', (input: unknown) => personaReview(input));
  ctx.handle('persona:saveDraft', (input: unknown) => personaSaveDraft(input));
  ctx.handle('persona:conclude', (id: unknown) => personaConclude(id));
  ctx.handle('persona:discard', (id: unknown) => personaDiscard(id));
  ctx.handle('persona:finish', (input: unknown) => personaFinish(input));
  ctx.handle('persona:save', (input: unknown) => personaSave(input));
  ctx.handle('persona:clear', () => personaClear());
  ctx.handle('persona:delete', () => personaDelete());
  // The conversation exists whenever the persona does: made now, and again when a change of the configuration brings one.
  const ensure = (): void => {
    try {
      ensurePersonaThread();
    } catch (e) {
      console.error('[persona] could not make the conversation', e instanceof Error ? e.message : e);
    }
  };
  ensure();
  onConfigChange(ensure);
};
