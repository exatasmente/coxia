import { WINDOW_DAYS, effectKey } from '../../../shared/efeitos';
import type { Effect } from '../../../shared/types';
import { errorText } from '../api';
import { efeitosApi, useEfeitos } from '../efeitosApi';
import { useState } from 'react';

function when(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// "feito em …" / "aguardando" / "não verificável" for one effect, plus the manual mark.
export function EfeitoStatus({ effect, ceremonyId, date }: { effect: Effect; ceremonyId: string | null; date?: string }) {
  const { view, set } = useEfeitos();
  const [error, setError] = useState<string | null>(null);
  if (date && Date.now() - new Date(`${date}T00:00:00`).getTime() > (WINDOW_DAYS + 1) * 86_400_000) return null;
  const entry = view?.entries[effectKey(effect)];
  const state = entry?.state ?? 'waiting';

  const mark = (done: boolean) =>
    efeitosApi.mark(effect, ceremonyId, done).then(
      (v) => {
        setError(null);
        set(v);
      },
      (e) => setError(errorText(e)),
    );

  return (
    <span className="row" style={{ gap: 8 }}>
      {state === 'done' && (
        <span className="badge badge-now" title={entry?.evidence ?? undefined}>
          feito em {entry?.doneAt ? when(entry.doneAt) : '?'}{entry?.manual ? ' (à mão)' : ''}
        </span>
      )}
      {state === 'waiting' && <span className="badge badge-block" title={entry?.evidence ?? entry?.reason}>aguardando</span>}
      {state === 'unverifiable' && <span className="badge badge-quiet" title={entry?.reason}>não verificável</span>}
      {state !== 'done' && <button type="button" className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }} onClick={() => void mark(true)}>Marcar como feito</button>}
      {state === 'done' && entry?.manual && <button type="button" className="btn" style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }} onClick={() => void mark(false)}>Desfazer</button>}
      {error && <span className="small" style={{ color: 'var(--red-ink)' }}>{error}</span>}
    </span>
  );
}
