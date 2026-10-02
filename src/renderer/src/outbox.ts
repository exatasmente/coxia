// Offline queue of the browser build: user-initiated sends that fail for lack of network wait in IndexedDB and are replayed
// when the connection returns (service worker "sync" event, or here on online/visibility/timer). The server dedupes by the
// idempotency id, so a replay never runs an agent call twice. The service worker (public/sw.js) shares the same store.
import { IDEMPOTENCY_HEADER, OUTBOX_CHANNEL, OUTBOX_DB, OUTBOX_MAX_AGE_MS, OUTBOX_STORE, OUTBOX_TAG, QUEUEABLE, type OutboxItem } from '../../shared/outbox';
import { decodeWire } from '../../shared/wire';

// Same event name as webApi's UNAUTHORIZED (not imported: webApi imports this module).
const UNAUTHORIZED = 'cerimonias:unauthorized';

const RETRY_STATUS = new Set([408, 429, 502, 503, 504]);
const POLL_MS = 20_000;
const KEEP_DONE_MS = 24 * 3600_000;

const url = (path: string): string => new URL(path, document.baseURI).href;

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const open = indexedDB.open(OUTBOX_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    open.onsuccess = () => ok(open.result);
    open.onerror = () => fail(open.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, fail) => {
    const req = run(d.transaction(OUTBOX_STORE, mode).objectStore(OUTBOX_STORE));
    req.onsuccess = () => {
      d.close();
      ok(req.result);
    };
    req.onerror = () => {
      d.close();
      fail(req.error);
    };
  });
}

const all = (): Promise<OutboxItem[]> => tx('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>).then((items) => items.sort((a, b) => a.createdAt - b.createdAt));
const put = (item: OutboxItem): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(item));
const remove = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));

type Waiter = { ok: (v: unknown) => void; fail: (e: Error) => void };
const waiters = new Map<string, Waiter>();
const listeners = new Set<(items: OutboxItem[]) => void>();
let channel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export const randomId = (): string => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

function announce(): void {
  channel?.postMessage('changed');
  void emit();
}

async function emit(): Promise<void> {
  const items = await all().catch(() => [] as OutboxItem[]);
  for (const cb of [...listeners]) cb(items);
  const queued = items.some((i) => i.status === 'queued');
  if (queued && !timer) timer = setInterval(() => void replay(), POLL_MS);
  if (!queued && timer) {
    clearInterval(timer);
    timer = null;
  }
}

const excerptOf = (result: unknown): string | undefined => {
  const r = result as { text?: unknown; ack?: unknown } | null;
  const text = typeof r?.text === 'string' ? r.text : typeof r?.ack === 'string' ? r.ack : undefined;
  return text ? text.replace(/\s+/g, ' ').slice(0, 160) : undefined;
};

export function isTransientFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  return typeof (e as { status?: unknown })?.status === 'number' && RETRY_STATUS.has((e as { status: number }).status);
}

export function queuedLabel(channelName: string): string {
  return QUEUEABLE[channelName] ?? channelName;
}

export async function enqueue(item: Pick<OutboxItem, 'id' | 'channel' | 'body'>): Promise<void> {
  await put({ ...item, label: queuedLabel(item.channel), createdAt: Date.now(), attempts: 0, status: 'queued' });
  announce();
  try {
    const reg = await navigator.serviceWorker?.ready;
    await (reg as unknown as { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync?.register(OUTBOX_TAG);
  } catch {}
}

/** Resolves with the call's result once the queued send has been replayed, rejects with its error if it failed for good. */
export function waitFor(id: string): Promise<unknown> {
  return new Promise((ok, fail) => waiters.set(id, { ok, fail }));
}

type Attempt = 'done' | 'failed' | 'later' | 'login';

async function attempt(item: OutboxItem): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(url(`api/rpc/${encodeURIComponent(item.channel)}`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1', [IDEMPOTENCY_HEADER]: item.id },
      body: item.body,
    });
  } catch {
    await put({ ...item, attempts: item.attempts + 1 });
    return 'later';
  }
  const text = await res.text().catch(() => '');
  if (res.ok) {
    let excerpt: string | undefined;
    try {
      excerpt = excerptOf(decodeWire((JSON.parse(text) as { result?: unknown }).result));
    } catch {}
    await put({ ...item, attempts: item.attempts + 1, status: 'done', result: text, excerpt });
    return 'done';
  }
  if (res.status === 401) return 'login';
  if (RETRY_STATUS.has(res.status)) {
    await put({ ...item, attempts: item.attempts + 1 });
    return 'later';
  }
  let error = `Erro ${res.status}`;
  try {
    error = (JSON.parse(text) as { error?: string }).error ?? error;
  } catch {}
  await put({ ...item, attempts: item.attempts + 1, status: 'failed', error });
  return 'failed';
}

async function withLock<T>(run: () => Promise<T>): Promise<T | undefined> {
  const locks = navigator.locks;
  if (!locks) return run();
  return locks.request(OUTBOX_CHANNEL, { ifAvailable: true }, (lock) => (lock ? run() : undefined)) as Promise<T | undefined>;
}

// Hands finished items to whoever was waiting for them in this page.
async function settle(): Promise<void> {
  for (const item of await all()) {
    const w = waiters.get(item.id);
    if (!w || item.status === 'queued') continue;
    waiters.delete(item.id);
    await remove(item.id);
    if (item.status === 'done') {
      try {
        w.ok(decodeWire((JSON.parse(item.result ?? '{}') as { result?: unknown }).result));
      } catch (e) {
        w.fail(e as Error);
      }
    } else w.fail(new Error(item.error ?? 'Não foi possível enviar.'));
  }
}

let replaying = false;

/** Sends what is waiting, oldest first, stopping at the first network failure. */
export async function replay(): Promise<void> {
  if (replaying) return;
  replaying = true;
  try {
    await withLock(async () => {
      for (const item of (await all()).filter((i) => i.status === 'queued')) {
        if (Date.now() - item.createdAt > OUTBOX_MAX_AGE_MS) {
          await put({ ...item, status: 'failed', error: 'Passou muito tempo na fila; envie de novo.' });
          continue;
        }
        const r = await attempt(item);
        if (r === 'login') {
          window.dispatchEvent(new Event(UNAUTHORIZED));
          break;
        }
        if (r === 'later') break;
      }
    });
    await settle();
  } catch {
    // IndexedDB unavailable (private mode): the queue just does not exist.
  } finally {
    replaying = false;
    announce();
  }
}

export async function dismiss(id: string): Promise<void> {
  waiters.get(id)?.fail(new Error('Descartado.'));
  waiters.delete(id);
  await remove(id);
  announce();
}

export async function retryNow(id: string): Promise<void> {
  const item = (await all()).find((i) => i.id === id);
  if (!item) return;
  await put({ ...item, status: 'queued', error: undefined, createdAt: Date.now() });
  announce();
  await replay();
}

export function subscribe(cb: (items: OutboxItem[]) => void): () => void {
  listeners.add(cb);
  void emit();
  return () => listeners.delete(cb);
}

/** Starts the triggers: reconnection, coming back to the page, and the service worker finishing a replay. */
export function startOutbox(): void {
  if (typeof indexedDB === 'undefined') return;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(OUTBOX_CHANNEL);
    channel.onmessage = () => void settle().then(emit);
  }
  window.addEventListener('online', () => void replay());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void replay();
  });
  void all().then(async (items) => {
    for (const i of items) if (i.status !== 'queued' && Date.now() - i.createdAt > KEEP_DONE_MS) await remove(i.id);
    await replay();
  }, () => undefined);
}
