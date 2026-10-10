import { recordWrite } from '../auditoria';
import { logError } from '../errorlog';
import { ATAS } from '../env';
import type { Module } from '../module';
import { getConfig } from '../workspaceConfig';
import { OFFERS_EVENT } from '../../shared/proceduresView';
import { forumStore } from '../forum';
import { screenSessions } from '../runner/module';
import { createProcedureChannels } from './channels';
import { procedureOffers, wireOffers } from './index';
import { createProcedureStore } from './store';

// The channels of the Procedures view. `list`, `get` and `stats` are reads and open to a paired browser; `save`, `delete`, `review` and `restore` are the desktop
// window's. webPolicy.ts (PROCEDURES_WRITE) denies the whole `procedures:` prefix except those three reads, so a channel added here later is closed from the day it
// exists. test/procedures-policy.test.ts reads this file and fails when a channel it registers is not classified. There is no channel for the agents' tools: they are in
// process (coxia_procedures). The three channels of the offers to keep a procedure (#187) are under the same denial: a paired browser neither sees nor answers the card.

export const proceduresModule: Module = (ctx) => {
  wireOffers({
    screens: screenSessions,
    note: (thread, code, params) => {
      try {
        forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params });
      } catch (e) {
        console.error('[procedures] could not record a note', e instanceof Error ? e.message : e);
      }
    },
  });
  const offers = procedureOffers();
  offers.onChange(() => ctx.emit({ type: 'module', name: OFFERS_EVENT, payload: null }));
  const c = createProcedureChannels({ store: createProcedureStore(ATAS, { onError: (e) => logError('procedures', e) }), config: getConfig, audit: recordWrite, offers });
  ctx.handle('procedures:list', () => c.list());
  ctx.handle('procedures:get', (id: unknown) => c.get(id));
  ctx.handle('procedures:stats', () => c.stats());
  ctx.handle('procedures:save', (id: unknown, revision: unknown, input: unknown) => c.save(id, revision, input));
  ctx.handle('procedures:delete', (id: unknown) => c.delete(id));
  ctx.handle('procedures:review', (id: unknown) => c.review(id));
  ctx.handle('procedures:restore', (id: unknown, revision: unknown) => c.restore(id, revision));
  ctx.handle('procedures:offers', (thread?: unknown) => c.offers(thread));
  ctx.handle('procedures:offer-keep', (offerId: unknown, title?: unknown) => c.offerKeep(offerId, title));
  ctx.handle('procedures:offer-decline', (offerId: unknown) => c.offerDecline(offerId));
};
