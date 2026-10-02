import { useEffect, useState } from 'react';
import type { OutboxItem } from '../../shared/outbox';
import { useT } from './i18n';
import { dismiss, replay, retryNow, subscribe } from './outbox';

// Channels whose answer the server keeps: the screen shows it on open. The others answered only to the page that asked.
const SAVED = new Set(['qa:ask', 'retro:ask', 'gate:answer', 'gate:explain', 'actions:conflict']);

// Browser build only: what is waiting to be sent, what finished while the app was closed, and what failed for good.
export function OutboxBanner() {
  const t = useT();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => subscribe(setItems), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const queued = items.filter((i) => i.status === 'queued');
  const done = items.filter((i) => i.status === 'done');
  const failed = items.filter((i) => i.status === 'failed');
  const last = done[done.length - 1];
  if (!items.length) return null;

  const sendNow = () => {
    setBusy(true);
    void replay().finally(() => setBusy(false));
  };

  return (
    <div className="outbox" role="status" aria-live="polite">
      {queued.length > 0 && (
        <div className="outbox-item outbox-wait">
          <div className="outbox-text">
            <strong>{t(queued.length === 1 ? 'ui.outbox.queuedOne' : 'ui.outbox.queuedOther', { count: queued.length })}</strong>
            <span className="small"> {t(online ? 'ui.outbox.waitingNow' : 'ui.outbox.waiting')}</span>
            <div className="small outbox-labels">{queued.map((i) => i.label).join(' · ')}</div>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={sendNow}>
            {busy ? <span className="spinner" /> : null} {t('ui.outbox.sendNow')}
          </button>
        </div>
      )}
      {done.length > 0 && (
        <div className="outbox-item outbox-ok">
          <div className="outbox-text">
            <strong>{done.length > 1 ? t('ui.outbox.doneMany', { count: done.length }) : t('ui.outbox.doneOne', { label: last.label })}</strong>
            {done.length > 1 && <div className="small">{t('ui.outbox.latest', { label: last.label })}</div>}
            {last.excerpt && <div className="small outbox-labels">{last.excerpt}</div>}
            <div className="small">{t(SAVED.has(last.channel) ? 'ui.outbox.answerSaved' : 'ui.outbox.answerLate')}</div>
          </div>
          <button type="button" className="btn" onClick={() => void Promise.all(done.map((i) => dismiss(i.id)))}>{t('ui.outbox.ok')}</button>
        </div>
      )}
      {failed.map((i) => (
        <div key={i.id} className="outbox-item outbox-fail">
          <div className="outbox-text">
            <strong>{t('ui.outbox.failedTitle', { label: i.label })}</strong>
            <div className="small">{i.error}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void retryNow(i.id)}>{t('ui.outbox.retry')}</button>
            <button type="button" className="btn" onClick={() => void dismiss(i.id)}>{t('ui.outbox.discard')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
