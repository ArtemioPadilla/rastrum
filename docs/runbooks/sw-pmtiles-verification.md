# SW pmtiles caching — post-deploy verification runbook

> **Issue**: #639 — Post-deploy verification: SW pmtiles caching actually works in the browser  
> **Relates to**: #635, #636, PR #795 (buffer memo), #817 (stale-memo fix), #818 (latency telemetry)

---

## Overview

Rastrum caches the `~48 MB` Mexico pmtiles archive in the browser Cache API so MapLibre can render the offline basemap with zero network round-trips. The Service Worker intercepts byte-range (`Range: bytes=A-B`) requests from the pmtiles JS library and returns `206 Partial Content` slices from the cached archive.

This runbook walks through confirming those mechanics are working correctly after a deploy.

---

## Pre-requisites

- A Chromium-based browser (Chrome / Edge recommended for DevTools fidelity).
- Access to a **non-cached device/profile** (use Incognito the first time, or clear `rastrum/pmtiles` from Cache Storage first).
- The deployed build must be `VERSION ≥ 2026.5.2` (the pmtiles range-serving SW landed in that release).

---

## Step 1 — Download the offline map

1. Sign in to **rastrum.org**.
2. Open **Profile → Edit → Offline maps**.
3. Tap / click **Download offline map**. The progress bar should fill from 0 → 100 %.
4. Confirm success: the button should change to **"Map downloaded"** (or similar), no error banner.

> **Failure check**: if the download fails with a CORS or network error, see [admin-ops.md](admin-ops.md).

---

## Step 2 — Verify the archive is in Cache Storage

1. Open **DevTools** (`F12` / `Cmd+Opt+I`).
2. Go to **Application** tab → **Cache Storage** (left sidebar).
3. You should see a cache named **`rastrum/pmtiles`**.
4. Click it. One entry should appear: the full URL of the pmtiles archive, e.g.  
   `https://media.rastrum.org/maps/mexico_z0_10.pmtiles`
5. Click the entry. In the **Headers** panel confirm:
   - `Status: 200`
   - `Content-Length` is non-zero (e.g. `50331648`)
   - An `ETag` header is present (e.g. `"2026.5.2-abc123"`)

> ✅ Pass: entry present, `Content-Length > 0`.  
> ❌ Fail: no entry or `Content-Length: 0` — re-run the download and check the network tab for the original `https://media.rastrum.org/maps/mexico_z0_10.pmtiles` fetch.

---

## Step 3 — Verify range requests are served by the SW

1. Hard-reload the page (`Ctrl+Shift+R` / `Cmd+Shift+R`) to load a clean state.
2. Open **Explore → Map** (navigate to the map view).
3. In DevTools, go to **Network** tab.
4. In the **Filter** box, type: `pmtiles`
5. Observe requests to `media.rastrum.org/maps/mexico_z0_10.pmtiles`.

**What to look for:**

| Column | Expected value |
|--------|---------------|
| **Status** | `206` |
| **Size** | `(ServiceWorker)` — the browser shows this when the response came from the SW |
| **Method** | `GET` |
| **Type** | `fetch` |

> ✅ Pass: every pmtiles request shows `(ServiceWorker)` in the Size column.  
> ❌ Fail: Size shows a byte count (the request went to the network). Check that the SW is active (see Step 5) and the cache entry is present (Step 2).

---

## Step 4 — Trigger a range request manually

You can verify the SW is slicing correctly with `fetch` in the DevTools Console:

```javascript
// Request bytes 0–127 from the cached archive.
const url = 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles';
const res = await fetch(url, { headers: { Range: 'bytes=0-127' } });
console.log('Status:', res.status);             // expected: 206
console.log('Content-Range:', res.headers.get('content-range')); // e.g. bytes 0-127/50331648
const buf = await res.arrayBuffer();
console.log('Slice length:', buf.byteLength);   // expected: 128
```

Or with `curl` (useful when testing a local dev build with a tunnelled URL):

```bash
curl -s -I \
  -H "Range: bytes=0-127" \
  "https://media.rastrum.org/maps/mexico_z0_10.pmtiles" \
  | grep -E "HTTP|content-range|x-rastrum"
```

Expected response headers:
```
HTTP/2 206
content-range: bytes 0-127/<total>
```

> **Note**: `curl` bypasses the SW (it has no SW context). Use the browser Console snippet above to verify SW interception specifically.

---

## Step 5 — Confirm SW is active

1. DevTools → **Application** → **Service Workers**.
2. Confirm the Rastrum SW is listed as **Activated and running** (green dot).
3. The SW URL should be `/sw.js` on the rastrum.org origin.
4. Check that **`VERSION`** in the SW script matches the deployed build (see the Sources panel or click on the SW URL).

> If the SW shows **Waiting to activate**, click **skipWaiting** or close all other rastrum tabs and reload.

---

## Step 6 — Inspect `pmtilesBufferMemo` (debug helper)

The SW keeps a module-level memo (`pmtilesBufferMemo`) to avoid re-decoding the 50 MB archive on every parallel range request. You can inspect it via the SW console:

1. DevTools → **Application** → **Service Workers** → click **inspect** link.
2. This opens a separate DevTools for the SW context.
3. In the Console, run:

```javascript
// Peek at the current memo state
pmtilesBufferMemo
// Expected after first range request: { key: "https://…pmtiles|<etag>", buf: ArrayBuffer(50xxxxxx) }
// Expected when no archive is cached: null
```

4. After downloading a new map version (or triggering a re-download), confirm the memo is `null` (cleared by the `PMTILES_CACHE_UPDATED` message from `offline-map.ts#downloadPmtilesMx`).

---

## Step 7 — Latency telemetry (SW → page)

Since #818, the SW broadcasts a `pmtiles_latency` message to all connected clients after each range serve. You can observe this in the **page** DevTools Console:

```javascript
navigator.serviceWorker.addEventListener('message', e => {
  if (e.data?.type === 'pmtiles_latency') {
    console.log('[pmtiles latency]', e.data);
  }
});
```

Then scroll/zoom the map to trigger tile loads. You should see entries like:

```
[pmtiles latency] { type: 'pmtiles_latency', latencyMs: 2, source: 'cache-memo' }
[pmtiles latency] { type: 'pmtiles_latency', latencyMs: 45, source: 'cache-decode' }
```

**Source values:**

| `source` | Meaning |
|----------|---------|
| `cache-memo` | Hit the in-memory ArrayBuffer memo — fastest path (< 5 ms typical) |
| `cache-decode` | First request after SW startup or memo eviction — reads 50 MB from Cache Storage |
| `network-fallback` | Cache miss — fell through to network (archive not downloaded) |
| `cache-no-range` | Non-range request served directly from cache |
| `cache-416` | Requested byte offset out of range |
| `error-fallback` | Unexpected error in SW |

> ✅ Pass: `latencyMs` for `cache-memo` requests is consistently `< 10 ms`. Values above `200 ms` on repeat requests indicate memo not being hit.

---

## Pass / Fail Criteria

| Check | Pass | Fail |
|-------|------|------|
| Archive in Cache Storage | Entry present, `Content-Length > 0` | Missing or empty |
| Range requests | `206` + `(ServiceWorker)` in Network tab | Network fetches or `200` status |
| Manual `fetch` test | `Status 206`, correct slice length | Any other status |
| SW activated | Green "Activated and running" | Waiting or redundant |
| Latency telemetry | Messages appear in console, `cache-memo` < 10 ms | No messages or consistently high latency |
| Buffer memo cleared | After re-download, `pmtilesBufferMemo` is `null` in SW console | Memo retains old buffer |

---

## Troubleshooting

### Map renders tiles from network even with archive downloaded

- SW may not be activated. Reload after closing all tabs.
- The pmtiles URL might not match the pattern in `sw.js` (`/maps/*.pmtiles`). Check `isPmtiles` condition.

### `(ServiceWorker)` not showing in Network tab

- Filter by `pmtiles` in the Network tab. Confirm requests are `GET` with a `Range` header.
- Check the SW console for errors.

### `pmtilesBufferMemo` is null after map load

- Normal on the very first range request after SW startup. Should be populated after the first decode. If it stays null, the `servePmtilesRange` function may be returning early.

### Latency consistently high (`> 200 ms`) after first decode

- The memo may be getting cleared too aggressively. Check that `PMTILES_CACHE_UPDATED` messages are only sent after `cache.put` (not on every read).

### Re-download doesn't update map tiles

- Verify `PMTILES_CACHE_UPDATED` is dispatched (see Step 6 — memo should be `null` after re-download).
- MapLibre may need a full page reload to pick up the new archive.
