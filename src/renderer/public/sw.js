// App shell cache, Web Push and the offline outbox. The cache never touches /api.
const CACHE = 'cerimonias-shell-v1';
const ROOT = new URL('./', self.location.href).href;
const PRECACHE = [ROOT, `${ROOT}manifest.webmanifest`, `${ROOT}icon-192.png`, `${ROOT}icon-512.png`];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  if (response.ok && response.type === 'basic') await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

// index.html: the network wins so a new build shows up; the cache answers offline.
async function page(request) {
  try {
    return await put(ROOT, await fetch(request));
  } catch {
    const hit = await caches.match(ROOT);
    return hit ?? Response.error();
  }
}

// Hashed assets never change under the same name: cache first.
async function asset(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  return put(request, await fetch(request));
}

async function other(request) {
  try {
    return await put(request, await fetch(request));
  } catch {
    const hit = await caches.match(request);
    return hit ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  const rel = url.href.slice(ROOT.length);
  if (rel.startsWith('api/') || rel === 'sw.js') return;
  if (request.mode === 'navigate' || rel === '' || rel === 'index.html') event.respondWith(page(request));
  else if (rel.startsWith('assets/')) event.respondWith(asset(request));
  else event.respondWith(other(request));
});

// ---- Web Push ----
const pushIcon = `${ROOT}icon-192.png`;

function targetQuery(t) {
  const q = new URLSearchParams({ open: t.to });
  for (const key of ['ref', 'id', 'mr']) if (t[key]) q.set(key, t[key]);
  return q.toString();
}

// Every push must end in a visible notification (userVisibleOnly; iOS revokes the subscription otherwise).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Coxia';
  const target = data.target && typeof data.target.to === 'string' ? data.target : { to: 'today' };
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: pushIcon,
      badge: pushIcon,
      tag: typeof data.tag === 'string' ? data.tag : 'cerimonias',
      renotify: true,
      timestamp: typeof data.ts === 'number' ? data.ts : Date.now(),
      data: { target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.target) || { to: 'today' };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const mine = windows.find((c) => c.url.startsWith(ROOT));
      if (mine) {
        await mine.focus();
        mine.postMessage({ type: 'cerimonias:open', target });
        return;
      }
      await self.clients.openWindow(`${ROOT}?${targetQuery(target)}`);
    })(),
  );
});

async function rpc(channel, args) {
  const res = await fetch(`${ROOT}api/rpc/${encodeURIComponent(channel)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${channel}: ${res.status}`);
  return (await res.json()).result;
}

function urlBase64ToUint8Array(key) {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// The push service rotated or expired the subscription: get a new one and tell the server (which drops the old endpoint).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription ? event.oldSubscription.endpoint : undefined;
      let sub = event.newSubscription;
      if (!sub) {
        const key = await rpc('push:key', []);
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      }
      await rpc('push:subscribe', [sub.toJSON(), old]);
    })().catch(() => undefined),
  );
});

// ---- Offline outbox (Background Sync) ----
// Shares IndexedDB 'cerimonias-outbox' with the page (src/renderer/src/outbox.ts, src/shared/outbox.ts): keep the names in sync.
const OUTBOX_DB = 'cerimonias-outbox';
const OUTBOX_STORE = 'items';
const OUTBOX_TAG = 'cerimonias-outbox';
const OUTBOX_MAX_AGE_MS = 6 * 3600_000;
const RETRY_STATUS = [408, 429, 502, 503, 504];

function outboxDb() {
  return new Promise((ok, fail) => {
    const open = indexedDB.open(OUTBOX_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    open.onsuccess = () => ok(open.result);
    open.onerror = () => fail(open.error);
  });
}

async function outboxTx(mode, run) {
  const db = await outboxDb();
  return new Promise((ok, fail) => {
    const req = run(db.transaction(OUTBOX_STORE, mode).objectStore(OUTBOX_STORE));
    req.onsuccess = () => {
      db.close();
      ok(req.result);
    };
    req.onerror = () => {
      db.close();
      fail(req.error);
    };
  });
}

const outboxPut = (item) => outboxTx('readwrite', (s) => s.put(item));

async function outboxReplay() {
  const items = (await outboxTx('readonly', (s) => s.getAll())).filter((i) => i.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  let retry = false;
  for (const item of items) {
    if (!/^[a-z]+:[a-z]+$/.test(item.channel)) continue;
    if (Date.now() - item.createdAt > OUTBOX_MAX_AGE_MS) {
      await outboxPut({ ...item, status: 'failed', error: 'Passou muito tempo na fila; envie de novo.' });
      continue;
    }
    let res;
    try {
      res = await fetch(`${ROOT}api/rpc/${encodeURIComponent(item.channel)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1', 'X-Idempotency-Key': item.id },
        body: item.body,
      });
    } catch {
      await outboxPut({ ...item, attempts: item.attempts + 1 });
      retry = true;
      break;
    }
    const text = await res.text().catch(() => '');
    if (res.ok) {
      let excerpt;
      try {
        const r = JSON.parse(text).result;
        const t = r && (typeof r.text === 'string' ? r.text : typeof r.ack === 'string' ? r.ack : undefined);
        excerpt = t ? t.replace(/\s+/g, ' ').slice(0, 160) : undefined;
      } catch {}
      await outboxPut({ ...item, attempts: item.attempts + 1, status: 'done', result: text, excerpt });
    } else if (res.status === 401) {
      break;
    } else if (RETRY_STATUS.includes(res.status)) {
      await outboxPut({ ...item, attempts: item.attempts + 1 });
      retry = true;
      break;
    } else {
      let error = `Erro ${res.status}`;
      try {
        error = JSON.parse(text).error || error;
      } catch {}
      await outboxPut({ ...item, attempts: item.attempts + 1, status: 'failed', error });
    }
  }
  try {
    new BroadcastChannel(OUTBOX_DB).postMessage('changed');
  } catch {}
  // Rejecting makes the browser schedule the sync again with backoff.
  if (retry) throw new Error('outbox: still offline');
}

async function outboxLocked() {
  if (self.navigator.locks) {
    await self.navigator.locks.request(OUTBOX_DB, { ifAvailable: true }, (lock) => (lock ? outboxReplay() : undefined));
  } else {
    await outboxReplay();
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_TAG) event.waitUntil(outboxLocked());
});
