# Pokédex + Especies Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photo-first cards across both `/perfil/dex/` and `/explorar/especies/`, with per-page heroes that drive each engagement loop (pride/completion for Pokédex, discovery for Especies).

**Architecture:** Schema additions (extended `profile_pokedex`, new `taxa_thumbnails`, `featured_species_current`, `mv_platform_stats`, `suggest_pokedex_target` RPC) feed a shared component family (`SpeciesCard`, `*Hero`, `KingdomPills`, `FilterChips`) that replaces the body of two thin orchestrator views.

**Tech Stack:** Astro 4 + TypeScript strict, Tailwind, Supabase Postgres + PostGIS, Vitest, Playwright. R2 for media.

**Spec:** `docs/superpowers/specs/2026-05-06-pokedex-especies-visual-design.md`.

---

## File Structure

| Layer | Files |
|---|---|
| Schema | `docs/specs/infra/supabase-schema.sql` (additions only) |
| Pure logic | `src/lib/species-display.ts`, `src/lib/species-filters.ts` |
| Shared cards | `src/components/species/SpeciesCard.astro`, `src/components/species/SpeciesCardGrid.astro` |
| Pokédex chrome | `src/components/species/KingdomPills.astro`, `src/components/species/PokedexHero.astro` |
| Especies chrome | `src/components/species/FeaturedSpeciesCard.astro`, `src/components/species/PlatformStats.astro`, `src/components/species/EspeciesHero.astro`, `src/components/species/FilterChips.astro` |
| Orchestrators (modified) | `src/components/PokedexView.astro`, `src/components/ExploreSpeciesView.astro` |
| i18n | `src/i18n/en.json`, `src/i18n/es.json` |
| Tests | `tests/unit/species-display.test.ts`, `tests/unit/species-filters.test.ts`, `tests/e2e/pokedex-especies.spec.ts` |

Files that change together live together. The `species/` directory is new; everything visual species-related goes there.

---

## Phase 1 — Schema foundation

Order matters. `taxa_thumbnails` is needed by `featured_species_current` and the Especies fetch. `profile_pokedex` extension is needed by Pokédex hero. Apply each in order; each task includes its own apply + verify.

### Task 1: `taxa_thumbnails` view

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append after line 2853, the existing `profile_pokedex` GRANT)

- [ ] **Step 1: Add the view definition**

Append to the schema file, immediately after the `GRANT SELECT ON public.profile_pokedex TO anon, authenticated;` line (currently line 2853):

```sql
-- ═════════════════════════════════════════════════════════════════════
-- Module 34 — Pokédex/Especies visual redesign (2026-05-06)
-- Adds: taxa_thumbnails, featured_species_current, mv_platform_stats,
-- suggest_pokedex_target, and extends profile_pokedex.
-- Spec: docs/superpowers/specs/2026-05-06-pokedex-especies-visual-design.md
-- ═════════════════════════════════════════════════════════════════════

-- taxa_thumbnails: one representative photo URL per taxon, picked from the
-- most-recent synced primary identification's primary photo. Used by
-- ExploreSpeciesView and FeaturedSpeciesCard.
CREATE OR REPLACE VIEW public.taxa_thumbnails AS
SELECT
  t.id AS taxon_id,
  (SELECT mf.url
     FROM public.media_files mf
     JOIN public.observations o ON o.id = mf.observation_id
     JOIN public.identifications i ON i.observation_id = o.id
    WHERE i.is_primary = true
      AND i.taxon_id = t.id
      AND o.sync_status = 'synced'
      AND o.obscure_level <> 'full'
    ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at DESC
    LIMIT 1) AS thumbnail_url
FROM public.taxa t;

GRANT SELECT ON public.taxa_thumbnails TO anon, authenticated;
```

- [ ] **Step 2: Apply schema**

```bash
make db-apply
```

Expected: `applied successfully` (no error rows).

- [ ] **Step 3: Verify view exists and returns rows**

```bash
make db-psql -c "SELECT taxon_id, thumbnail_url FROM public.taxa_thumbnails WHERE thumbnail_url IS NOT NULL LIMIT 3;"
```

Expected: 0–3 rows. (0 is acceptable if the local DB has no synced obs with primary photos; verify the query at least *runs*.)

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): add taxa_thumbnails view (M34)"
```

---

### Task 2: Extend `profile_pokedex` view

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (replace existing `profile_pokedex` definition near line 2832)

The existing view aggregates per-taxon. We restructure with a CTE so we can attach a thumbnail via correlated subquery without breaking GROUP BY. Output column order is preserved 1–7; new columns are appended at positions 8–13. `CREATE OR REPLACE VIEW` is sufficient (append-only, so the auto-memory rule is satisfied).

- [ ] **Step 1: Replace the existing view definition**

Replace the block from `-- Pokédex — every taxon the user has observed...` through `GRANT SELECT ON public.profile_pokedex TO anon, authenticated;` (currently lines 2831–2853) with:

```sql
-- Pokédex — every taxon the user has observed, joined to taxon_rarity.
-- M34 (2026-05-06): added common_name_*, slug, endemic_mx, nom059_status,
-- thumbnail_url for the visual redesign. Existing column order preserved.
CREATE OR REPLACE VIEW public.profile_pokedex AS
WITH base AS (
  SELECT
    o.observer_id    AS user_id,
    i.taxon_id,
    COALESCE(t.scientific_name, i.scientific_name) AS scientific_name,
    t.kingdom,
    tr.bucket        AS rarity_bucket,
    MIN(o.observed_at)    AS first_observed_at,
    -- sample_obs_id picks the user's earliest observation of this taxon as
    -- the source of the dex thumbnail. Same MIN(uuid::text)::uuid trick as
    -- profile_top_species — Postgres has no min(uuid).
    MIN(o.id::text)::uuid AS sample_obs_id,
    COUNT(*)::int    AS obs_count,
    t.common_name_es,
    t.common_name_en,
    t.slug,
    t.is_endemic_mexico   AS endemic_mx,
    t.nom059_status
  FROM public.observations o
  JOIN public.identifications i
    ON i.observation_id = o.id AND i.is_primary = true
  LEFT JOIN public.taxa t          ON t.id = i.taxon_id
  LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = i.taxon_id
  WHERE
    o.sync_status = 'synced'
    AND o.obscure_level <> 'private'
    AND i.scientific_name IS NOT NULL
    AND public.can_see_facet(o.observer_id, 'pokedex', (SELECT auth.uid()))
  GROUP BY
    o.observer_id, i.taxon_id,
    COALESCE(t.scientific_name, i.scientific_name),
    t.kingdom, tr.bucket,
    t.common_name_es, t.common_name_en, t.slug,
    t.is_endemic_mexico, t.nom059_status
)
SELECT
  b.user_id,
  b.taxon_id,
  b.scientific_name,
  b.kingdom,
  b.rarity_bucket,
  b.first_observed_at,
  b.obs_count,
  b.common_name_es,
  b.common_name_en,
  b.slug,
  b.endemic_mx,
  b.nom059_status,
  (SELECT mf.url
     FROM public.media_files mf
    WHERE mf.observation_id = b.sample_obs_id
    ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at ASC
    LIMIT 1) AS thumbnail_url
FROM base b;

GRANT SELECT ON public.profile_pokedex TO anon, authenticated;
```

- [ ] **Step 2: Apply schema**

```bash
make db-apply
```

Expected: success. If you see `cannot change name of view column` — that means an existing column was renamed. Stop and investigate; the spec says we only append.

- [ ] **Step 3: Verify columns**

```bash
make db-psql -c "\d+ public.profile_pokedex"
```

Expected output includes (in order): `user_id, taxon_id, scientific_name, kingdom, rarity_bucket, first_observed_at, obs_count, common_name_es, common_name_en, slug, endemic_mx, nom059_status, thumbnail_url`.

- [ ] **Step 4: Verify a sample read**

```bash
make db-psql -c "SELECT scientific_name, common_name_es, slug, endemic_mx, thumbnail_url FROM public.profile_pokedex LIMIT 3;"
```

Expected: 0–3 rows, query runs without error.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): extend profile_pokedex with thumbnail + common names + slug + conservation flags (M34)"
```

---

### Task 3: `featured_species_current` view

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append after `taxa_thumbnails` from Task 1)

- [ ] **Step 1: Append the view**

```sql
-- featured_species_current: weekly-stable random pick of one species that's
-- rare/endemic/protected AND has at least one synced obs with a photo in
-- the last 90 days. Selection is deterministic per ISO week, so the same
-- species shows for everyone Mon–Sun. Used by EspeciesHero.
CREATE OR REPLACE VIEW public.featured_species_current AS
WITH eligible AS (
  SELECT
    t.id            AS taxon_id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.slug,
    t.kingdom,
    t.is_endemic_mexico,
    t.nom059_status,
    tr.bucket       AS rarity_bucket
  FROM public.taxa t
  LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = t.id
  WHERE EXISTS (
    SELECT 1
      FROM public.media_files mf
      JOIN public.observations o   ON o.id = mf.observation_id
      JOIN public.identifications i ON i.observation_id = o.id
     WHERE i.is_primary = true
       AND i.taxon_id = t.id
       AND o.sync_status = 'synced'
       AND o.obscure_level <> 'full'
       AND o.observed_at > now() - interval '90 days'
  )
  AND (
    COALESCE(tr.bucket, 1) >= 4
    OR t.is_endemic_mexico = true
    OR t.nom059_status IN ('sujeta_proteccion', 'amenazada', 'peligro_extincion')
  )
)
SELECT
  e.*,
  (SELECT mf.url
     FROM public.media_files mf
     JOIN public.observations o   ON o.id = mf.observation_id
     JOIN public.identifications i ON i.observation_id = o.id
    WHERE i.is_primary = true
      AND i.taxon_id = e.taxon_id
      AND o.sync_status = 'synced'
      AND o.obscure_level <> 'full'
    ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at DESC
    LIMIT 1) AS thumbnail_url
FROM eligible e
ORDER BY md5(e.taxon_id::text || to_char(date_trunc('week', now()), 'YYYY-IW'))
LIMIT 1;

GRANT SELECT ON public.featured_species_current TO anon, authenticated;
```

- [ ] **Step 2: Apply schema**

```bash
make db-apply
```

- [ ] **Step 3: Verify (may return 0 rows on a small DB — that's OK, hero hides gracefully)**

```bash
make db-psql -c "SELECT scientific_name, common_name_es, kingdom, thumbnail_url FROM public.featured_species_current;"
```

Expected: 0 or 1 row.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): add featured_species_current view (M34)"
```

---

### Task 4: `mv_platform_stats` materialized view + hourly cron

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Append the MV definition**

```sql
-- mv_platform_stats: 4 platform-health counters surfaced on the Especies
-- hero. Refreshed hourly via pg_cron. Single-row MV; UNIQUE index on
-- computed_at lets us REFRESH CONCURRENTLY.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_platform_stats AS
SELECT
  (SELECT COUNT(DISTINCT i.taxon_id)
     FROM public.identifications i
     JOIN public.observations o ON o.id = i.observation_id
    WHERE i.is_primary = true
      AND o.sync_status = 'synced')                                    AS total_species,
  (SELECT COUNT(DISTINCT o.observer_id)
     FROM public.observations o
    WHERE o.sync_status = 'synced')                                    AS total_observers,
  (SELECT COUNT(*)
     FROM public.observations o
    WHERE o.sync_status = 'synced')                                    AS total_obs,
  (SELECT COUNT(DISTINCT i.taxon_id)
     FROM public.identifications i
     JOIN public.observations o ON o.id = i.observation_id
    WHERE i.is_primary = true
      AND o.sync_status = 'synced'
      AND date_trunc('week', o.observed_at) = date_trunc('week', now())
      AND NOT EXISTS (
        SELECT 1
          FROM public.identifications i2
          JOIN public.observations o2 ON o2.id = i2.observation_id
         WHERE i2.taxon_id = i.taxon_id
           AND i2.is_primary = true
           AND o2.sync_status = 'synced'
           AND o2.observed_at < date_trunc('week', now())
      ))                                                               AS new_species_this_week,
  now()                                                                AS computed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_platform_stats_unique
  ON public.mv_platform_stats (computed_at);

GRANT SELECT ON public.mv_platform_stats TO anon, authenticated;
```

- [ ] **Step 2: Add the cron schedule**

Append (still in the M34 block):

```sql
-- M34 cron: refresh mv_platform_stats hourly. Idempotent — unschedule first.
SELECT cron.unschedule('refresh-platform-stats')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-platform-stats');
SELECT cron.schedule('refresh-platform-stats', '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_platform_stats$$);
```

- [ ] **Step 3: Apply schema**

```bash
make db-apply
```

- [ ] **Step 4: Force first refresh + verify row exists**

```bash
make db-psql -c "REFRESH MATERIALIZED VIEW public.mv_platform_stats; SELECT * FROM public.mv_platform_stats;"
```

Expected: exactly 1 row with non-null counters.

- [ ] **Step 5: Verify cron entry**

```bash
make db-psql -c "SELECT jobname, schedule FROM cron.job WHERE jobname = 'refresh-platform-stats';"
```

Expected: 1 row, schedule = `0 * * * *`.

- [ ] **Step 6: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): add mv_platform_stats MV with hourly cron refresh (M34)"
```

---

### Task 5: `suggest_pokedex_target(uuid)` RPC

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Append the RPC**

```sql
-- suggest_pokedex_target(viewer_id): pick one species the viewer hasn't
-- observed yet, preferring their most-active kingdom, common rarity, with
-- at least one photo in the catalog. Stable per user per day. Used by
-- PokedexHero tile 3 ("Para cazar").
CREATE OR REPLACE FUNCTION public.suggest_pokedex_target(viewer_id uuid)
RETURNS TABLE (
  taxon_id        uuid,
  scientific_name text,
  common_name_es  text,
  common_name_en  text,
  slug            text,
  kingdom         text,
  thumbnail_url   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH owned AS (
    SELECT taxon_id FROM public.profile_pokedex WHERE user_id = viewer_id
  ),
  user_top_kingdom AS (
    SELECT kingdom, COUNT(*) AS c
      FROM public.profile_pokedex
     WHERE user_id = viewer_id AND kingdom IS NOT NULL
     GROUP BY kingdom
     ORDER BY c DESC
     LIMIT 1
  )
  SELECT
    t.id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.slug,
    t.kingdom,
    (SELECT tt.thumbnail_url FROM public.taxa_thumbnails tt WHERE tt.taxon_id = t.id) AS thumbnail_url
  FROM public.taxa t
  LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = t.id
  WHERE t.id NOT IN (SELECT taxon_id FROM owned)
    AND t.kingdom = COALESCE((SELECT kingdom FROM user_top_kingdom), 'Animalia')
    AND COALESCE(tr.bucket, 1) <= 2
    AND EXISTS (
      SELECT 1 FROM public.taxa_thumbnails tt
       WHERE tt.taxon_id = t.id AND tt.thumbnail_url IS NOT NULL
    )
  ORDER BY md5(t.id::text || viewer_id::text || to_char(now(), 'YYYY-MM-DD'))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_pokedex_target(uuid) TO authenticated;
```

- [ ] **Step 2: Apply schema**

```bash
make db-apply
```

- [ ] **Step 3: Verify with a real or any UUID (returns 0 rows for unknown user — that's fine, the UI handles empty gracefully)**

```bash
make db-psql -c "SELECT * FROM public.suggest_pokedex_target('00000000-0000-0000-0000-000000000000'::uuid);"
```

Expected: 0 or 1 row, query runs without error.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): add suggest_pokedex_target RPC (M34)"
```

---

## Phase 2 — Pure logic helpers (TDD-first)

These are pure modules. Test-driven so the components in Phase 3+ have a verified foundation.

### Task 6: `species-display` — pill-priority resolver

**Files:**
- Create: `src/lib/species-display.ts`
- Test: `tests/unit/species-display.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/species-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pillForSpecies, type SpeciesPillInput, type Pill } from '../../src/lib/species-display';

describe('pillForSpecies', () => {
  it('returns rarity pill when rarity_bucket >= 4', () => {
    const input: SpeciesPillInput = { rarity_bucket: 5, endemic_mx: true, nom059_status: 'amenazada' };
    expect(pillForSpecies(input)).toEqual<Pill>({ kind: 'rarity-rare', label: 'rarity_5', tone: 'amber' });
  });

  it('returns endemic pill when endemic and not rare', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: true, nom059_status: null })).toEqual<Pill>({
      kind: 'endemic', label: 'endemic_mx', tone: 'lime',
    });
  });

  it('returns nom059 pill when threatened and not rare and not endemic', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: false, nom059_status: 'amenazada' })).toEqual<Pill>({
      kind: 'nom059', label: 'nom059', tone: 'orange',
    });
  });

  it('returns notable pill for rarity_bucket=3', () => {
    expect(pillForSpecies({ rarity_bucket: 3, endemic_mx: false, nom059_status: null })).toEqual<Pill>({
      kind: 'rarity-notable', label: 'rarity_3', tone: 'amber-light',
    });
  });

  it('returns null for plain common species', () => {
    expect(pillForSpecies({ rarity_bucket: 1, endemic_mx: false, nom059_status: null })).toBeNull();
  });

  it('treats null rarity_bucket as bucket=1', () => {
    expect(pillForSpecies({ rarity_bucket: null, endemic_mx: false, nom059_status: null })).toBeNull();
  });

  it('rarity beats endemic and nom059', () => {
    expect(pillForSpecies({ rarity_bucket: 5, endemic_mx: true, nom059_status: 'peligro_extincion' })?.kind).toBe('rarity-rare');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm run test -- species-display
```

Expected: FAIL with "Cannot find module ../../src/lib/species-display".

- [ ] **Step 3: Write the minimal implementation**

`src/lib/species-display.ts`:

```ts
export type SpeciesPillInput = {
  rarity_bucket: number | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
};

export type PillTone = 'amber' | 'amber-light' | 'lime' | 'orange';
export type PillKind = 'rarity-rare' | 'rarity-notable' | 'endemic' | 'nom059';

export type Pill = {
  kind: PillKind;
  label: string;       // i18n key, resolved at render time
  tone: PillTone;
};

const NOM059_THREATENED = new Set([
  'sujeta_proteccion',
  'amenazada',
  'peligro_extincion',
]);

export function pillForSpecies(input: SpeciesPillInput): Pill | null {
  const bucket = input.rarity_bucket ?? 1;
  if (bucket >= 4) {
    return { kind: 'rarity-rare', label: `rarity_${bucket}`, tone: 'amber' };
  }
  if (input.endemic_mx === true) {
    return { kind: 'endemic', label: 'endemic_mx', tone: 'lime' };
  }
  if (input.nom059_status && NOM059_THREATENED.has(input.nom059_status)) {
    return { kind: 'nom059', label: 'nom059', tone: 'orange' };
  }
  if (bucket === 3) {
    return { kind: 'rarity-notable', label: `rarity_${bucket}`, tone: 'amber-light' };
  }
  return null;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm run test -- species-display
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/species-display.ts tests/unit/species-display.test.ts
git commit -m "feat(species): add pillForSpecies pure resolver (M34)"
```

---

### Task 7: `species-filters` — chip URL state serializer + kingdom filter

**Files:**
- Create: `src/lib/species-filters.ts`
- Test: `tests/unit/species-filters.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/species-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseChips,
  serializeChips,
  filterByChips,
  type ChipsState,
  type SpeciesRow,
} from '../../src/lib/species-filters';

describe('parseChips', () => {
  it('returns defaults for empty querystring', () => {
    expect(parseChips('')).toEqual<ChipsState>({
      endemic: false,
      nom059: false,
      rare: false,
      kingdom: null,
    });
  });

  it('parses a fully-populated state', () => {
    expect(parseChips('?endemic=1&nom059=1&rare=1&kingdom=Animalia')).toEqual<ChipsState>({
      endemic: true, nom059: true, rare: true, kingdom: 'Animalia',
    });
  });

  it('drops unknown kingdom values silently', () => {
    expect(parseChips('?kingdom=NotAKingdom').kingdom).toBeNull();
  });

  it('treats truthy variants of endemic correctly', () => {
    expect(parseChips('?endemic=true').endemic).toBe(true);
    expect(parseChips('?endemic=0').endemic).toBe(false);
  });
});

describe('serializeChips', () => {
  it('returns empty string for default state', () => {
    expect(serializeChips({ endemic: false, nom059: false, rare: false, kingdom: null })).toBe('');
  });

  it('round-trips through parseChips', () => {
    const s: ChipsState = { endemic: true, nom059: false, rare: true, kingdom: 'Plantae' };
    expect(parseChips(serializeChips(s))).toEqual(s);
  });
});

describe('filterByChips', () => {
  const rows: SpeciesRow[] = [
    { taxon_id: 'a', kingdom: 'Animalia', endemic_mx: true,  nom059_status: null,        rarity_bucket: 2 },
    { taxon_id: 'b', kingdom: 'Plantae',  endemic_mx: false, nom059_status: 'amenazada', rarity_bucket: 4 },
    { taxon_id: 'c', kingdom: 'Animalia', endemic_mx: false, nom059_status: null,        rarity_bucket: 1 },
    { taxon_id: 'd', kingdom: 'Fungi',    endemic_mx: false, nom059_status: null,        rarity_bucket: 5 },
  ];

  it('returns all when no chips active', () => {
    expect(filterByChips(rows, { endemic: false, nom059: false, rare: false, kingdom: null })).toHaveLength(4);
  });

  it('endemic chip keeps only endemic species', () => {
    const out = filterByChips(rows, { endemic: true, nom059: false, rare: false, kingdom: null });
    expect(out.map(r => r.taxon_id)).toEqual(['a']);
  });

  it('rare chip keeps rarity_bucket >= 4', () => {
    const out = filterByChips(rows, { endemic: false, nom059: false, rare: true, kingdom: null });
    expect(out.map(r => r.taxon_id).sort()).toEqual(['b', 'd']);
  });

  it('combines chips with AND', () => {
    const out = filterByChips(rows, { endemic: true, nom059: false, rare: false, kingdom: 'Animalia' });
    expect(out.map(r => r.taxon_id)).toEqual(['a']);
  });

  it('kingdom filter only', () => {
    const out = filterByChips(rows, { endemic: false, nom059: false, rare: false, kingdom: 'Plantae' });
    expect(out.map(r => r.taxon_id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm run test -- species-filters
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

`src/lib/species-filters.ts`:

```ts
export type ChipsState = {
  endemic: boolean;
  nom059: boolean;
  rare: boolean;
  kingdom: string | null;
};

export type SpeciesRow = {
  taxon_id: string;
  kingdom: string | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
  rarity_bucket: number | null;
};

const KNOWN_KINGDOMS = new Set([
  'Animalia', 'Plantae', 'Fungi', 'Chromista', 'Protozoa', 'Bacteria', 'Archaea',
]);

const NOM059_THREATENED = new Set(['sujeta_proteccion', 'amenazada', 'peligro_extincion']);

function truthy(v: string | null): boolean {
  return v === '1' || v === 'true';
}

export function parseChips(qs: string): ChipsState {
  const p = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const kingdom = p.get('kingdom');
  return {
    endemic: truthy(p.get('endemic')),
    nom059:  truthy(p.get('nom059')),
    rare:    truthy(p.get('rare')),
    kingdom: kingdom && KNOWN_KINGDOMS.has(kingdom) ? kingdom : null,
  };
}

export function serializeChips(s: ChipsState): string {
  const p = new URLSearchParams();
  if (s.endemic) p.set('endemic', '1');
  if (s.nom059)  p.set('nom059',  '1');
  if (s.rare)    p.set('rare',    '1');
  if (s.kingdom) p.set('kingdom', s.kingdom);
  const out = p.toString();
  return out ? `?${out}` : '';
}

export function filterByChips<T extends SpeciesRow>(rows: T[], s: ChipsState): T[] {
  return rows.filter((r) => {
    if (s.kingdom && r.kingdom !== s.kingdom) return false;
    if (s.endemic && r.endemic_mx !== true) return false;
    if (s.rare && (r.rarity_bucket ?? 1) < 4) return false;
    if (s.nom059 && !(r.nom059_status && NOM059_THREATENED.has(r.nom059_status))) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- species-filters
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/species-filters.ts tests/unit/species-filters.test.ts
git commit -m "feat(species): add chips URL state + kingdom filter pure logic (M34)"
```

---

## Phase 3 — Shared `SpeciesCard`

### Task 8: `SpeciesCard.astro` + i18n strings

**Files:**
- Create: `src/components/species/SpeciesCard.astro`
- Modify: `src/i18n/en.json`, `src/i18n/es.json`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/en.json`, find the top-level object and add (anywhere, conventionally near other `species.*` keys; if there's no namespace yet, create one):

```json
"species_card": {
  "rarity_5": "Excepcional",
  "rarity_4": "Rara",
  "rarity_3": "Notable",
  "endemic_mx": "Endémica de México",
  "nom059": "NOM-059",
  "common": "Común",
  "no_photo": "no photo yet",
  "in_dex": "in your dex",
  "obs_count_one": "{count} observation",
  "obs_count_other": "{count} observations"
}
```

For EN, replace the rarity/endemic Spanish-flavored text with English:

```json
"species_card": {
  "rarity_5": "Exceptional",
  "rarity_4": "Rare",
  "rarity_3": "Notable",
  "endemic_mx": "Endemic to Mexico",
  "nom059": "NOM-059",
  "common": "Common",
  "no_photo": "no photo yet",
  "in_dex": "in your dex",
  "obs_count_one": "{count} observation",
  "obs_count_other": "{count} observations"
}
```

In `src/i18n/es.json`:

```json
"species_card": {
  "rarity_5": "Excepcional",
  "rarity_4": "Rara",
  "rarity_3": "Notable",
  "endemic_mx": "Endémica de México",
  "nom059": "NOM-059",
  "common": "Común",
  "no_photo": "sin foto aún",
  "in_dex": "ya en tu dex",
  "obs_count_one": "{count} observación",
  "obs_count_other": "{count} observaciones"
}
```

- [ ] **Step 2: Create the component**

`src/components/species/SpeciesCard.astro`:

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';
import { pillForSpecies, type Pill } from '../../lib/species-display';

interface Props {
  lang: Locale;
  taxonId: string;
  scientificName: string;
  commonName: string | null;
  slug: string | null;
  kingdom: string | null;
  thumbnailUrl: string | null;
  rarityBucket: number | null;
  endemicMx: boolean | null;
  nom059Status: string | null;
  /** Format: "3 obs · Aves" — caller controls the meta line content */
  metaLine: string;
  /** Show the small green ✓ overlay (Especies cards when species is in viewer's dex) */
  inDex?: boolean;
  /** Optional href; when set, the card is wrapped in <a>. */
  href?: string | null;
}

const {
  lang, taxonId, scientificName, commonName, slug, thumbnailUrl,
  rarityBucket, endemicMx, nom059Status, metaLine, inDex = false, href = null,
} = Astro.props;

const tr = t(lang) as unknown as {
  species_card: Record<string, string>;
};
const sc = tr.species_card;

const pill: Pill | null = pillForSpecies({
  rarity_bucket: rarityBucket,
  endemic_mx: endemicMx,
  nom059_status: nom059Status,
});

const pillLabel = pill ? sc[pill.label] ?? pill.label : null;

// Tone → Tailwind classes (kept inline since small + per-card)
const toneClass: Record<string, string> = {
  'amber':       'bg-white/95 text-amber-700',
  'amber-light': 'bg-white/95 text-amber-600',
  'lime':        'bg-lime-100/95 text-lime-900',
  'orange':      'bg-white/95 text-orange-700',
};

const Tag = href ? 'a' : 'div';
const tagAttrs = href ? { href } : {};
---
<Tag {...tagAttrs} class="block group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-700 transition-colors" data-taxon-id={taxonId}>
  <div class="relative aspect-[16/10] bg-gradient-to-br from-emerald-50 to-cyan-50 dark:from-zinc-800 dark:to-zinc-900">
    {thumbnailUrl ? (
      <img
        src={thumbnailUrl}
        alt={scientificName}
        loading="lazy"
        class="absolute inset-0 w-full h-full object-cover"
      />
    ) : (
      <span class="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">{sc.no_photo}</span>
    )}
    {pill && pillLabel && (
      <span class={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm ${toneClass[pill.tone]}`}>
        {pill.tone === 'amber' || pill.tone === 'amber-light' ? '★ ' : ''}{pillLabel}
      </span>
    )}
    {inDex && (
      <span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center shadow-sm" aria-label={sc.in_dex} title={sc.in_dex}>✓</span>
    )}
  </div>
  <div class="p-3">
    <p class="text-sm italic font-bold text-emerald-700 dark:text-emerald-400 truncate">{scientificName}</p>
    {commonName && <p class="text-sm text-zinc-700 dark:text-zinc-300 truncate">{commonName}</p>}
    <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5">{metaLine}</p>
  </div>
</Tag>
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run tests (existing suite must still pass)**

```bash
npm run test
```

Expected: all 734+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/species/SpeciesCard.astro src/i18n/en.json src/i18n/es.json
git commit -m "feat(species): add shared SpeciesCard component (D-style) with i18n (M34)"
```

---

### Task 9: `SpeciesCardGrid.astro` wrapper

**Files:**
- Create: `src/components/species/SpeciesCardGrid.astro`

- [ ] **Step 1: Create the wrapper**

`src/components/species/SpeciesCardGrid.astro`:

```astro
---
interface Props {
  /** Tailwind class string for the outer grid; defaults to a 2/3/4-column responsive grid */
  cols?: string;
}
const { cols = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3' } = Astro.props;
---
<ul class={cols} role="list">
  <slot />
</ul>
```

Each child should be `<li>` wrapping a `SpeciesCard`. Slot rendering is the consumer's responsibility — that keeps this wrapper trivial.

- [ ] **Step 2: Typecheck + test**

```bash
npm run typecheck && npm run test
```

- [ ] **Step 3: Commit**

```bash
git add src/components/species/SpeciesCardGrid.astro
git commit -m "feat(species): add SpeciesCardGrid wrapper (M34)"
```

---

## Phase 4 — Pokédex hero

### Task 10: `KingdomPills.astro`

**Files:**
- Create: `src/components/species/KingdomPills.astro`
- Modify: `tailwind.config.mjs` (safelist new dynamic dot colors if needed)

- [ ] **Step 1: Inspect tailwind safelist**

Open `tailwind.config.mjs`. Confirm the `safelist` array exists. Look for entries matching dynamic class names like `bg-red-600`, `bg-green-600`. If the kingdom dots use these, they'll need to be safelisted. The existing site already safelists chrome accent classes per CLAUDE.md.

- [ ] **Step 2: Create the component**

`src/components/species/KingdomPills.astro`:

```astro
---
interface Kingdom { name: string; count: number; }
interface Props {
  kingdoms: Kingdom[];
  total: number;
  activeKingdom: string | null;
  langAllLabel: string; // localized "Todos" / "All"
}
const { kingdoms, total, activeKingdom, langAllLabel } = Astro.props;

// dot color per kingdom; fixed mapping, safelist not required because all
// of these are referenced by literal class names below.
const dotByKingdom: Record<string, string> = {
  Animalia:  'bg-red-600',
  Plantae:   'bg-green-600',
  Fungi:     'bg-purple-500',
  Chromista: 'bg-sky-500',
  Protozoa:  'bg-amber-500',
  Bacteria:  'bg-pink-500',
  Archaea:   'bg-stone-500',
};
---
<div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-800" role="group" data-kingdom-pills>
  <button
    type="button"
    class:list={[
      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium',
      activeKingdom === null
        ? 'bg-emerald-700 text-white border-emerald-700'
        : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
    ]}
    aria-pressed={activeKingdom === null}
    data-kingdom=""
  >
    <b>{langAllLabel}</b> · {total}
  </button>
  {kingdoms.map((k) => (
    <button
      type="button"
      class:list={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-medium',
        activeKingdom === k.name
          ? 'bg-emerald-700 text-white border-emerald-700'
          : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
      ]}
      aria-pressed={activeKingdom === k.name}
      data-kingdom={k.name}
    >
      <span class:list={['w-2 h-2 rounded-full', dotByKingdom[k.name] ?? 'bg-zinc-400']}></span>
      {k.name} <b>{k.count}</b>
    </button>
  ))}
</div>
```

The buttons emit `data-kingdom`. The orchestrator (Task 14) wires up clicks to filter the cards grid.

- [ ] **Step 3: Typecheck + build smoke**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/species/KingdomPills.astro
git commit -m "feat(species): add KingdomPills filter component (M34)"
```

---

### Task 11: `PokedexHero.astro` — 3 tiles + responsive compact

**Files:**
- Create: `src/components/species/PokedexHero.astro`
- Modify: `src/i18n/en.json`, `src/i18n/es.json` (Pokédex hero strings)

- [ ] **Step 1: Add i18n keys**

In `src/i18n/en.json`, under the existing `pokedex` namespace, add these keys (the existing `pokedex.title`, `pokedex.subtitle`, `pokedex.bucket.*` stay):

```json
"pokedex": {
  "...": "<existing keys preserved>",
  "hero": {
    "species_label": "species",
    "kingdoms_label": "kingdoms",
    "rares_label": "rares",
    "obs_label": "obs",
    "streak_days_one": "{n} day streak",
    "streak_days_other": "{n} day streak",
    "highest_rarity_label": "Your highest rarity",
    "to_catch_label": "To catch",
    "to_catch_why": "Common in MX, you haven't seen it",
    "to_catch_cta": "More suggestions →",
    "first_visit_title": "Start your Pokédex",
    "first_visit_cta": "Make your first observation",
    "kingdom_all": "All"
  }
}
```

In `src/i18n/es.json` mirror with Spanish copy:

```json
"pokedex": {
  "...": "<existing keys preserved>",
  "hero": {
    "species_label": "especies",
    "kingdoms_label": "reinos",
    "rares_label": "raras",
    "obs_label": "obs",
    "streak_days_one": "{n} día de racha",
    "streak_days_other": "{n} días de racha",
    "highest_rarity_label": "Tu rareza más alta",
    "to_catch_label": "Para cazar",
    "to_catch_why": "Común en MX, no la has visto",
    "to_catch_cta": "Más sugerencias →",
    "first_visit_title": "Empieza tu Pokédex",
    "first_visit_cta": "Haz tu primera observación",
    "kingdom_all": "Todos"
  }
}
```

- [ ] **Step 2: Create the component**

`src/components/species/PokedexHero.astro`:

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';

interface Stats {
  total: number;
  kingdoms: number;
  rares: number;
  obs: number;
  streakDays: number;
}
interface RareCatch {
  scientificName: string;
  commonName: string | null;
  thumbnailUrl: string | null;
  rarityBucket: number | null;
  kingdom: string | null;
}
interface Suggestion {
  scientificName: string;
  commonName: string | null;
  thumbnailUrl: string | null;
  ctaHref: string;
}
interface Props {
  lang: Locale;
  stats: Stats;
  rare: RareCatch | null;
  suggestion: Suggestion | null;
  /** When true, render the first-visit empty state for tile 1 */
  firstVisit: boolean;
  observeHref: string;
}

const { lang, stats, rare, suggestion, firstVisit, observeHref } = Astro.props;
const tr = t(lang) as unknown as {
  pokedex: { hero: Record<string, string> };
};
const h = tr.pokedex.hero;
---
<div class="ph-grid grid gap-3.5 mt-3.5" style="grid-template-columns: 1.2fr 2fr 1.4fr;">
  <!-- Tile 1: Total / first-visit -->
  <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 flex flex-col justify-center">
    {firstVisit ? (
      <>
        <div class="text-base font-bold text-zinc-900 dark:text-zinc-100">{h.first_visit_title}</div>
        <a href={observeHref} class="mt-2 inline-block text-sm text-emerald-700 dark:text-emerald-400 font-semibold hover:underline">{h.first_visit_cta} →</a>
      </>
    ) : (
      <>
        <div class="text-5xl font-extrabold leading-none tracking-tight text-emerald-700 dark:text-emerald-400">{stats.total}</div>
        <div class="text-[11px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mt-1 font-semibold">{h.species_label}</div>
        <div class="flex gap-3.5 mt-3 flex-wrap text-xs text-zinc-600 dark:text-zinc-300">
          <span><b class="text-zinc-900 dark:text-zinc-100">{stats.kingdoms}</b> {h.kingdoms_label}</span>
          <span><b class="text-zinc-900 dark:text-zinc-100">{stats.rares}</b> {h.rares_label}</span>
          <span><b class="text-zinc-900 dark:text-zinc-100">{stats.obs}</b> {h.obs_label}</span>
          {stats.streakDays > 0 && (
            <span>🔥 <b class="text-zinc-900 dark:text-zinc-100">{stats.streakDays}</b></span>
          )}
        </div>
      </>
    )}
  </div>

  <!-- Tile 2: Highest rarity -->
  <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 flex items-center" data-tile="rare">
    {rare ? (
      <div class="flex gap-3 items-center w-full">
        {rare.thumbnailUrl ? (
          <img src={rare.thumbnailUrl} alt={rare.scientificName} loading="eager"
               class="flex-none w-24 h-24 rounded-lg object-cover" style="box-shadow: 0 0 0 3px #fbbf24, 0 4px 12px rgba(180,83,9,0.25);" />
        ) : (
          <div class="flex-none w-24 h-24 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 text-2xl">★</div>
        )}
        <div class="min-w-0">
          <div class="text-[10px] uppercase tracking-widest text-amber-700 font-bold">{h.highest_rarity_label}</div>
          <div class="text-base font-bold italic text-zinc-900 dark:text-zinc-100 truncate">{rare.scientificName}</div>
          {rare.commonName && <div class="text-sm text-zinc-600 dark:text-zinc-300 truncate">{rare.commonName}{rare.kingdom ? ` · ${rare.kingdom}` : ''}</div>}
          <div class="text-amber-600 mt-1 tracking-widest text-sm">{'★'.repeat(rare.rarityBucket ?? 1)}{'☆'.repeat(5 - (rare.rarityBucket ?? 1))}</div>
        </div>
      </div>
    ) : (
      <div class="text-sm text-zinc-400 italic">—</div>
    )}
  </div>

  <!-- Tile 3: To catch -->
  <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 flex flex-col justify-center" data-tile="suggest">
    {suggestion ? (
      <>
        <div class="flex gap-3 items-center">
          {suggestion.thumbnailUrl ? (
            <img src={suggestion.thumbnailUrl} alt={suggestion.scientificName} loading="lazy"
                 class="flex-none w-15 h-15 rounded-lg object-cover" style="width:60px;height:60px;filter: grayscale(1) contrast(.5) brightness(.85); opacity:.55; border: 2px dashed #94a3b8;" />
          ) : (
            <div class="flex-none w-15 h-15 rounded-lg border-2 border-dashed border-zinc-400 bg-zinc-100 flex items-center justify-center text-zinc-400 text-2xl" style="width:60px;height:60px;">?</div>
          )}
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{h.to_catch_label}</div>
            <div class="text-sm font-semibold italic text-zinc-900 dark:text-zinc-100 truncate">{suggestion.scientificName}</div>
            <div class="text-[11px] text-zinc-500 mt-0.5">{h.to_catch_why}</div>
          </div>
        </div>
        <a href={suggestion.ctaHref} class="mt-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold hover:underline">{h.to_catch_cta}</a>
      </>
    ) : (
      <div class="text-sm text-zinc-400 italic">—</div>
    )}
  </div>
</div>

<!-- Below 820px: collapse to a horizontal compact strip -->
<style>
  @media (max-width: 820px) {
    .ph-grid { grid-template-columns: 1fr !important; }
  }
</style>
```

(For v1 we keep the responsive collapse simple — single column stack below 820 px. The "compact mobile" variant from the spec is just CSS-driven stacking; no separate component needed. If horizontal compact strip is desired later, it's a v1.1.)

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/species/PokedexHero.astro src/i18n/en.json src/i18n/es.json
git commit -m "feat(pokedex): add PokedexHero 3-tile component with i18n (M34)"
```

---

### Task 12: Refactor `PokedexView.astro` to use new components

**Files:**
- Modify: `src/components/PokedexView.astro`

- [ ] **Step 1: Replace the body of the script + render to use new components**

Open `src/components/PokedexView.astro`. The current shape (310 lines) renders inline HTML strings via `groupsEl.innerHTML = ...`. Refactor to:

1. Frontmatter imports `PokedexHero`, `KingdomPills`, `SpeciesCardGrid`, `SpeciesCard` from `./species/*`.
2. Render the layout shell server-side: `<PokedexHero ... />` placeholder, `<KingdomPills ... />` placeholder, `<SpeciesCardGrid />` empty.
3. Script-side, replace the existing `render(rows)` to:
   - Compute hero stats (total = rows.length; kingdoms = unique non-null; rares = rows where rarity_bucket >= 4; obs = sum obs_count; streak = TODO inline calc — use `users.last_observed_at` if available; for v1 hardcode 0 if not derivable from rows).
   - Find rarest catch (max rarity_bucket, tie break oldest first_observed_at).
   - Fire `supabase.rpc('suggest_pokedex_target', { viewer_id })` for tile 3.
   - Hydrate the hero by populating an internal `<div data-pokedex-hero>` slot. (Easiest: server-render hero with placeholders that script overwrites; alternatively, build the hero entirely client-side.)
   - Render cards into `<ul data-pokedex-grid>` using `<li>` containing `<SpeciesCard>` markup. Since `<SpeciesCard>` is server-only in Astro, we have to mirror its DOM structure in the client-side render() function. Acceptable: keep a small `renderCard(row)` helper inside the script that emits the same HTML as the component; long-term v1.1 could move to islands.

   For v1, the simplest path is: the orchestrator script generates the inner HTML for hero + cards; `<SpeciesCard>` is used only when the page is fully server-rendered (which it isn't here, since data depends on auth state). So actually use the component in its **CSS form** — re-implement the card markup in `renderCard()` inline, sharing class names with `SpeciesCard.astro`. **DRY note:** extract the inner HTML pattern to a TS helper `src/lib/species-card-html.ts` if it ends up duplicated by ExploreSpeciesView.

- [ ] **Step 2: Add `src/lib/species-card-html.ts` to share card markup**

`src/lib/species-card-html.ts`:

```ts
import { pillForSpecies, type SpeciesPillInput } from './species-display';
import { escAttr } from './karma';

export type CardData = SpeciesPillInput & {
  taxonId: string;
  scientificName: string;
  commonName: string | null;
  thumbnailUrl: string | null;
  metaLine: string;
  inDex?: boolean;
  href?: string | null;
};

export type CardLabels = {
  rarity_5: string; rarity_4: string; rarity_3: string;
  endemic_mx: string; nom059: string;
  no_photo: string; in_dex: string;
};

const TONE_CLASS: Record<string, string> = {
  'amber':       'bg-white/95 text-amber-700',
  'amber-light': 'bg-white/95 text-amber-600',
  'lime':        'bg-lime-100/95 text-lime-900',
  'orange':      'bg-white/95 text-orange-700',
};

export function renderSpeciesCard(d: CardData, labels: CardLabels): string {
  const pill = pillForSpecies(d);
  const pillLabel = pill ? (labels as unknown as Record<string, string>)[pill.label] ?? '' : '';
  const tag = d.href ? 'a' : 'div';
  const href = d.href ? ` href="${escAttr(d.href)}"` : '';
  const star = pill && (pill.tone === 'amber' || pill.tone === 'amber-light') ? '★ ' : '';
  return `<${tag}${href} class="block group rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden hover:border-emerald-400 dark:hover:border-emerald-700 transition-colors" data-taxon-id="${escAttr(d.taxonId)}">
    <div class="relative aspect-[16/10] bg-gradient-to-br from-emerald-50 to-cyan-50 dark:from-zinc-800 dark:to-zinc-900">
      ${d.thumbnailUrl
        ? `<img src="${escAttr(d.thumbnailUrl)}" alt="${escAttr(d.scientificName)}" loading="lazy" class="absolute inset-0 w-full h-full object-cover">`
        : `<span class="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">${escAttr(labels.no_photo)}</span>`}
      ${pill && pillLabel
        ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold shadow-sm ${TONE_CLASS[pill.tone]}">${star}${escAttr(pillLabel)}</span>`
        : ''}
      ${d.inDex
        ? `<span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center shadow-sm" aria-label="${escAttr(labels.in_dex)}" title="${escAttr(labels.in_dex)}">✓</span>`
        : ''}
    </div>
    <div class="p-3">
      <p class="text-sm italic font-bold text-emerald-700 dark:text-emerald-400 truncate">${escAttr(d.scientificName)}</p>
      ${d.commonName ? `<p class="text-sm text-zinc-700 dark:text-zinc-300 truncate">${escAttr(d.commonName)}</p>` : ''}
      <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5">${escAttr(d.metaLine)}</p>
    </div>
  </${tag}>`;
}
```

- [ ] **Step 3: Update `PokedexView.astro` script**

Replace the existing `render(rows)` function with one that:
1. Computes hero stats and the rarest catch from rows.
2. Fetches `suggestion` via RPC.
3. Reads i18n labels from `data-*` attributes (added on the root `<section>`).
4. Builds hero HTML, kingdom pills HTML, card grid HTML using `renderSpeciesCard()`.
5. Wires kingdom-pill clicks to filter cards (toggle `data-active-kingdom` on the grid; cards have `data-kingdom`).

Concrete instructions for this step:

a) In the frontmatter of `PokedexView.astro`, add to the existing `data-*` attribute list on the root `<section>`:

```astro
data-label-card-no-photo={(tr.species_card?.no_photo) ?? ''}
data-label-card-in-dex={(tr.species_card?.in_dex) ?? ''}
data-label-card-rarity-3={(tr.species_card?.rarity_3) ?? ''}
data-label-card-rarity-4={(tr.species_card?.rarity_4) ?? ''}
data-label-card-rarity-5={(tr.species_card?.rarity_5) ?? ''}
data-label-card-endemic={(tr.species_card?.endemic_mx) ?? ''}
data-label-card-nom059={(tr.species_card?.nom059) ?? ''}
data-label-hero-species={(tr.pokedex?.hero?.species_label) ?? ''}
data-label-hero-kingdoms={(tr.pokedex?.hero?.kingdoms_label) ?? ''}
data-label-hero-rares={(tr.pokedex?.hero?.rares_label) ?? ''}
data-label-hero-obs={(tr.pokedex?.hero?.obs_label) ?? ''}
data-label-hero-rare={(tr.pokedex?.hero?.highest_rarity_label) ?? ''}
data-label-hero-catch={(tr.pokedex?.hero?.to_catch_label) ?? ''}
data-label-hero-catch-why={(tr.pokedex?.hero?.to_catch_why) ?? ''}
data-label-hero-catch-cta={(tr.pokedex?.hero?.to_catch_cta) ?? ''}
data-label-hero-all={(tr.pokedex?.hero?.kingdom_all) ?? ''}
data-label-hero-first-title={(tr.pokedex?.hero?.first_visit_title) ?? ''}
data-label-hero-first-cta={(tr.pokedex?.hero?.first_visit_cta) ?? ''}
data-href-observe={`/${lang}/${lang === 'es' ? 'observar' : 'observe'}/`}
data-href-explore={`/${lang}/${lang === 'es' ? 'explorar/especies' : 'explore/species'}/`}
```

(Reuse the existing `tr` const; cast where needed.)

b) Replace the `<div id="pokedex-groups">` element with three slots (hero + pills + grid):

```astro
<div id="pokedex-hero" class="mb-5"></div>
<div id="pokedex-pills"></div>
<div id="pokedex-grid" class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"></div>
```

c) Rewrite the `render(rows)` function inside the existing `<script>` block to:

```ts
import { renderSpeciesCard, type CardLabels } from '../lib/species-card-html';
// ... existing imports

function readLabels(): CardLabels & Record<string, string> {
  const r = root!;
  const g = (k: string) => r.dataset[k] ?? '';
  return {
    rarity_5: g('labelCardRarity5'),
    rarity_4: g('labelCardRarity4'),
    rarity_3: g('labelCardRarity3'),
    endemic_mx: g('labelCardEndemic'),
    nom059: g('labelCardNom059'),
    no_photo: g('labelCardNoPhoto'),
    in_dex: g('labelCardInDex'),
  };
}

async function renderAll(rows: DexRow[], userId: string) {
  const heroEl = document.getElementById('pokedex-hero')!;
  const pillsEl = document.getElementById('pokedex-pills')!;
  const gridEl  = document.getElementById('pokedex-grid')!;
  const labels = readLabels();

  // Stats
  const total = rows.length;
  const kingdomsSet = new Set(rows.map(r => r.kingdom).filter((k): k is string => !!k));
  const kingdomCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.kingdom ?? 'Unknown';
    kingdomCounts.set(k, (kingdomCounts.get(k) ?? 0) + 1);
  }
  const rares = rows.filter(r => (r.rarity_bucket ?? 1) >= 4).length;
  const obs = rows.reduce((sum, r) => sum + (r.obs_count ?? 0), 0);

  // Rarest catch
  const rare = [...rows].sort((a, b) => {
    const rb = (b.rarity_bucket ?? 1) - (a.rarity_bucket ?? 1);
    if (rb !== 0) return rb;
    return a.first_observed_at.localeCompare(b.first_observed_at);
  })[0] ?? null;

  // Suggestion
  let suggestion: { scientific_name: string; common_name_es: string|null; common_name_en: string|null; thumbnail_url: string|null } | null = null;
  try {
    const { data } = await getSupabase().rpc('suggest_pokedex_target', { viewer_id: userId });
    if (Array.isArray(data) && data.length > 0) suggestion = data[0];
  } catch { /* tile 3 will hide */ }

  // Render hero (server-mirrored markup; matches PokedexHero.astro)
  heroEl.innerHTML = renderHeroHtml({ total, kingdoms: kingdomsSet.size, rares, obs, streak: 0, rare, suggestion, labels: { /* read from data-* */ }, exploreHref: root!.dataset.hrefExplore!, observeHref: root!.dataset.hrefObserve! });

  // Pills
  pillsEl.innerHTML = renderPillsHtml({ total, kingdoms: kingdomCounts, allLabel: root!.dataset.labelHeroAll ?? 'All' });

  // Cards
  const commonNameKey = lang === 'es' ? 'common_name_es' : 'common_name_en';
  gridEl.innerHTML = rows.map((r) => `<li>${renderSpeciesCard({
    taxonId: r.taxon_id,
    scientificName: r.scientific_name,
    commonName: (r as any)[commonNameKey] ?? null,
    thumbnailUrl: r.thumbnail_url ?? null,
    rarity_bucket: r.rarity_bucket,
    endemic_mx: r.endemic_mx ?? null,
    nom059_status: r.nom059_status ?? null,
    metaLine: `${r.obs_count} ${r.obs_count === 1 ? 'obs' : 'obs'}${r.kingdom ? ` · ${r.kingdom}` : ''}`,
    href: r.slug ? `/${lang}/${lang === 'es' ? 'explorar/especies' : 'explore/species'}/?slug=${encodeURIComponent(r.slug)}` : null,
  }, labels)}</li>`).join('');

  wireKingdomPills();
  loading?.classList.add('hidden');
}

function wireKingdomPills() {
  const pills = document.querySelectorAll<HTMLButtonElement>('#pokedex-pills [data-kingdom]');
  const grid = document.getElementById('pokedex-grid')!;
  pills.forEach(btn => btn.addEventListener('click', () => {
    pills.forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    const k = btn.dataset.kingdom ?? '';
    grid.querySelectorAll<HTMLLIElement>('li').forEach(li => {
      const card = li.firstElementChild as HTMLElement | null;
      const cardKingdom = card?.dataset.kingdom ?? '';
      li.style.display = !k || cardKingdom === k ? '' : 'none';
    });
  }));
}

// renderHeroHtml + renderPillsHtml are local helpers that emit the same
// markup as PokedexHero.astro / KingdomPills.astro. Spell them out — see
// those components for canonical structure.
```

(Sketched. The implementer fills in `renderHeroHtml` and `renderPillsHtml` mirroring the Astro components' static markup.)

d) Update the `DexRow` type to match the new `profile_pokedex` columns:

```ts
type DexRow = {
  taxon_id: string;
  scientific_name: string;
  kingdom: string | null;
  rarity_bucket: number | null;
  first_observed_at: string;
  obs_count: number;
  common_name_es: string | null;
  common_name_en: string | null;
  slug: string | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
  thumbnail_url: string | null;
};
```

Update the `loadFromView` SELECT list to ask for the new columns explicitly, and update `loadFallback` likewise (it'll synthesize nulls for the columns it can't compute).

- [ ] **Step 4: Run typecheck + tests + dev**

```bash
npm run typecheck
npm run test
```

Expected: typecheck clean, tests pass.

```bash
npm run dev
```

Open http://localhost:4321/es/perfil/dex/ — the hero and cards should render with the expected layout.

- [ ] **Step 5: Commit**

```bash
git add src/components/PokedexView.astro src/lib/species-card-html.ts
git commit -m "feat(pokedex): wire PokedexView to new hero + cards (M34)"
```

---

## Phase 5 — Especies hero

### Task 13: `FeaturedSpeciesCard.astro`

**Files:**
- Create: `src/components/species/FeaturedSpeciesCard.astro`

- [ ] **Step 1: Create the component**

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';

interface Props {
  lang: Locale;
  scientificName: string;
  commonName: string | null;
  slug: string | null;
  thumbnailUrl: string | null;
  endemicMx: boolean | null;
  nom059Status: string | null;
  rarityBucket: number | null;
}

const {
  lang, scientificName, commonName, slug, thumbnailUrl,
  endemicMx, nom059Status, rarityBucket,
} = Astro.props;

const tr = t(lang) as unknown as { species_card: Record<string, string>; explore_species_hero: Record<string, string> };
const sc = tr.species_card;
const eh = tr.explore_species_hero ?? {};

const detailHref = slug
  ? `/${lang}/${lang === 'es' ? 'explorar/especies' : 'explore/species'}/?slug=${encodeURIComponent(slug)}`
  : '#';
---
<a href={detailHref} class="relative block rounded-2xl overflow-hidden min-h-[280px] text-white" data-featured-species>
  {thumbnailUrl && (
    <img src={thumbnailUrl} alt={scientificName} loading="eager"
         class="absolute inset-0 w-full h-full object-cover" />
  )}
  <div class="absolute inset-0" style="background: linear-gradient(115deg, rgba(15,23,42,.85) 0%, rgba(15,23,42,.55) 50%, transparent 80%);"></div>
  <div class="relative h-full p-6 flex flex-col justify-between min-h-[280px]">
    <div>
      <span class="inline-block text-[10px] tracking-[0.15em] uppercase font-bold px-2.5 py-1 rounded-full bg-white/15 border border-white/25 text-amber-100 backdrop-blur-md">{eh.featured_label ?? 'Featured this week'}</span>
      <h3 class="italic text-2xl font-extrabold mt-3.5">{scientificName}</h3>
      {commonName && <p class="text-sm text-zinc-300 mt-1">{commonName}</p>}
    </div>
    <div class="flex flex-wrap gap-1.5 mt-auto">
      {endemicMx && <span class="px-2.5 py-1 text-[11px] font-semibold rounded-full" style="background: rgba(132,204,22,0.2); border: 1px solid rgba(132,204,22,0.4); color: #d9f99d;">🇲🇽 {sc.endemic_mx}</span>}
      {nom059Status && (
        <span class="px-2.5 py-1 text-[11px] font-semibold rounded-full" style="background: rgba(251,191,36,0.18); border: 1px solid rgba(251,191,36,0.4); color: #fde68a;">{sc.nom059}</span>
      )}
      {rarityBucket !== null && rarityBucket >= 4 && (
        <span class="px-2.5 py-1 text-[11px] font-semibold rounded-full" style="background: rgba(245,158,11,0.18); border: 1px solid rgba(245,158,11,0.4); color: #fcd34d;">★ {rarityBucket >= 5 ? sc.rarity_5 : sc.rarity_4}</span>
      )}
    </div>
  </div>
</a>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/components/species/FeaturedSpeciesCard.astro
git commit -m "feat(species): add FeaturedSpeciesCard component (M34)"
```

---

### Task 14: `PlatformStats.astro`

**Files:**
- Create: `src/components/species/PlatformStats.astro`

- [ ] **Step 1: Create the component**

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';

interface Props {
  lang: Locale;
  totalSpecies: number;
  totalObservers: number;
  totalObs: number;
  newSpeciesThisWeek: number;
}

const { lang, totalSpecies, totalObservers, totalObs, newSpeciesThisWeek } = Astro.props;
const tr = t(lang) as unknown as { explore_species_hero: Record<string, string> };
const eh = tr.explore_species_hero ?? {};

function fmt(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n >= 1000) return n.toLocaleString();
  return String(n);
}
---
<div class="grid grid-cols-2 gap-2">
  <div class="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-4 text-center">
    <div class="text-3xl font-extrabold text-emerald-700 leading-none tracking-tight">{fmt(totalSpecies)}</div>
    <div class="text-[11px] uppercase tracking-wider text-emerald-600 mt-1 font-semibold">{eh.species_label ?? 'Species'}</div>
  </div>
  <div class="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-4 text-center">
    <div class="text-3xl font-extrabold text-emerald-700 leading-none tracking-tight">{fmt(totalObservers)}</div>
    <div class="text-[11px] uppercase tracking-wider text-emerald-600 mt-1 font-semibold">{eh.observers_label ?? 'Observers'}</div>
  </div>
  <div class="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-4 text-center">
    <div class="text-3xl font-extrabold text-emerald-700 leading-none tracking-tight">{fmt(totalObs)}</div>
    <div class="text-[11px] uppercase tracking-wider text-emerald-600 mt-1 font-semibold">{eh.obs_label ?? 'Observations'}</div>
  </div>
  <div class="rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50 to-white p-4 text-center">
    <div class="text-3xl font-extrabold text-sky-700 leading-none tracking-tight">+{newSpeciesThisWeek}</div>
    <div class="text-[11px] uppercase tracking-wider text-sky-600 mt-1 font-semibold">{eh.delta_label ?? 'This week'}</div>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/species/PlatformStats.astro
git commit -m "feat(species): add PlatformStats component (M34)"
```

---

### Task 15: `EspeciesHero.astro` orchestrator + i18n

**Files:**
- Create: `src/components/species/EspeciesHero.astro`
- Modify: `src/i18n/en.json`, `src/i18n/es.json` (add `explore_species_hero` namespace)

- [ ] **Step 1: Add i18n keys (EN)**

```json
"explore_species_hero": {
  "title": "Species",
  "subtitle": "Explore the catalog of species observed on Rastrum. Find endemics, threatened species, and recent community discoveries.",
  "featured_label": "Featured this week",
  "species_label": "Species",
  "observers_label": "Observers",
  "obs_label": "Observations",
  "delta_label": "This week",
  "tab_grid": "Grid",
  "tab_radial": "Tree",
  "chip_all": "All",
  "chip_endemic": "Endemic",
  "chip_nom059": "NOM-059",
  "chip_rare": "Rare"
}
```

ES (mirror):

```json
"explore_species_hero": {
  "title": "Especies",
  "subtitle": "Explora el catálogo de especies observadas en Rastrum. Encuentra endémicas, especies en riesgo y los hallazgos recientes de la comunidad.",
  "featured_label": "Destacada esta semana",
  "species_label": "Especies",
  "observers_label": "Observadores",
  "obs_label": "Observaciones",
  "delta_label": "Esta semana",
  "tab_grid": "Cuadrícula",
  "tab_radial": "Árbol",
  "chip_all": "Todos",
  "chip_endemic": "Endémicas",
  "chip_nom059": "NOM-059",
  "chip_rare": "Raras"
}
```

- [ ] **Step 2: Create the orchestrator**

`src/components/species/EspeciesHero.astro`:

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';
import FeaturedSpeciesCard from './FeaturedSpeciesCard.astro';
import PlatformStats from './PlatformStats.astro';

interface Featured {
  scientificName: string;
  commonName: string | null;
  slug: string | null;
  thumbnailUrl: string | null;
  endemicMx: boolean | null;
  nom059Status: string | null;
  rarityBucket: number | null;
}
interface Stats { totalSpecies: number; totalObservers: number; totalObs: number; newSpeciesThisWeek: number; }

interface Props { lang: Locale; featured: Featured | null; stats: Stats; }
const { lang, featured, stats } = Astro.props;
const tr = t(lang) as unknown as { explore_species_hero: Record<string, string> };
const eh = tr.explore_species_hero;
---
<header class="space-y-3 py-6">
  <h1 class="text-3xl font-bold tracking-tight">{eh.title}</h1>
  <p class="text-zinc-600 dark:text-zinc-400 max-w-[60ch]">{eh.subtitle}</p>
</header>
<div class="grid gap-4" style="grid-template-columns: 1.7fr 1fr;">
  {featured ? <FeaturedSpeciesCard lang={lang} {...featured} /> : <div></div>}
  <PlatformStats lang={lang} {...stats} />
</div>
<style>
  @media (max-width: 820px) {
    [data-es-hero-row] { grid-template-columns: 1fr !important; }
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/species/EspeciesHero.astro src/i18n/en.json src/i18n/es.json
git commit -m "feat(species): add EspeciesHero composition + i18n (M34)"
```

---

### Task 16: `FilterChips.astro` with URL state

**Files:**
- Create: `src/components/species/FilterChips.astro`

- [ ] **Step 1: Create the component**

```astro
---
import type { Locale } from '../../i18n/utils';
import { t } from '../../i18n/utils';

interface Props { lang: Locale; }
const { lang } = Astro.props;
const tr = t(lang) as unknown as { explore_species_hero: Record<string, string> };
const eh = tr.explore_species_hero;
---
<div class="flex flex-wrap gap-1.5 mt-2.5" data-filter-chips role="group" aria-label="Filters">
  <button type="button" class="es-chip" data-chip="all" aria-pressed="true">{eh.chip_all}</button>
  <button type="button" class="es-chip" data-chip="endemic" aria-pressed="false">🇲🇽 {eh.chip_endemic}</button>
  <button type="button" class="es-chip" data-chip="nom059" aria-pressed="false">⚠ {eh.chip_nom059}</button>
  <button type="button" class="es-chip" data-chip="rare" aria-pressed="false">★ {eh.chip_rare}</button>
  <button type="button" class="es-chip" data-chip="kingdom:Animalia" aria-pressed="false">Animalia</button>
  <button type="button" class="es-chip" data-chip="kingdom:Plantae" aria-pressed="false">Plantae</button>
  <button type="button" class="es-chip" data-chip="kingdom:Fungi" aria-pressed="false">Fungi</button>
</div>

<style>
  .es-chip { padding: 4px 12px; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 9999px; background: #fff; color: #475569; cursor: pointer; }
  .es-chip[aria-pressed="true"] { background: #047857; color: #fff; border-color: #047857; }
</style>
```

(Wiring chip clicks to URL state lives in the orchestrator in Task 17.)

- [ ] **Step 2: Commit**

```bash
git add src/components/species/FilterChips.astro
git commit -m "feat(species): add FilterChips component (M34)"
```

---

### Task 17: Refactor `ExploreSpeciesView.astro`

**Files:**
- Modify: `src/components/ExploreSpeciesView.astro`

This is the largest refactor (the existing file is 862 lines). The strategy: keep the index/detail dual-mode shell, replace the hero/cards/tabs section, drop the Buscar tab.

- [ ] **Step 1: Drop the Buscar tab**

In the frontmatter / template region (around the existing tab strip with `id="es-view-tabs"`), remove the `<button id="es-tab-search">` element. Remove `<div id="es-panel-search">` from the render block. Remove the script logic that toggles to the search panel. The always-visible search input takes over.

- [ ] **Step 2: Add EspeciesHero + FilterChips imports**

In the frontmatter:

```astro
import EspeciesHero from './species/EspeciesHero.astro';
import FilterChips from './species/FilterChips.astro';
```

- [ ] **Step 3: Replace the existing `<header>` block in index mode**

Replace the existing header (`<header class="space-y-3 py-6">...</header>`) with placeholder slots that get hydrated client-side once the data loads:

```astro
<div id="es-hero-slot"></div>
<FilterChips lang={lang} />
```

Keep the existing tabs (Cuadrícula / Árbol) and search input.

- [ ] **Step 4: Update the script to fetch featured + stats and render hero**

Inside the existing `<script>` block, near the top of the `runIndex()` function (or whatever the index orchestrator is named), before the existing taxon fetch:

```ts
async function loadFeaturedAndStats(supabase: ReturnType<typeof getSupabase>) {
  const [{ data: f }, { data: s }] = await Promise.all([
    supabase.from('featured_species_current').select('*').limit(1).maybeSingle(),
    supabase.from('mv_platform_stats').select('*').limit(1).maybeSingle(),
  ]);
  return { featured: f, stats: s };
}
```

Then mount the hero into `#es-hero-slot` by emitting matching HTML — same approach as PokedexView (mirror the static markup). Keep cards rendering through `renderSpeciesCard()` from `species-card-html.ts`.

- [ ] **Step 5: Wire chip clicks to URL state**

Add a script-level helper that:

```ts
import { parseChips, serializeChips, filterByChips, type ChipsState } from '../lib/species-filters';

let currentChips: ChipsState = parseChips(window.location.search);

function applyChips(rows: SpeciesIndexRow[]) {
  return filterByChips(rows, currentChips);
}

function wireChipClicks(allRows: SpeciesIndexRow[]) {
  const chips = document.querySelectorAll<HTMLButtonElement>('[data-filter-chips] [data-chip]');
  chips.forEach(btn => btn.addEventListener('click', () => {
    const chip = btn.dataset.chip ?? '';
    if (chip === 'all') {
      currentChips = { endemic: false, nom059: false, rare: false, kingdom: null };
    } else if (chip === 'endemic' || chip === 'nom059' || chip === 'rare') {
      currentChips = { ...currentChips, [chip]: !currentChips[chip] };
    } else if (chip.startsWith('kingdom:')) {
      const k = chip.slice('kingdom:'.length);
      currentChips = { ...currentChips, kingdom: currentChips.kingdom === k ? null : k };
    }
    history.replaceState({}, '', `${window.location.pathname}${serializeChips(currentChips)}`);
    paintChipPressedState(currentChips);
    rerenderCards(applyChips(allRows));
  }));
}

function paintChipPressedState(s: ChipsState) {
  const chips = document.querySelectorAll<HTMLButtonElement>('[data-filter-chips] [data-chip]');
  chips.forEach(btn => {
    const chip = btn.dataset.chip ?? '';
    let pressed = false;
    if (chip === 'all') pressed = !s.endemic && !s.nom059 && !s.rare && !s.kingdom;
    else if (chip === 'endemic') pressed = s.endemic;
    else if (chip === 'nom059')  pressed = s.nom059;
    else if (chip === 'rare')    pressed = s.rare;
    else if (chip.startsWith('kingdom:')) pressed = s.kingdom === chip.slice(8);
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  });
}
```

`rerenderCards` is the existing card-rendering function refactored to take a row array.

- [ ] **Step 6: Wire ✓-in-dex marker**

Right after fetching `taxaRows`, if the user is logged in, also fetch their pokedex:

```ts
let inDexSet = new Set<string>();
const { data: { user } } = await supabase.auth.getUser();
if (user) {
  const { data: dex } = await supabase
    .from('profile_pokedex').select('taxon_id').eq('user_id', user.id);
  inDexSet = new Set((dex ?? []).map((d: { taxon_id: string }) => d.taxon_id));
}
```

Pass `inDex: inDexSet.has(row.taxon_id)` into `renderSpeciesCard()` per row.

- [ ] **Step 7: Typecheck + dev test**

```bash
npm run typecheck
npm run dev
```

Open http://localhost:4321/es/explorar/especies/ — confirm:
- Hero shows featured species (or hides if 0 rows) + 4 stat cards
- Chips toggle visually and update URL
- Reload preserves filter state
- Cards include thumbnails (or "sin foto aún" placeholder)
- If logged in, ✓ appears on already-collected species

- [ ] **Step 8: Commit**

```bash
git add src/components/ExploreSpeciesView.astro
git commit -m "feat(species): wire ExploreSpeciesView to new hero + filters + cards (M34)"
```

---

## Phase 6 — Verification

### Task 18: Build + tests + e2e smoke

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (add minimal assertions)

- [ ] **Step 1: Add an e2e assertion that hero markup renders**

Append to `tests/e2e/smoke.spec.ts`:

```ts
test('Pokédex hero renders 3 tiles for logged user (or empty state for anon)', async ({ page }) => {
  await page.goto('/es/perfil/dex/');
  // Anon user lands here — first-visit copy must appear OR cards must render.
  await expect(
    page.locator('text=/Empieza tu Pokédex|Tu Pokédex/').first()
  ).toBeVisible();
});

test('Especies hero + filter chips render', async ({ page }) => {
  await page.goto('/es/explorar/especies/');
  await expect(page.getByRole('heading', { name: 'Especies' })).toBeVisible();
  await expect(page.locator('[data-filter-chips]')).toBeVisible();
});

test('Especies chip toggle updates URL', async ({ page }) => {
  await page.goto('/es/explorar/especies/');
  await page.click('[data-filter-chips] [data-chip="endemic"]');
  await expect(page).toHaveURL(/[?&]endemic=1/);
});
```

- [ ] **Step 2: Run the full pre-PR check**

```bash
npm run typecheck
npm run test
npm run build
```

Expected: typecheck clean, all unit tests pass, build succeeds with EN/ES paired pages.

- [ ] **Step 3: Run the e2e suite**

```bash
npm run test:e2e
```

Expected: all e2e tests pass on chromium + mobile-chrome.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.ts
git commit -m "test(species): e2e smoke for new Pokédex + Especies UI (M34)"
```

- [ ] **Step 5: Manual QA pass**

In a real browser on `npm run dev`:
- `/es/perfil/dex/` (logged out): first-visit copy appears
- `/es/perfil/dex/` (logged in with ≥ 1 obs): 3 tiles render, kingdom pills filter, suggestion appears in tile 3
- `/es/perfil/dex/` (mobile viewport ≤ 820 px): tiles stack vertically
- `/es/explorar/especies/` (logged out): featured + stats + cards render; chips work; URL updates
- `/es/explorar/especies/` (logged in): ✓ appears on cards already in dex
- `/en/profile/dex/` and `/en/explore/species/`: same behavior, English strings
- Detail link from a card → species detail page works (existing route)

If anything is broken, file individual fix commits — don't squash.

---

## Self-Review

Spec sections vs tasks:

| Spec section | Implementing task |
|---|---|
| Card style — direction D | Task 8 (component), Task 12/17 (consumption via species-card-html.ts in Task 12) |
| Pill priority + pill-for-species logic | Task 6 |
| No-photo placeholder | Task 8 |
| ✓ in dex marker | Task 8 (rendering), Task 17 (data fetch + integration) |
| Pokédex hero 3-tile + responsive collapse | Task 11, Task 12 |
| Pokédex kingdom pills | Task 10, Task 12 |
| Pokédex empty state | Task 11 (firstVisit prop), Task 12 (wiring) |
| Pokédex visitor mode tile 3 hidden | Task 12 (skip RPC call) |
| Pokédex "Para cazar" RPC | Task 5 |
| `profile_pokedex` extension | Task 2 |
| Especies featured species | Task 3 (view), Task 13 (component), Task 17 (wiring) |
| Especies platform stats | Task 4 (MV + cron), Task 14 (component) |
| Especies hero composition | Task 15 |
| Especies filter chips | Task 7 (logic), Task 16 (component), Task 17 (wiring) |
| Drop Buscar tab | Task 17 step 1 |
| `taxa_thumbnails` | Task 1 |
| All i18n strings (EN+ES parity) | Tasks 8, 11, 15 |
| Tests: pill resolver | Task 6 |
| Tests: chip URL state | Task 7 |
| Tests: e2e smoke | Task 18 |

No gaps.

Open spec questions still open after the plan:
1. R2 thumbnail transform availability — flagged in spec, not gated by this plan. Plan ships with full-size images. If transform exists, swap the `src` to include `?w=400&q=70` in Task 8 / Task 12.
2. Featured-species blurb localisation — out of scope, deferred.
3. "+12 esta semana" delta semantics — confirmed by the SQL definition in Task 4.

Type consistency check:
- `pillForSpecies` type signature consistent across Task 6 (definition), Task 8 (Astro consumer), Task 12 (renderSpeciesCard via species-card-html).
- `ChipsState` consistent in Task 7 (definition), Task 17 (consumer).
- `SpeciesRow` from `species-filters` is a structural subtype of the `taxaRows` shape used in `ExploreSpeciesView` — confirmed in Task 17.
- `DexRow` updated in Task 12 step 3d to match the extended `profile_pokedex` view from Task 2.

No type drift.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-06-pokedex-especies-visual-plan.md`.
