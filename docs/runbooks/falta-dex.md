# Falta-dex (taxonomic gaps panel)

> Operator notes for the Pokédex "missing species" surface introduced
> by issue [#726](https://github.com/ArtemioPadilla/rastrum/issues/726)
> (phase-1 of [#561](https://github.com/ArtemioPadilla/rastrum/issues/561)).

## What it is

`/{en,es}/{profile,perfil}/dex` and `/{en,es}/u/dex` (visitor view) now
support a "Show missing" toggle that appends silhouette cards for
species the user *has not* observed but that are present in their
region's pool. Card border is dashed grey, scientific name is revealed
("?" puzzle is the gameplay, not the secret), star rating reflects
rarity bucket, and a "Observe this" CTA links to the species page on
`/explore/species/`.

The toggle is **owner-only** — visitors looking at someone else's
`/u/<handle>/dex` never see the missing surface (privacy: revealing
which species someone hasn't observed is more invasive than revealing
which they have).

## Baseline source — Option A

The "expected pool" for a country is **the set of taxa with at least
one synced, research-grade, public observation made by an observer
whose `users.country_code` matches**. We considered two alternatives:

| Option | Pros | Cons | Picked? |
|---|---|---|---|
| **A — Rastrum's own community data as proxy** | No ETL, no external dep, refreshes automatically, honest about its limits | Bootstrap problem in low-density regions | yes (v1) |
| B — Curated GBIF baseline per state/ecoregion | More authoritative, larger pool | Needs a separate ETL job + license review (GBIF DOI per export); overkill for v1 | v1.1 |

The disclaimer copy in both locales says exactly this: *"Estimación
basada en observaciones de la comunidad de Rastrum en tu región —
datos incompletos para algunas áreas. (Baseline de GBIF llegará en
v1.1.)"*

## SQL surface

Two functions in `supabase-schema.sql` (idempotent `CREATE OR REPLACE`):

### `profile_pokedex_with_missing(p_user_id uuid, p_region_country text default null, p_missing_limit int default 60)`

`SECURITY DEFINER` because it joins `users.country_code` (which RLS
on `users` allows reads of for `profile_public = true` rows but the
join is cleaner with definer rights) and the missing-pool query
needs consistent semantics regardless of viewer.

Behaviour:
1. Gates on `can_see_facet(p_user_id, 'pokedex', auth.uid())`.
   Anonymous + privacy-blocked viewers get **zero rows**.
2. Resolves region: `upper(p_region_country)` wins, else
   `(SELECT country_code FROM users WHERE id = p_user_id)`.
3. Returns a UNION ALL of `profile_pokedex` rows
   (`is_missing = false`) and missing rows (`is_missing = true`).
4. Missing rows are scoped to `taxa.taxon_rank = 'species'` and
   excluded by `NOT EXISTS` against the user's existing pokedex.
5. Missing rows ordered `taxon_rarity.bucket DESC NULLS LAST,
   regional_obs_count ASC` — rarest + scarcest first.
6. `p_missing_limit` is clamped to `[1, 200]`.

### `region_species_pool_size(p_region_country text)`

Cheap denominator for the "X of Y species in your region" line.
`STABLE PARALLEL SAFE`. Anonymous-readable (count is non-PII).

## UI contract

- Toggle button + count line live in `#pokedex-missing-toolbar`,
  rendered between the kingdom pills and the species grid.
- Toggle preference persisted in `localStorage.rastrum.pokedex.showMissing`.
  Default = false (off). Helper: `src/lib/pokedex-missing.ts`.
- Disclaimer (`#pokedex-missing-disclaimer`) only renders when
  `showMissing && missing.length > 0`.
- The kingdom-pill filter applies to missing cards too — they have a
  `data-kingdom` attribute and are toggled by the same handler.
- Missing cards are **not** rendered for visitor mode.

## Manual verification

```sql
-- Pick any user, e.g. yourself
SELECT user_id, scientific_name, rarity_bucket, obs_count, is_missing
  FROM profile_pokedex_with_missing(
    p_user_id => '<your-uuid>',
    p_region_country => 'MX',
    p_missing_limit => 10
  )
 ORDER BY is_missing, rarity_bucket DESC NULLS LAST;

-- Expected: present rows first (is_missing=false, your dex), then up
-- to 10 missing rows (is_missing=true) sorted rarity DESC.

SELECT region_species_pool_size('MX');
-- Expected: integer count of distinct species in MX research-grade pool.
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Toggle shows but missing list is empty | Region pool empty (`country_code` not set on user, or no research-grade observations in country) | Set country in Profile → Edit; await community to log RG observations |
| Disclaimer text missing | New i18n key not synced | Verify `pokedex.missing.disclaimer` exists in both `en.json` and `es.json` |
| Missing cards reveal scientific name | Working as intended — the card is a "wanted poster", not a quiz | (n/a) |
| Visitor view shows missing cards | Regression — owner-only invariant broken | Check `runVisitor()` does not call `loadFalta()` |

## v1.1 follow-ups

- GBIF baseline (Option B): seed a `region_taxon_baseline` table from
  GBIF state-level checklists; query the pool from there instead of
  Rastrum-internal observations. Need license review + DOI tracking.
- Missing-by-rank (orders / families): the original [#726](https://github.com/ArtemioPadilla/rastrum/issues/726)
  framing showed "te faltan 3 órdenes". Ship after the GBIF baseline
  lands so the totals are meaningful.
- "Where to find" mini-map per missing card — kernel of the regional
  observations of that taxon.
- `?suggested_taxon=<id>` on `/observe` so the CTA pre-fills the
  identification field.
