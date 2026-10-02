// App shell cache: installability and a fast start. Never touches /api.
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
