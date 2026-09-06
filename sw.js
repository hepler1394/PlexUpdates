// PlexHub service worker.
//
// Scope is deliberately narrow: this worker only ever answers for files on
// its own origin. Cross-origin requests (Firebase SDK modules from gstatic,
// TMDB, fonts, icons) are left to the browser untouched. The previous
// version routed those through cache-first handlers, and on every visit
// after the first the Firebase module imports failed inside the worker,
// which left the page stuck on "Finding good options" with nothing
// clickable. Never route third-party script imports through a worker.
const CACHE_NAME = 'plexhub-v7-no-api-cache';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch((err) => console.log('SW: shell precache skipped:', err && err.message))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // third parties: browser default
  if (url.pathname.startsWith('/api/')) return;      // live answers (the ask helper): never cached

  // HTML: network first so releases are never trapped behind the cache,
  // with the cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          try { return (await caches.match(request)) || (await caches.match('/index.html')) || Response.error(); }
          catch { return Response.error(); }
        })
    );
    return;
  }

  // Same-origin assets: cache first, network fallback, never throw.
  event.respondWith((async () => {
    try {
      const cached = await caches.match(request);
      if (cached) return cached;
    } catch {}
    const response = await fetch(request);
    if (response && response.ok) {
      try {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
      } catch {}
    }
    return response;
  })());
});
