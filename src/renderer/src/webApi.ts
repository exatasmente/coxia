// Browser (PWA) stand-in for the preload: window.api over HTTP RPC + Server-Sent Events.
// Imported first in main.tsx so api.ts finds window.api.
import { EVENTS_RECONNECTED } from '../../shared/activity';
import { buildApi } from '../../shared/apiChannels';
import { CONTRACT_HEADER, CONTRACT_VERSION, type ErrorCode, isErrorCode } from '../../shared/contract';
import { t } from '../../shared/i18n';
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
    /** The stable code of the failure, when the instance sent one from the closed list. */
    readonly code?: ErrorCode,
  ) {
    super(message);
  }
}

// Every call says which contract this page was built with, so an instance that moved on refuses it instead of answering a call it cannot follow.
const CONTRACT = { [CONTRACT_HEADER]: String(CONTRACT_VERSION) };

export async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1', ...CONTRACT, ...headers },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: unknown; result?: unknown };
  if (res.status === 401 && path !== 'api/login') window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) throw new HttpStatusError(res.status, data.error ?? t('ui.error.http', { status: res.status }), isErrorCode(data.code) ? data.code : undefined);
  return data;
}

/** 'mismatch' carries the instance's own words, which name both versions. */
export async function sessionCheck(): Promise<'ok' | 'login' | 'offline' | { mismatch: string }> {
  try {
    const res = await fetch(url('api/session'), { credentials: 'same-origin', cache: 'no-store', headers: CONTRACT });
    if (res.status === 409) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: unknown };
      if (data.code === 'contract-mismatch' && data.error) return { mismatch: data.error };
    }
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
  let dropped = false;
  source.onopen = () => {
    if (dropped) window.dispatchEvent(new Event(EVENTS_RECONNECTED));
    dropped = false;
  };
  // EventSource retries on its own; only a dead session needs the login screen.
  source.onerror = () => {
    dropped = true;
    void sessionCheck().then((s) => s === 'login' && window.dispatchEvent(new Event(UNAUTHORIZED)));
  };
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
    throw new Error(t('ui.error.saveSendFailed'));
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
