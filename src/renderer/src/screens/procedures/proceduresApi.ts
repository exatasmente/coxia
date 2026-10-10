import type { OfferView, ProcedureDelete, ProcedureGet, ProcedureListView, ProcedureStatsView, ProcedureWrite } from '../../../../shared/proceduresView';
import { api } from '../../api';

// The channels of the Procedures view (`procedures:*`). The first three are reads, open to a paired browser; the others are the desktop window's, and the app refuses them
// to a browser even if a page calls them (webPolicy.ts), so the controls that use them are not drawn there. The offers to keep a procedure (`offers`, `keepOffer`,
// `declineOffer`) are the desktop window's too.

export const proceduresApi = {
  list: () => api.invoke<ProcedureListView>('procedures:list'),
  stats: () => api.invoke<ProcedureStatsView>('procedures:stats'),
  get: (id: string) => api.invoke<ProcedureGet>('procedures:get', id),
  save: (id: string, revision: number, input: unknown) => api.invoke<ProcedureWrite>('procedures:save', id, revision, input),
  review: (id: string) => api.invoke<ProcedureWrite>('procedures:review', id),
  restore: (id: string, revision: number) => api.invoke<ProcedureWrite>('procedures:restore', id, revision),
  offers: (thread: string) => api.invoke<OfferView[]>('procedures:offers', thread),
  keepOffer: (offerId: string, title: string) => api.invoke<ProcedureWrite>('procedures:offer-keep', offerId, title),
  declineOffer: (offerId: string) => api.invoke<{ ok: true } | { ok: false; code: string }>('procedures:offer-decline', offerId),
  remove: (id: string) => api.invoke<ProcedureDelete>('procedures:delete', id),
};
