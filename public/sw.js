// Rastrum service worker — app-shell cache.
// See docs/specs/modules/03-offline.md.
//
// Cache strategy:
//   - HTML pages: network-first (so users always get the latest JS hashes
//     when they're online; falls back to cached HTML when offline).
//   - Astro-hashed JS/CSS/assets (paths under /_astro/ or with a hash in
//     the filename): cache-first (these are immutable per their URL).
//   - Manifest, favicon, sw.js itself: network-first so updates land fast.
//
// Bump VERSION to invalidate every cached entry on the next visit.
const VERSION = 'rastrum-shell-v5-2026-04-27';
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

// Allow the page to ping us if it ever wants to force-update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Web Push ── (ux-streak-push)
//
// The streak-push EF sends payload-less notifications (just VAPID auth +
// TTL). We render a fixed bilingual reminder body — picking ES vs EN by
// the language of the most recently focused/visible client, falling back
// to the document `lang`. Tapping the notification opens /profile/.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let lang = 'es';
    try {
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      const last = clients[0];
      if (last) {
        const url = new URL(last.url);
        if (url.pathname.startsWith('/en/')) lang = 'en';
      }
    } catch { /* fall through to default */ }

    const title = lang === 'en' ? 'Your streak is 1 day from breaking' : 'Tu racha está a 1 día de romperse';
    const body = lang === 'en'
      ? 'Log one observation today (with confidence ≥ 40%) to keep it alive.'
      : 'Registra una observación hoy (con confianza ≥ 40 %) para mantenerla viva.';
    const tag = 'rastrum-streak-reminder';

    await self.registration.showNotification(title, {
      body,
      tag,
      icon: '/rastrum-logo.svg',
      badge: '/favicon.svg',
      renotify: false,
      data: { lang, target: lang === 'en' ? '/en/profile/' : '/es/perfil/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.target || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if (c.url.includes(target) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

function isImmutableAsset(url) {
  // Astro emits hashed filenames under /_astro/ — those are content-addressed
  // and safe to cache forever. Same for files matching .[8+hex].js/.css.
  return url.pathname.startsWith('/_astro/')
    || /\.[A-Za-z0-9]{8,}\.(js|css|woff2?|png|jpg|svg|webp|avif)$/.test(url.pathname);
}

function isHtmlNavigation(req, url) {
  if (req.mode === 'navigate') return true;
  if (req.headers.get('accept')?.includes('text/html')) return true;
  return url.pathname.endsWith('/') || url.pathname.endsWith('.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept third-party API calls — Supabase, Anthropic, PlantNet,
  // OpenFreeMap tiles. Failures should surface so the outbox kicks in.
  if (url.hostname.includes('supabase.co')
   || url.hostname.includes('anthropic.com')
   || url.hostname.includes('plantnet.org')
   || url.hostname.includes('openfreemap.org')
   || url.hostname.includes('unpkg.com')) {
    return;
  }

  // R2 user-media (observation photos/audio) — skip caching, let network handle.
  // Model weights and tiles hosted on rastrum.app ARE cached below.
  const isUserMedia = (url.hostname === 'media.rastrum.app' || url.hostname === 'media.rastrum.org')
    && url.pathname.startsWith('/observations/');
  if (isUserMedia) return;

  // Only intercept same-origin + known rastrum.app asset hosts.
  const isRastrumAsset = url.origin === location.origin
    || url.hostname === 'media.rastrum.app'
    || url.hostname === 'tiles.rastrum.app';
  if (!isRastrumAsset) return;

  // HTML navigations: network-first — always pull the latest so new JS
  // hashes land. Fall back to whatever is in the cache (or '/') offline.
  if (isHtmlNavigation(req, url)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Hashed assets: cache-first (URLs are content-addressed).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Everything else (manifest, favicon, sw.js, root paths without a hash):
  // stale-while-revalidate so users get fresh content fast but offline still works.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
