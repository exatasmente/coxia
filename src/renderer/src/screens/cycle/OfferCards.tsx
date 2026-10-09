import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { LIMITS } from '../../../../shared/procedures';
import { OFFERS_EVENT, type OfferView } from '../../../../shared/proceduresView';
import { moduleEvents } from '../../api';
import { useT } from '../../i18n';
import { ERROR_KEY } from '../procedures/editModel';
import { KIND_LABEL } from '../procedures/labels';
import { OFFER_REFRESH_MS, declineOffer, keepOffer, readOffers, type OfferOutcome } from '../procedures/offerModel';
import { Refusals } from '../procedures/RecordEditor';
import { proceduresApi } from '../procedures/proceduresApi';
import { agentName } from './names';

// The offer to keep a procedure: after work in which nobody saved one, the app shows what it recorded of it and asks. The card is the computer's: a paired browser is
// refused the channels, so it draws nothing there. It sits beside the cards of the screen's questions but is not one: nothing waits on it, and an unanswered offer goes away
// after 24 hours. Yes saves exactly the text shown, under the title in the field; the app refuses what the checks refuse and the card says which field and why.

type Failure = Extract<OfferOutcome, { gone: false; ok: false }>['failure'];

function Why({ failure }: { failure: Failure }) {
  const t = useT();
  if (failure.refusals?.length) return <Refusals failure={failure} />;
  const key = failure.code === 'duplicate' ? 'ui.procedures.offer.duplicate' : ERROR_KEY[failure.code];
  return <div className="error" role="alert">{key ? t(key) : failure.text}</div>;
}

/** One offer: the draft as it would be saved, the title to edit, and Yes and No. `onKeep` and `onDecline` say what became of the answer. */
export function OfferCard({ offer, team, onKeep, onDecline }: { offer: OfferView; team: readonly AgentDef[] | undefined; onKeep(title: string): Promise<OfferOutcome>; onDecline(): Promise<OfferOutcome> }) {
  const t = useT();
  const [title, setTitle] = useState(offer.title);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [gone, setGone] = useState(false);
  const agent = agentName(team, offer.agent);
  const answer = (send: () => Promise<OfferOutcome>): void => {
    setBusy(true);
    setFailure(null);
    void send().then((r) => {
      if (!r.ok) {
        if (r.gone) setGone(true);
        else setFailure(r.failure);
      }
      setBusy(false);
    });
  };
  return (
    <section className="cy-offer" role="group" aria-label={t('ui.procedures.offer.label', { agent })} data-kind={offer.kind}>
      <h3 className="cy-offer-title">{t('ui.procedures.offer.title')}</h3>
      <p className="cy-offer-line">{t('ui.procedures.offer.lead', { agent })}</p>
      <p className="faint small">{t('ui.procedures.offer.about', { kind: t(KIND_LABEL[offer.kind]), key: offer.key })}</p>
      <label className="small cy-offer-field">
        {t('ui.procedures.offer.titleField')}
        <input className="text-input" value={title} maxLength={LIMITS.title} disabled={busy || gone} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {failure && <Why failure={failure} />}
      <section className="cy-offer-block" aria-label={t('ui.procedures.panel.steps')}>
        <h4 className="cy-offer-sub">{t('ui.procedures.panel.steps')}</h4>
        <ol className="cy-offer-steps">
          {offer.steps.map((s, i) => (
            <li key={i}>
              <span>{s.text}</span>
              {s.run && <code className="mono cy-offer-run">{s.run}</code>}
            </li>
          ))}
        </ol>
      </section>
      {offer.pitfalls.length > 0 && (
        <section className="cy-offer-block" aria-label={t('ui.procedures.panel.pitfalls')}>
          <h4 className="cy-offer-sub">{t('ui.procedures.panel.pitfalls')}</h4>
          <ul className="cy-offer-list">{offer.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      )}
      {offer.waits.length > 0 && (
        <section className="cy-offer-block" aria-label={t('ui.procedures.panel.waits')}>
          <h4 className="cy-offer-sub">{t('ui.procedures.panel.waits')}</h4>
          <ul className="cy-offer-list">{offer.waits.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      )}
      {offer.leftOut > 0 && <p className="faint small">{t('ui.procedures.offer.leftOut', { count: offer.leftOut })}</p>}
      {offer.handoff && <p className="small cy-offer-warning" role="note">{t('ui.procedures.offer.handoff')}</p>}
      {gone ? (
        <p className="small" role="status">{t('ui.procedures.offer.gone')}</p>
      ) : (
        <div className="row cy-offer-actions">
          <button type="button" className="btn btn-dark" disabled={busy} onClick={() => answer(() => onKeep(title))}>{t('ui.procedures.offer.yes')}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => answer(onDecline)}>{t('ui.procedures.offer.no')}</button>
        </div>
      )}
      <p className="faint small">{t('ui.procedures.offer.expires')}</p>
    </section>
  );
}

/** The offers waiting in a thread, each as a card; nothing at all while none waits, and nothing where the app refuses the read (a paired browser). */
export function OfferCards({ thread, team }: { thread: string; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const [offers, setOffers] = useState<OfferView[]>([]);
  const live = useRef(true);
  const read = useCallback((): void => {
    // A paired browser is refused the channel, and a refused read is no offers: the card needs no check of where it runs.
    void readOffers(() => proceduresApi.offers(thread)).then((v) => live.current && setOffers(v));
  }, [thread]);

  useEffect(() => {
    live.current = true;
    read();
    const visible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    moduleEvents.addEventListener(OFFERS_EVENT, read);
    window.addEventListener('focus', read);
    const timer = window.setInterval(visible, OFFER_REFRESH_MS);
    return () => {
      live.current = false;
      moduleEvents.removeEventListener(OFFERS_EVENT, read);
      window.removeEventListener('focus', read);
      window.clearInterval(timer);
    };
  }, [read]);

  if (offers.length === 0) return null;
  return (
    <div className="cy-offers" role="region" aria-label={t('ui.procedures.offer.list')}>
      {offers.map((o) => (
        <OfferCard
          key={o.offerId}
          offer={o}
          team={team}
          onKeep={async (title) => {
            const r = await keepOffer(proceduresApi.keepOffer, o.offerId, title);
            read();
            return r;
          }}
          onDecline={async () => {
            const r = await declineOffer(proceduresApi.declineOffer, o.offerId);
            read();
            return r;
          }}
        />
      ))}
    </div>
  );
}
