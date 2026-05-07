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
const VERSION = 'rastrum-shell-2026.5.2';

// Page-managed cache (written by src/lib/offline-map.ts) holding the
// full pmtiles archive as a single 200 Response. The fetch handler
// below serves Range requests from this entry by slicing the body.
const PMTILES_CACHE_NAME = 'rastrum/pmtiles';
const SHARE_TARGET_CACHE = 'rastrum-share-target-v1';
const SHARE_TARGET_PATH  = '/share-target';
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

// Caches owned by the page (not the SW shell). They persist across SW
// upgrades — deleting them would wipe a user's downloaded offline map
// or in-flight share-target stash.
const PERSISTENT_CACHES = new Set([PMTILES_CACHE_NAME, SHARE_TARGET_CACHE]);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== VERSION && !PERSISTENT_CACHES.has(k))
          .map(k => caches.delete(k))
      )
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

// Serve pmtiles range requests from the offline-map cache. The cache
// holds a single 200 Response with the full archive body; pmtiles
// makes byte-range fetches, so we slice the cached body and return a
// 206 Partial Content. On cache miss we fall through to network.
//
// Spec: tests/unit/sw-pmtiles-range.test.ts pins the slicing algorithm.
async function servePmtilesRange(req, url) {
  try {
    const cache = await caches.open(PMTILES_CACHE_NAME);
    const cached = await cache.match(url.href);
    if (!cached) return fetch(req);

    const range = req.headers.get('range');
    if (!range) return cached;

    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return cached;

    const start = parseInt(m[1], 10);
    const end   = parseInt(m[2], 10);
    const buf   = await cached.arrayBuffer();
    const total = buf.byteLength;
    if (start >= total) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const sliceEnd = Math.min(end + 1, total);
    const slice = buf.slice(start, sliceEnd);

    const headers = new Headers();
    const contentType = cached.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    const etag = cached.headers.get('etag');
    if (etag) headers.set('ETag', etag);
    headers.set('Content-Range', `bytes ${start}-${sliceEnd - 1}/${total}`);
    headers.set('Content-Length', String(slice.byteLength));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(slice, {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  } catch {
    return fetch(req);
  }
}

// ── Web Share Target ──
// When the OS share sheet POSTs to /share-target, stash the file in Cache
// Storage and redirect to the /share-target page (GET) where the client
// retrieves it and hands it off to the observation form.

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ── Share Target: intercept POST /share-target ──
  if (req.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const file = formData.get('audio') || formData.get('image') || formData.get('video');
        const sharedTitle = String(formData.get('title') ?? '');
        const sharedText  = String(formData.get('text')  ?? '');
        const sharedUrl   = String(formData.get('url')   ?? '');
        if (file instanceof File && file.size > 0) {
          const meta = JSON.stringify({ filename: file.name, title: sharedTitle, text: sharedText, url: sharedUrl });
          const stashRes = new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-Rastrum-Share-Meta': meta,
            },
          });
          const shareCache = await caches.open(SHARE_TARGET_CACHE);
          await shareCache.put(SHARE_TARGET_PATH + '-stash', stashRes);
        }
      } catch (swErr) {
        console.warn('[rastrum-sw] share-target stash error:', swErr);
      }
      return Response.redirect(SHARE_TARGET_PATH, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')
   || url.hostname.includes('anthropic.com')
   || url.hostname.includes('plantnet.org')
   || url.hostname.includes('openfreemap.org')
   || url.hostname.includes('unpkg.com')) {
    return;
  }

  // R2 user-media (observation photos/audio) — skip caching, let network handle.
  const isUserMedia = url.hostname === 'media.rastrum.org'
    && url.pathname.startsWith('/observations/');
  if (isUserMedia) return;

  // Offline-map (pmtiles) — serve range requests from the page-managed
  // cache so MapLibre doesn't hit the network on every map load when
  // the archive has been downloaded via Profile → Edit → Offline maps.
  // Falls through to network on cache miss.
  const isPmtiles = url.hostname === 'media.rastrum.org'
    && /^\/maps\/.+\.pmtiles$/.test(url.pathname);
  if (isPmtiles) {
    event.respondWith(servePmtilesRange(req, url));
    return;
  }

  // Only intercept same-origin from here. Other media.rastrum.org paths
  // pass through (matches the runbook contract for third-party hosts).
  if (url.origin !== location.origin) return;

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
