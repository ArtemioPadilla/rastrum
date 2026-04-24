// Rastrum service worker — v0.1 shell cache.
// See docs/specs/modules/03-offline.md.
//
// v0.1 scope: cache app shell (HTML, CSS, JS, fonts, favicon) for offline
// render. Observations are queued via Dexie on the page itself, not here.
// Workbox / full sync-queue lands in v0.3.
const VERSION = 'rastrum-shell-v1';
const SHELL = [
  '/',
  '/en/',
  '/es/',
  '/favicon.svg',
  '/rastrum-logo.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept API calls — Supabase, Anthropic, PlantNet, OpenFreeMap tiles.
  // Failures should surface to the app so the outbox can kick in.
  if (url.hostname.includes('supabase.co')
   || url.hostname.includes('anthropic.com')
   || url.hostname.includes('plantnet.org')
   || url.hostname.includes('openfreemap.org')
   || url.hostname.includes('unpkg.com')) {
    return;
  }

  // Cache-first for same-origin GETs
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => caches.match('/'));   // last-resort offline fallback
      })
    );
  }
});
