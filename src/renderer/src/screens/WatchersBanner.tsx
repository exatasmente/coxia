import { useEffect, useState } from 'react';
import type { WatcherAlert } from '../../../shared/watchers';
import type { Screen } from '../App';
import { watchersApi } from '../watchersApi';

export function WatchersBanner({ go }: { go: (s: Screen) => void }) {
  const [alerts, setAlerts] = useState<WatcherAlert[]>([]);

  useEffect(() => {
    void watchersApi.list().then(setAlerts, () => undefined);
    return watchersApi.onChanged(setAlerts);
  }, []);

  if (!alerts.length) return null;

  return (
    <>
      {alerts.map((a) => {
        const stop = a.kind === 'rejections';
        const card = a.card;
        return (
          <div
            key={a.id}
            className="item row spread"
            style={stop ? { background: 'var(--red-soft)', borderColor: '#fca5a5' } : { background: 'var(--amber-soft)', borderColor: 'var(--amber-line)' }}
          >
            <div>
              <div className="small" style={{ color: stop ? 'var(--red-ink)' : 'var(--amber-ink)', fontWeight: 600 }}>{a.message}</div>
              {a.detail && <div className="faint">{a.detail}</div>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {card && (
                <button type="button" className="btn btn-dark" onClick={() => go({ name: 'gate', ref: card.ref, card })}>Abrir o gate</button>
              )}
              <button type="button" className="btn" onClick={() => void watchersApi.dismiss(a.id).then(setAlerts)}>Dispensar</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
