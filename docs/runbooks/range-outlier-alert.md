# Range outlier alert (M35) — runbook

**Module:** [35 — Submit-time outlier alert](../specs/modules/35-range-outlier-alert.md)
**Issue:** #742
**Edge Function:** `refresh-taxon-ranges` (cron-only, `--no-verify-jwt`)
**Cron:** `refresh-taxon-ranges-weekly` — Sundays 04:00 UTC

---

## What it does

When the user submits an observation whose `(lat, lng)` is more than
50 km from the cascaded taxon's known range polygon, a soft confirm
modal asks "is this correct?" If they confirm, the obs lands with
`is_range_extension = true`; the detail page shows a violet "Posible
extensión de rango" pill and the obs is treated as priority by the
M22 community-validation queue.

## Components at a glance

| Piece | Where |
|---|---|
| `taxon_range_index` table | `docs/specs/infra/supabase-schema.sql` |
| `taxon_range_distance_km(uuid, numeric, numeric)` RPC | same file |
| `observations.is_range_extension` column | same file |
| `refresh_taxon_ranges()` SECURITY DEFINER worker | same file |
| `refresh-taxon-ranges` Edge Function | `supabase/functions/refresh-taxon-ranges/index.ts` |
| Pure helpers + RPC client | `src/lib/outlier-alert.ts` |
| Submit-time wiring | `src/components/ObservationForm.astro` (search for `checkOutlier`) |
| Pill on detail page | `src/components/ShareObsView.astro` (`[data-range-extension-pill]`) |
| Pill in personal list | `src/components/MyObservationsView.astro` (`labelRangeExtensionPill`) |
| Cron schedule | `docs/specs/infra/cron-schedules.sql` (#13) |

## Threshold

`DEFAULT_OUTLIER_THRESHOLD_KM = 50` (in `src/lib/outlier-alert.ts`).
Tuned for v1: catches accidental wrong-country submissions (typically
thousands of km) without false-positive nags on edge-of-range obs.

## Manual operations

### Fire the refresh once

```bash
gh workflow run deploy-functions.yml --ref main \
  -f function=refresh-taxon-ranges
gh run watch
```

…then via psql or the Supabase SQL editor:

```sql
SELECT public.refresh_taxon_ranges();  -- returns rows-updated count
```

The cron itself can be fired by inserting a `pg_cron`-style HTTP POST
manually:

```sql
SELECT net.http_post(
  url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/refresh-taxon-ranges',
  headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' ||
              (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') ||
              '"}')::jsonb,
  body    := '{}'::jsonb
);
```

### Verify the index after refresh

```sql
SELECT taxon_id, source, n_records, built_at
  FROM public.taxon_range_index
 ORDER BY built_at DESC
 LIMIT 10;

-- Spot-check a known taxon
SELECT public.taxon_range_distance_km(
  (SELECT id FROM taxa WHERE scientific_name = 'Quercus rugosa' LIMIT 1),
  19.4326, -99.1332     -- CDMX
);
```

NULL = no range data yet for that taxon (ineligible — < 10 RG obs in
the last 5 years).

### Drop the flag from a wrongly-confirmed obs

If a moderator decides a confirmed range extension was actually a
mis-ID, demote it via direct UPDATE (audit-logged via the standard
`admin_audit` row insert in `admin/` dispatcher):

```sql
UPDATE public.observations SET is_range_extension = false
WHERE id = '<uuid>';
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Modal never fires on a known outlier | Taxon has no range row yet (< 10 RG obs in 5 yr) | Expected — modal is silent on no-signal taxa. Confirm via `taxon_range_distance_km()` returning NULL. |
| Modal fires for clearly in-range obs | Convex hull is too aggressive — common with sparse, clustered data | Out-of-the-box: not actionable for v1. v1.1 will replace `rastrum_proxy` source with curated GBIF ranges. Workaround: bump threshold via the optional `thresholdKm` parameter. |
| `refresh_taxon_ranges()` fails with `cannot create geography(MultiPolygon)` | Single-row hull degenerates into a Point | The cron skips taxa with < 10 obs, so this shouldn't fire. If it does, the underlying observation has duplicate locations — investigate the cluster manually. |
| Pill missing on detail page | `is_range_extension` column not in SELECT | Check `src/pages/share/obs/index.astro` — column must be in the `.from('observations').select(...)` list. |

## Privacy notes

The check **does not leak any new info**. The RPC returns a single
distance to the public range polygon; the polygon itself is built only
from research-grade observations whose underlying obs are already
public. No private location data flows through the path.

## See also

- [Module 22 — Community Validation](../specs/modules/22-community-validation.md)
  — the "review queue" the confirmed range extensions land on.
- [Module 06 — Export](../specs/modules/06-export.md) — the
  `is_range_extension` flag is preserved in DwC export so downstream
  consumers can filter / weight it.
- [`falta-dex.md`](falta-dex.md) — the original "Option A: use Rastrum
  data as a proxy" decision the v1 range source mirrors.
