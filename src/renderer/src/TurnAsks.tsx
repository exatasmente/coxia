import { useEffect, useState } from 'react';
import { EVENTS_RECONNECTED } from '../../shared/activity';
import { TURN_ASKS_EVENT, type PendingTurnAsk, type TurnAnswerResult, type TurnDecision } from '../../shared/turnLimit';
import { api, errorText, moduleEvents } from './api';
import { intlLocale, useT } from './i18n';
import { sameTurnAsks, turnAskLines } from './turnAskView';
import './turnAsks.css';

/** The questions an agent or a sub-agent leaves at its turn limit: read once, then the whole list on every change, when the connection comes back and when the window does. */
export function useTurnAsks(): [PendingTurnAsk[], (id: string) => void] {
  const [list, setList] = useState<PendingTurnAsk[]>([]);
  useEffect(() => {
    let live = true;
    const take = (next: PendingTurnAsk[]) => live && setList((cur) => (sameTurnAsks(cur, next) ? cur : next));
    const read = () => void api.invoke<PendingTurnAsk[]>('turnAsks:list').then((next) => Array.isArray(next) && take(next), () => undefined);
    const on = (e: Event) => take((e as CustomEvent<PendingTurnAsk[]>).detail ?? []);
    moduleEvents.addEventListener(TURN_ASKS_EVENT, on);
    window.addEventListener('focus', read);
    window.addEventListener(EVENTS_RECONNECTED, read);
    read();
    return () => {
      live = false;
      moduleEvents.removeEventListener(TURN_ASKS_EVENT, on);
      window.removeEventListener('focus', read);
      window.removeEventListener(EVENTS_RECONNECTED, read);
    };
  }, []);
  return [list, (id) => setList((l) => l.filter((x) => x.id !== id))];
}

const clock = (iso: string): string | null => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
};

// The card of one question. Both buttons go through the one call every answerer uses; an answer that comes back as gone (another screen answered first) only takes the card away.
export function TurnAskCard({ item, onDone }: { item: PendingTurnAsk; onDone: (id: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = turnAskLines(item, t, clock);
  const answer = (decision: TurnDecision) => {
    setBusy(true);
    setError(null);
    void api.invoke<TurnAnswerResult>('turnAsks:answer', item.id, decision).then(
      (r) => {
        if (r.ok || r.reason === 'gone') onDone(item.id);
        else {
          setError(t('ui.turnAsk.refused'));
          setBusy(false);
        }
      },
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  return (
    <section className="cc-item" aria-labelledby={`ta-${item.id}`}>
      <h2 id={`ta-${item.id}`} className="cc-title">{lines.title}</h2>
      {lines.details.map((d) => (
        <p key={d} className="small ta-detail">{d}</p>
      ))}
      <div className="row cc-actions">
        {lines.continueLabel && (
          <button type="button" className="btn btn-dark" disabled={busy} onClick={() => answer('continue')}>{lines.continueLabel}</button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => answer('finish')}>{lines.finishLabel}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
