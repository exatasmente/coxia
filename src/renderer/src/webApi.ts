// Browser (PWA) stand-in for the preload: window.api over HTTP RPC + Server-Sent Events.
// Imported first in main.tsx so api.ts finds window.api.
import { buildApi } from '../../shared/apiChannels';
import type { AppEvent } from '../../shared/types';
import { isQueueable, IDEMPOTENCY_HEADER } from '../../shared/outbox';
import { decodeWire, encodeWire } from '../../shared/wire';
import { enqueue, isTransientFailure, randomId, startOutbox, waitFor } from './outbox';

export const UNAUTHORIZED = 'cerimonias:unauthorized';

const url = (path: string): string => new URL(path, document.baseURI).href;

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1', ...headers },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; result?: unknown };
  if (res.status === 401 && path !== 'api/login') window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) throw new HttpStatusError(res.status, data.error ?? `Erro ${res.status}`);
  return data;
}

export async function sessionCheck(): Promise<'ok' | 'login' | 'offline'> {
  try {
    const res = await fetch(url('api/session'), { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? 'ok' : res.status === 401 ? 'login' : 'offline';
  } catch {
    return 'offline';
  }
}

const listeners = new Set<(ev: AppEvent) => void>();
let source: EventSource | null = null;

function openEvents(): void {
  source = new EventSource(url('api/events'), { withCredentials: true });
  source.onmessage = (m) => {
    const ev = decodeWire(JSON.parse(m.data)) as AppEvent;
    for (const cb of [...listeners]) cb(ev);
  };
  // EventSource retries on its own; only a dead session needs the login screen.
  source.onerror = () => void sessionCheck().then((s) => s === 'login' && window.dispatchEvent(new Event(UNAUTHORIZED)));
}

function onEvent(cb: (ev: AppEvent) => void): () => void {
  listeners.add(cb);
  if (!source) openEvents();
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      source?.close();
      source = null;
    }
  };
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function rpc(channel: string, ...args: unknown[]): Promise<unknown> {
  const path = `api/rpc/${encodeURIComponent(channel)}`;
  if (!isQueueable(channel)) return decodeWire(((await post(path, encodeWire(args))) as { result?: unknown }).result);
  // A send that fails for lack of network waits in the outbox and is replayed with the same id (the server runs it once).
  const id = randomId();
  const wire = encodeWire(args);
  try {
    return decodeWire(((await post(path, wire, { [IDEMPOTENCY_HEADER]: id })) as { result?: unknown }).result);
  } catch (e) {
    if (!isTransientFailure(e)) throw e;
  }
  try {
    await enqueue({ id, channel, body: JSON.stringify(wire) });
  } catch {
    throw new Error('Sem conexão e não consegui guardar o envio para depois.');
  }
  return waitFor(id);
}

if (!('api' in window)) {
  document.documentElement.dataset.platform = 'web';
  (window as unknown as { api: unknown }).api = buildApi(rpc, onEvent, { copy });
  startOutbox();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined));
  }
}
