import { useEffect, useState } from 'react';
import type { OutboxItem } from '../../shared/outbox';
import { plural } from './api';
import { dismiss, replay, retryNow, subscribe } from './outbox';

// Channels whose answer the server keeps: the screen shows it on open. The others answered only to the page that asked.
const SAVED = new Set(['qa:ask', 'retro:ask', 'gate:answer', 'gate:explain', 'actions:conflict']);

// Browser build only: what is waiting to be sent, what finished while the app was closed, and what failed for good.
export function OutboxBanner() {
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
            <strong>{plural(queued.length, 'envio na fila', 'envios na fila')}</strong>
            <span className="small"> — envia quando a conexão voltar{online ? ' (tentando agora)' : ''}.</span>
            <div className="small outbox-labels">{queued.map((i) => i.label).join(' · ')}</div>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={sendNow}>
            {busy ? <span className="spinner" /> : null} Enviar agora
          </button>
        </div>
      )}
      {done.map((i) => (
        <div key={i.id} className="outbox-item outbox-ok">
          <div className="outbox-text">
            <strong>Enviado: {i.label}</strong>
            {i.excerpt && <div className="small outbox-labels">{i.excerpt}</div>}
            <div className="small">{SAVED.has(i.channel) ? 'A resposta já está salva; abra a tela para ver.' : 'A resposta chegou depois que você saiu da tela.'}</div>
          </div>
          <button type="button" className="btn" onClick={() => void dismiss(i.id)}>Ok</button>
        </div>
      ))}
      {failed.map((i) => (
        <div key={i.id} className="outbox-item outbox-fail">
          <div className="outbox-text">
            <strong>Não foi possível enviar: {i.label}</strong>
            <div className="small">{i.error}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => void retryNow(i.id)}>Tentar de novo</button>
            <button type="button" className="btn" onClick={() => void dismiss(i.id)}>Descartar</button>
          </div>
        </div>
      ))}
    </div>
  );
}
