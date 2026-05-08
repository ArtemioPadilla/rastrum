# Taxa enrichment (GBIF) — runbook

> Hydrates `taxa.kingdom / phylum / class / order / family / genus` from
> the GBIF species/match API. Without this, the identify cascade only
> ever fills `kingdom` (Claude) and `family` (PlantNet), leaving the
> sunburst + dendrogram visualisations on `/explore/species/` unable to
> group by taxonomic rank.

## Architecture

```
┌─────────┐   upsert(taxa)    ┌─────────────────┐
│identify │ ────────────────▶ │ enrich-taxon EF │
│   EF    │   fire-and-forget │  (single mode)  │
└─────────┘                   └────────┬────────┘
                                       │  GET /v1/species/match
                                       ▼
                              api.gbif.org (free, no auth)
                                       │
                              UPDATE taxa SET kingdom=…, …

┌──────────────────────┐    ┌─────────────────┐
│ enrich-taxa.yml      │    │ enrich-taxon EF │
│ - schedule: 06:00 UTC│ ──▶│  (batch mode)   │
│ - workflow_dispatch  │    │  limit≤500      │
└──────────────────────┘    └─────────────────┘
                                       │  for each taxon WHERE
                                       │  kingdom IS NULL OR genus IS NULL
                                       ▼
                              GBIF + UPDATE (rate-limited 4.5 req/s)
```

## Modes

The EF accepts two body shapes:

| Mode    | Body                                              | Auth                    |
|---------|---------------------------------------------------|-------------------------|
| Single  | `{ "taxon_id": "uuid" }` or `{ "scientific_name": "Aratinga canicularis" }` | `X-Cron-Secret` **or** `Authorization: Bearer <SERVICE_ROLE>` |
| Batch   | `{ "batch": true, "limit": 100 }`                 | `X-Cron-Secret` only    |

## Triggers

### Automatic — on identify

`supabase/functions/identify/index.ts` calls
`enrich-taxon` (single mode) fire-and-forget after every `taxa` upsert.
New species observed via the cascade enter with full lineage within ~1
second. Failures are logged + absorbed; the identify response never
blocks on enrichment.

### Automatic — nightly

`.github/workflows/enrich-taxa.yml` runs at **06:00 UTC** daily, batch
mode, `limit=250`. Catches:

- Taxa from before this PR shipped (kingdom NULL).
- Taxa where the on-identify call failed (network, GBIF 5xx).
- Taxa where GBIF added/changed a record after the initial enrichment.

After the initial backfill the nightly run finishes in seconds —
day-to-day drift is dominated by genuinely new species observed.

### Manual

```bash
gh workflow run enrich-taxa.yml -f limit=500
```

Use this once after deploying the EF for the first-time backfill (most
taxa are NULL). 500 rows take ~110 s wall clock at the polite GBIF rate
(`curl --max-time 1200` gives 10× headroom for slow GBIF / 429 retries).
The EF caps `limit` at 500 internally regardless of input.

## How it merges with existing data

`enrich-taxon` only fills **NULL** columns; it never overwrites a value
already on the row. Curated entries (e.g. NOM-059 admin edits) are
safe.

If GBIF returns `matchType: "NONE"` (unknown species), the row is
skipped — neither updated nor errored. The skip count is reported in
the workflow summary as `enriched < attempted`.

## Verification

After a run, count the rows that still need enrichment:

```bash
make db-psql
```

```sql
SELECT
  count(*) FILTER (WHERE kingdom IS NULL) AS no_kingdom,
  count(*) FILTER (WHERE genus IS NULL)   AS no_genus,
  count(*)                                 AS total
FROM taxa;
```

Inspect a hydrated row:

```sql
SELECT scientific_name, kingdom, phylum, class, "order", family, genus
FROM taxa
WHERE scientific_name = 'Aratinga canicularis';
```

Hit the EF directly to test single-mode auth + GBIF connectivity:

```bash
curl -s -X POST \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"scientific_name":"Aratinga canicularis"}' \
  "https://reppvlqejgoqvitturxp.supabase.co/functions/v1/enrich-taxon" | jq
# → { ok: true, attempted: 1, enriched: 1 }
```

## Failure modes

| Symptom                                        | Cause                                          | Fix                                                          |
|------------------------------------------------|------------------------------------------------|--------------------------------------------------------------|
| Workflow returns HTTP 403                      | `CRON_SECRET` mismatch between Vault + Actions | See `docs/runbooks/cron-secret-rotation.md`                  |
| Workflow 200 but `enriched: 0, attempted: N`   | All N names unrecognised by GBIF               | Check the `errors[]` array in the response; usually misspellings or experimental binomials. Manually edit the row or accept as not-in-GBIF. |
| `enriched < attempted` consistently            | GBIF down or rate-limiting                     | Check `https://www.gbif.org/`; back off and retry with smaller `limit`. |
| Identify EF logs `enrich-taxon dispatch failed` | EF undeployed or wrong URL                     | `gh workflow run deploy-functions.yml -f function=enrich-taxon` |

## Deploying the EF

`supabase/functions/enrich-taxon/` follows the standard cron-only
pattern (deployed `--no-verify-jwt`, gated by `X-Cron-Secret`). The
deploy workflow auto-includes it via the on-disk function-list scan;
manual redeploy:

```bash
gh workflow run deploy-functions.yml -f function=enrich-taxon
```

## Why GBIF and not the LLM?

Claude is asked for `kingdom` + `family` in the structured-output
prompt because they help the user immediately during identification.
The other ranks (phylum/class/order/genus) require an authoritative
reference — asking the model risks hallucination on lesser-known taxa.
GBIF's `species/match` endpoint is free, requires no auth, returns
canonical lineage, and stays under our zero-cost target.
