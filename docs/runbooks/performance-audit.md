# Performance Audit Runbook

_Issue #713 — cache & performance optimization. Last updated: 2026-05-10._

## Bundle Analysis

Run `npm run analyze` to open the interactive Rollup/Vite bundle visualiser in your browser.

```bash
cd /path/to/rastrum
npm run analyze
```

This generates `stats.html` (or opens a dev-server, depending on the
`vite-bundle-visualizer` version installed). Look for:

- Chunks > 50 KB (uncompressed) that load on **every route**.
- Duplicate packages (e.g., lodash-es imported under two aliases).
- Heavy vendor bundles that could be lazy-loaded.

### Known heavy surfaces (as of v1.1.5)

| Route / component | Approx. size (uncompressed) | Notes |
|---|---|---|
| `/explore/map/` | ~1.1 MB (MapLibre + pmtiles) | MapLibre loaded eagerly; consider dynamic import gated on map tab activation. |
| `/profile/` | ~280 KB | Three parallel Supabase queries on load — consolidation tracked in #713. |
| `/batch-import/` | ~420 KB | Workers + canvas API for EXIF; lazy on route. |

### Lazy-load recommendations

Components that are below-the-fold or only needed on explicit user action
should be dynamically imported:

```ts
// ✅ Good — loaded only when user opens the dialog
const { openCropModal } = await import('../lib/photo-crop-controller');

// 🔴 Bad — loaded on every page that contains ObserveView2
import { openCropModal } from '../lib/photo-crop-controller';
```

Apply the same pattern to:

- `MapPicker.astro` (Leaflet) — only needed when user opens location edit.
- `BatchImporter.astro` — dedicated route, already lazy via Astro routing.
- `CommunityMapView.astro` — only on `/community/map/`.

---

## Service Worker Cache Strategy

File: `public/sw.js`

Current strategy (correct, do not change):

| URL pattern | Strategy | Rationale |
|---|---|---|
| HTML pages | Network-first | Users get latest JS hashes when online; cached fallback offline. |
| `/_astro/**` (hashed) | Cache-first | Immutable; hash in filename busts automatically. |
| `/manifest.webmanifest`, `/favicon.svg` | Network-first | Small; must update fast. |
| pmtiles archive | Page-managed | Written by `src/lib/offline-map.ts`; SW serves Range requests from Cache API. |

### Verify cache headers in production

Expected response headers for `/_astro/` assets:

```
Cache-Control: public, max-age=31536000, immutable
```

Check with:
```bash
curl -sI https://rastrum.app/_astro/some-chunk.HASH.js | grep cache-control
```

If missing, add to `astro.config.mjs` → `server.headers` or Cloudflare Page Rule.

---

## Database Index Review

Added in this PR (issue #713 + #803):

```sql
-- identifications hot path for probable_taxa_at() and cache recompute
CREATE INDEX idx_id_primary_taxon
  ON identifications (observation_id, taxon_id)
  WHERE is_primary = true AND taxon_id IS NOT NULL;

-- feed and profile tab pagination
CREATE INDEX idx_obs_synced_at
  ON observations (observer_id, observed_at DESC)
  WHERE sync_status = 'synced';

-- notification bell badge (unread count per user)
CREATE INDEX idx_activity_target_unread
  ON activity_events (target_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- probable_taxa_cache lookup
CREATE INDEX probable_taxa_cache_geohash5_month_score_idx
  ON probable_taxa_cache (geohash5, month, score DESC);
```

### Indexes to verify in production

Run in Supabase SQL editor to check index usage:

```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename IN ('observations', 'identifications', 'activity_events', 'probable_taxa_cache')
ORDER BY idx_scan DESC;
```

Indexes with `idx_scan = 0` after 7 days of production traffic should be
reviewed for removal or replacement.

---

## probable_taxa_cache (issue #803)

The `probable_taxa_at()` RPC now checks a pre-computed
`probable_taxa_cache` table before running the live `ST_DWithin` query.

- Cache is populated nightly by the `recompute-taxa-cache` Edge Function (03:00 UTC).
- Cache miss (new geohash5 cell) falls through to live query transparently.
- Expected latency improvement at scale: 300 ms → < 50 ms for cached cells.

See [contextual-suggestions.md](contextual-suggestions.md) for the "Cache layer"
section (previously marked "deferred").

---

## Query Consolidation — Profile Page

The profile page currently fires 5+ parallel Supabase queries on load:

1. `users` — profile data
2. `observations` count + recents
3. `user_stats` — species count, karma
4. `user_badges` — earned badges
5. `user_streaks` — streak data

**Recommendation**: consolidate into a single `get_profile_summary(handle)` RPC
returning all fields in one round-trip. Tracked in #713 for a follow-up PR.

---

## Web Vitals Budget

| Metric | Target | Current (Lighthouse CI) |
|---|---|---|
| LCP | < 2.5 s (4G mobile) | TBD — run `npm run test:lhci` |
| CLS | < 0.1 | TBD |
| INP | < 200 ms | TBD |

Run Lighthouse CI:
```bash
npm run build
npm run test:lhci
```

Results are stored in `.lighthouseci/` — check `lhci autorun` output for
budget violations.

---

## Trigger Thresholds (when to act)

From the contextual-suggestions runbook cache-layer section:

- `probable_taxa_at` p95 > 500 ms → verify cache is being hit (`SELECT COUNT(*) FROM probable_taxa_cache`).
- `probable_taxa_cache` row count < 1000 after first nightly run → check `recompute-taxa-cache` EF logs.
- Bundle size increase > 10% in a single PR → require bundle diff in PR description.
