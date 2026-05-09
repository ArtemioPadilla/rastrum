# Runbook — Service worker cache invalidation

> When users report "stale UI", "blank page after deploy", or "old
> Spanish strings", the service worker is the usual suspect. This
> covers what the SW does, how to bump it cleanly, and what to tell
> the one stubborn user whose tab won't update.

The implementation lives in [`public/sw.js`](../../public/sw.js) and
the registration in [`src/layouts/BaseLayout.astro`](../../src/layouts/BaseLayout.astro).
Module spec: [`docs/specs/modules/03-offline.md`](../specs/modules/03-offline.md).

---

## Cache strategy in one paragraph

The SW handles three kinds of request:

- **HTML navigations** (`mode === 'navigate'` or `Accept: text/html`):
  **network-first**. We always fetch fresh HTML so the latest JS-hash
  references land. If the network fails, we serve the most recent
  cached HTML for the same URL, falling back to the root document.
  This is why a deploy reaches users immediately when they're online —
  the next click pulls fresh HTML, which references new hashed JS, and
  the rest happens automatically.
- **Hashed assets** (`/_astro/...` and any path with an 8+ character
  hash before the extension): **cache-first**. These URLs are
  content-addressed; the bundle hash is in the filename. Once cached,
  serve forever — different content gets a different URL.
- **Everything else** (manifest, favicon, sw.js itself, top-level
  unhashed paths): **stale-while-revalidate**. Serve from cache
  immediately, refresh in the background.

Third-party hosts (Supabase, Anthropic, PlantNet, OpenFreeMap) and
most paths under `media.rastrum.org` are explicitly **not**
intercepted — failures bubble up to the app code so the outbox kicks
in. See the `if (url.hostname.includes(...))` block at the top of the
fetch handler.

The one exception is `media.rastrum.org/maps/*.pmtiles`. Those
requests are served from the page-managed `rastrum/pmtiles` cache
when the user has downloaded the offline map (see
`src/lib/offline-map.ts`). The SW slices the cached 200 Response
into 206 Partial Content responses to satisfy MapLibre's byte-range
fetches. Without this, the cached archive is orphaned: the page can
write it, but nothing reads it back, so every map load still hits
the network. The slicing algorithm is pinned by
`tests/unit/sw-pmtiles-range.test.ts`.

The `rastrum/pmtiles` and `rastrum-share-target-v1` caches are
**persistent** — the `activate` handler skips them when pruning old
caches. Bumping VERSION wipes the shell cache but leaves a user's
downloaded offline map intact.

---

## Bumping the cache after a problematic deploy

`VERSION` in `public/sw.js` is a placeholder — `__BUILD_VERSION__` —
substituted at build time by `scripts/inject-version.js` from the
`PUBLIC_VERSION` env var, which the deploy workflow computes via CalVer
(`YYYY.M.<patch>`). **Do not edit the placeholder.** The placeholder is
restored after `astro build` so the working tree stays clean; if you see
`'rastrum-shell-…'` in source, it's a stale local checkout.

To force a cache flush, push any commit on `main` and let the deploy
workflow's CalVer counter increment the patch — that produces a new
`VERSION` string in the deployed `sw.js`, which triggers the install →
activate → cache-prune protocol described below. There is no
hand-edit step.

```bash
# Just push something — typo fix, doc tweak, anything.
git commit --allow-empty -m "chore(sw): force cache flush"
git push
gh run watch   # deploy.yml bumps the patch, builds, ships sw.js
```

What happens next on each user's device:

- They land on `rastrum.org`. The browser makes a navigation request.
- The currently installed SW serves cached HTML (network-first, but
  the network call is in flight).
- The browser also fetches `/sw.js` (network-first per its strategy
  above) and notices the bytes differ from what's installed.
- The new SW enters `installing` state. Its `install` handler runs,
  preloading the SHELL into a fresh cache keyed by the new VERSION
  string and calls `self.skipWaiting()`.
- The new SW activates, deletes every cache that isn't named the
  current VERSION (the `activate` handler's filter), and calls
  `clients.claim()` so the next request is served by the new code.

That's the whole protocol — bump VERSION, deploy, the next visit
upgrades cleanly.

---

## Helping a user who's stuck on old JS

When a user reports "I see the old version even after refreshing", the
fix is one of three things:

### 1. Hard-refresh

Most reliable. Bypasses both the SW and the HTTP cache.

- Chrome/Edge/Brave: **Ctrl+Shift+R** (Win/Linux) or **Cmd+Shift+R** (Mac).
- Firefox: same.
- Safari (macOS): **Cmd+Option+R**, or hold Shift while clicking reload.
- Mobile Safari / Chrome: pull down past the URL bar to refresh, or
  long-press the reload button → "Empty Cache and Hard Refresh".

### 2. Close + reopen the tab

If hard-refresh isn't an option (e.g. embedded webview), closing the
tab fully and reopening it is enough. The SW activates on the next
fetch.

### 3. Unregister the service worker (last resort)

For diagnostics or when caches got into a genuinely bad state:

1. DevTools → Application tab → Service Workers.
2. Click **Unregister** next to `rastrum.org` (or whatever host).
3. Application → Storage → Clear site data → Clear site data
   (this also clears IndexedDB, which holds the Dexie outbox — only do
   it if the user has nothing un-synced).
4. Hard-refresh.

On mobile Chrome the equivalent is Settings → Site settings →
`rastrum.org` → Clear & reset.

---

## Why we don't auto-`skipWaiting()` on every push

The SW only calls `self.skipWaiting()` from its **install** handler
(when a brand-new VERSION is installing) and on receipt of an explicit
`SKIP_WAITING` message from the page:

```js
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
```

The page does **not** send that message automatically. If we did,
every push would interrupt active users mid-task — a half-typed
observation form, an in-flight upload, an open camera viewfinder.
That's worse than waiting one more navigation.

The current contract is:

- Online users: get the new code on their next page navigation
  (network-first HTML pulls fresh JS hash references; new SW activates
  on the next fetch).
- Offline users: keep working with the cached version until they're
  back online.
- "I want it now" users: hard-refresh, which we already document.

This is intentional. If a future emergency deploy needs to interrupt
active users (e.g. a security fix), we add an in-app banner that
sends `SKIP_WAITING` after user confirmation. Don't bake it into the
default flow.

---

## Common bug patterns and where to look

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank page after a deploy on one user only | They have a stale SW serving an HTML that references a JS bundle that no longer exists on R2/CDN | Hard-refresh; if persistent, bump VERSION on the next deploy |
| Spanish strings updated in the repo but user still sees old text | The HTML is cached locally; the page might also have stale JS that hasn't fetched the new i18n bundle | Hard-refresh or wait for the next navigation |
| `media.rastrum.org/...` 404s | SW is **not** at fault — those URLs are passed through. Check the R2 hostname migration + bucket contents | See AGENTS.md "Known pitfalls" row about `media.rastrum.app → media.rastrum.org` |
| `_astro/index.<hash>.js` 404 | Hashed asset that was deployed and then a re-deploy purged it. Cache-first served the new HTML, but the corresponding JS no longer exists | Bump VERSION; root-cause the deploy that purged the old file |
| Cache-first asset stuck stale | Should not happen because hashed URLs change with content. If it does, you have a non-hashed asset matching the `isImmutableAsset()` regex by accident | Audit `isImmutableAsset()` in sw.js |

---

## Verifying a fix locally

```bash
make build
npx http-server dist -c -1   # disable HTTP cache so the SW is the only variable
```

Open the site in an incognito window so there's no preexisting SW
state. DevTools → Application → Service Workers should show the new
VERSION as active. Trigger a navigation; confirm the network panel
shows fresh HTML. Now offline (DevTools → Network → "Offline") and
re-navigate; confirm cached HTML serves.

The SW skips registration on `localhost` (BaseLayout passes
`navigator.serviceWorker.register('/sw.js')` only when
`window.location.hostname` isn't a local host), so always test against
a real preview server, never `astro dev`.
