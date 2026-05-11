# Conservation Status ETL Runbook

**Issue:** #550
**Components:** `supabase/functions/refresh-conservation-status/`, `scripts/backfill-conservation-status.mjs`

---

## Overview

Rastrum's `taxa` table has two conservation-status columns:

| Column | Source | Update frequency |
|--------|--------|-----------------|
| `iucn_category` | GBIF Species API (backed by IUCN Red List) | Monthly via pg_cron |
| `nom059_status` | Static NOM-059-SEMARNAT-2010 lookup (embedded) | On deploy |

These columns power the karma conservation multiplier in `award_karma()` and the microcopy in `microcopyForVote()`.

---

## Data Sources

### IUCN via GBIF Species API
- **Endpoint:** `GET https://api.gbif.org/v1/species/{gbifKey}`
- **Auth:** None (free public API)
- **Rate limit:** ≤ 5 req/s (use 220 ms inter-call delay)
- **Field read:** `iucnRedListCategory` → mapped to `LC|NT|VU|EN|CR|EW|EX|DD|NE`
- **Fallback:** `threatStatuses[]` array (same mapping)
- **Docs:** https://www.gbif.org/developer/species

### NOM-059-SEMARNAT-2010
- **Source:** CONABIO published species list (updated 2023)
- **URL:** https://www.gob.mx/semarnat/documentos/nom-059-semarnat-2010
- **Format:** Static lookup embedded in both the Edge Function and the backfill script
- **Categories:** `E` (Probably extinct), `P` (Endangered), `A` (Threatened), `Pr` (Subject to special protection)
- **Scope:** Mexico-endemic and Mexico-present species only; most `taxa` rows stay NULL

---

## One-Time Backfill

Run this after deploying the schema migration (which adds `conservation_synced_at`):

```bash
# Dry run first to preview changes
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/backfill-conservation-status.mjs --limit=1000 --dry-run

# Full backfill (all taxa with gbif_taxon_key)
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/backfill-conservation-status.mjs --limit=5000
```

**Expected output:**
```
Starting backfill. limit=5000 dry-run=false
  ✓ Panthera onca: IUCN=VU NOM059=P
  ✓ Ara militaris: IUCN=VU NOM059=P
  ...........
Done. processed=1247 updated=89 errors=0
```

**Estimated time:** ~4.5 minutes per 1,000 taxa (GBIF rate limit).

---

## Nightly Delta Refresh (pg_cron)

The cron entry at the bottom of `docs/specs/infra/supabase-schema.sql` schedules the Edge Function to run on the 1st of each month at 03:00 UTC:

```sql
SELECT cron.schedule(
  'refresh-conservation-status',
  '0 3 1 * *',
  $$SELECT net.http_post(
      url    := current_setting('app.supabase_url') || '/functions/v1/refresh-conservation-status',
      headers := '{"x-cron-secret":"<CRON_SECRET>"}'::jsonb,
      body   := '{}'::jsonb
  )$$
);
```

To trigger manually via HTTP:
```bash
curl -X POST \
  https://<ref>.supabase.co/functions/v1/refresh-conservation-status \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

For a full backfill via the Edge Function:
```bash
curl -X POST \
  https://<ref>.supabase.co/functions/v1/refresh-conservation-status \
  -H "x-cron-secret: <CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"backfill": true, "limit": 500}'
```

---

## Coverage Smoke Check

After backfill or monthly cron, verify coverage:

```sql
-- Fraction of synced-observation taxa with non-NULL iucn_category
SELECT
  COUNT(*)                                          AS total_taxa_in_obs,
  COUNT(*) FILTER (WHERE t.iucn_category IS NOT NULL) AS with_iucn,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.iucn_category IS NOT NULL)
    / NULLIF(COUNT(*), 0), 1
  )                                                 AS iucn_pct
FROM (
  SELECT DISTINCT taxon_id FROM public.observations
  WHERE sync_status = 'synced'
) o
JOIN public.taxa t ON t.id = o.taxon_id
WHERE t.gbif_taxon_key IS NOT NULL;
```

**Target:** ≥ 60% iucn_pct after backfill. GBIF does not carry IUCN data for all taxa; some legitimate gaps are expected.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `conservation_synced_at` column missing | Schema migration not applied | Run `docs/specs/infra/supabase-schema.sql` migration section (#550) |
| GBIF returns 404 for all keys | Wrong `gbif_taxon_key` values | Check `enrich-taxon` EF enriched the taxa rows |
| Edge Function returns 401 | Missing `CRON_SECRET` header | Add `x-cron-secret` header matching the env secret |
| NOM-059 always NULL | Name format mismatch | Check `taxa.scientific_name` is canonical binomial lowercase |
| Very slow backfill | Rate limit respected | Normal — 220 ms/request, ~1,650 taxa/hour |

---

## Updating the NOM-059 Lookup

The embedded lookup in both the Edge Function and the backfill script covers the most commonly observed taxa. To expand it:

1. Download the full CONABIO list from:
   https://www.gob.mx/semarnat/documentos/nom-059-semarnat-2010
2. Export to CSV, extract columns: `nombre_cientifico`, `categoria`
3. Update `NOM059_LOOKUP` in both files:
   - `supabase/functions/refresh-conservation-status/index.ts`
   - `scripts/backfill-conservation-status.mjs`
4. Re-run backfill with `--dry-run` to preview changes
5. Deploy the updated Edge Function: `supabase functions deploy refresh-conservation-status`
