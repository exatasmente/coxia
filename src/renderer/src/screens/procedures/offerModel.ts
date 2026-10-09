import type { OfferView, ProcedureWrite } from '../../../../shared/proceduresView';

// What the card of an offer to keep a procedure does with the answers of the app, kept out of the component so it is tested without a window. The card is the computer's: a
// paired browser is refused the three channels, and that refusal is the card staying away, not an error to show.

/** How often the card reads the offers again while the page is visible, besides on the app's event and on focus: an offer expires with no event. */
export const OFFER_REFRESH_MS = 30_000;

type Failure = Extract<ProcedureWrite, { ok: false }>;

export type OfferOutcome = { ok: true } | { ok: false; gone: true } | { ok: false; gone: false; failure: Failure };

/** The offers of a thread, or none when the app refuses the call (a paired browser) or cannot answer. */
export async function readOffers(read: () => Promise<OfferView[]>): Promise<OfferView[]> {
  try {
    const offers = await read();
    return Array.isArray(offers) ? offers : [];
  } catch {
    return [];
  }
}

const failed = (e: unknown): OfferOutcome => ({ ok: false, gone: false, failure: { ok: false, code: 'error', text: e instanceof Error ? e.message : String(e) } });

/** Yes: the app saves what the card shows, under the title in the field. A refusal keeps the offer and says why; `gone` means it was answered, replaced or expired. */
export async function keepOffer(keep: (offerId: string, title: string) => Promise<ProcedureWrite>, offerId: string, title: string): Promise<OfferOutcome> {
  try {
    const r = await keep(offerId, title);
    if (r.ok) return { ok: true };
    return r.code === 'gone' ? { ok: false, gone: true } : { ok: false, gone: false, failure: r };
  } catch (e) {
    return failed(e);
  }
}

/** No: the offer is dropped. `gone` is as good as done for the person. */
export async function declineOffer(decline: (offerId: string) => Promise<{ ok: true } | { ok: false; code: string }>, offerId: string): Promise<OfferOutcome> {
  try {
    const r = await decline(offerId);
    return r.ok || r.code === 'gone' ? { ok: true } : failed(new Error(r.code));
  } catch (e) {
    return failed(e);
  }
}
