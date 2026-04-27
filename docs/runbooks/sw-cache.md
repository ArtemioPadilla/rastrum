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

Third-party hosts (Supabase, Anthropic, PlantNet, OpenFreeMap,
`media.rastrum.org`, `tiles.rastrum.org`) are explicitly **not**
intercepted — failures bubble up to the app code so the outbox kicks
in. See the `if (url.hostname.includes(...))` block at the top of the
fetch handler.

---

## Bumping the cache after a problematic deploy

```js
// public/sw.js
const VERSION = 'rastrum-shell-v3-2026-04-26';   // ← bump this
```

The convention is `rastrum-shell-v<n>-YYYY-MM-DD`. Increment the `v<n>`
when the cache structure (the SHELL array, the strategy, the
intercept rules) changes. Update the date for any push that requires
purging old cached entries.

```bash
# 1. Edit public/sw.js, bump VERSION.
# 2. Commit + push:
git add public/sw.js
git commit -m "fix(sw): bump cache to v4 to flush stale shell entries"
git push
# 3. CI runs deploy.yml; the new sw.js lands on rastrum.org.
gh run watch
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
