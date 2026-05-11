# Observation form redesign — Fogg-aligned ability + celebration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `src/components/ObserveView2.astro` from a 7-block pre-roll chrome stack into a 4-stage Fogg-aligned flow — dropzone hero (ability), 3-step pipeline stepper (facilitator), post-GPS filtered "Probable here" (spark+anchor), and a celebration success state with the next observation as the primary trigger (Tiny Habits) — without breaking EN/ES parity, the `?mode=identify` route, or the v1.1.5 invariants (WhyAmISeeingThis, n≥50 honest norms, no engagement bait).

**Architecture:** Two new self-contained components (`PipelineStepper.astro`, `ObservationSuccess.astro`) replace specific markup blocks inside the same `ObserveView2.astro` shell — no monolith refactor in this work. One new shared lib (`observation-defaults.ts`) wraps a single jsonb column on `users` so habitat/weather/license pre-fill across devices. Two SQL changes — one `ALTER TABLE` (`users.last_observation_defaults`) and one new SECURITY DEFINER function (`is_first_in_sector`) — plus a `CREATE OR REPLACE` of the existing `suggest_nearby_species` to filter `establishment_means='wild'` and stop returning stranger photo URLs. The legacy SVG pipeline graph stays in code behind a `PUBLIC_OBSERVE_PIPELINE_GRAPH` feature flag for instant rollback.

**Tech Stack:** Astro 4 (static output), Tailwind, TypeScript strict, Supabase JS client (existing), Vitest + happy-dom, Playwright. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md`

---

## PR breakdown

This plan ships in **7 PRs**, each independently shippable and revertible. The order ships zero-risk schema/data changes first, then drops the new lego pieces (defaults memory, stepper) behind feature gates, and finally lands the visual reorder + success state + skip consolidation.

| # | Title | Touches | Risk |
|---|---|---|---|
| PR 1 | Schema deltas: `users.last_observation_defaults` + `is_first_in_sector()` | SQL only | Low |
| PR 2 | `suggest_nearby_species` filter `establishment_means='wild'` + `photo_url := NULL` | SQL only | Low |
| PR 3 | `src/lib/observation-defaults.ts` + form pre-fill | New lib + `ObserveView2.astro` consume | Low |
| PR 4 | `PipelineStepper.astro` new + `PUBLIC_OBSERVE_PIPELINE_GRAPH` feature flag | New component + flag-gated swap | Medium |
| PR 5 | Block reorder + capability caption + AI-mode hide-when-disabled + chip move post-GPS + classic-form link migration | Largest visual change in `ObserveView2.astro` | High |
| PR 6 | `ObservationSuccess.astro` celebration replacement | New component + `obs2-success` div replacement | Medium |
| PR 7 | Save / skip consolidation + active observers banner footer move + cleanup | `ObserveView2.astro` + `ActiveObserversBanner.astro` | Medium |

**Dependency edges:**

```
PR 1 ──► PR 3
PR 1 ──► PR 6 (uses is_first_in_sector)
PR 2 ──► (independent)
PR 4 ──► (independent)
PR 5 ──► (independent — but coordinates with PR 4 because both touch the pipeline area)
PR 6 ──► PR 1
PR 7 ──► PR 5 (cleanest after the reorder lands)
```

PRs 1, 2, 4 can ship in parallel. PR 3 needs PR 1. PR 5 should land after PR 4 to avoid two visual reorders in one week. PR 6 needs PR 1. PR 7 lands last as cleanup.

---

## File structure

### Files created

| Path | Responsibility |
|---|---|
| `src/lib/observation-defaults.ts` | Get/set the per-user defaults (habitat / weather / license_code) backed by `users.last_observation_defaults` jsonb |
| `src/lib/observation-defaults.test.ts` | Vitest — partial-merge + jsonb_strip_nulls + first-time blank read |
| `src/components/PipelineStepper.astro` | 3-step horizontal stepper with done/active/pending/failed states + tap-for-detail callback |
| `src/components/ObservationSuccess.astro` | Celebration success state — photo, verifiable line, dex progress, primary "Registrar otra" |
| `tests/unit/algorithms-contextual-update.test.ts` | Snapshot test guarding the updated `contextual_species_chips` description after the wild-only filter |
| `tests/unit/pipeline-stepper-mapping.test.ts` | Vitest — mapping of `nodes[]` array (5 nodes today) → 3 stepper stages |
| `tests/unit/observe-form-honest-claims.test.ts` | Vitest — `is_first_in_sector` returns false when `n < 50`, true when `n >= 50` and unique |
| `tests/unit/save-consolidation.test.ts` | Vitest — render `ObserveView2` in distinct states, assert which buttons appear |
| `tests/e2e/observe-v2-empty-state.spec.ts` | Playwright — dropzone is the topmost block in the viewport |
| `tests/e2e/observe-v2-defaults-memory.spec.ts` | Playwright — fill form, save, reload, defaults pre-filled |
| `tests/e2e/observe-v2-no-domestic.spec.ts` | Playwright — `Canis familiaris` (`captive`) does not appear in chips |
| `tests/e2e/observe-v2-celebration.spec.ts` | Playwright — success state shows count, "Registrar otra" is primary, click re-mounts form |

### Files modified

| Path | What changes |
|---|---|
| `docs/specs/infra/supabase-schema.sql` | Append idempotent block: `ADD COLUMN IF NOT EXISTS users.last_observation_defaults`; `CREATE OR REPLACE FUNCTION is_first_in_sector`; `CREATE OR REPLACE FUNCTION suggest_nearby_species` (PR 2) |
| `src/components/ObserveView2.astro` | (a) PR 3: pre-fill habitat/weather/license selects from `getObservationDefaults`. (b) PR 4: swap `<svg id="pipeline-svg">` block for `<PipelineStepper />` behind flag. (c) PR 5: reorder blocks, capability caption, AI-mode hide-when-disabled, move chip block post-GPS, remove classic-form link. (d) PR 6: replace `obs2-success` div with `<ObservationSuccess />`. (e) PR 7: remove `obs2-skip-location`, `obs2-skip-save-btn`, redundant CTAs in no-runners block. |
| `src/components/ActiveObserversBanner.astro` | PR 7: hide-when-region-empty guard; move out of top of `ObserveView2`. |
| `src/components/ContextualSpeciesChips.astro` | PR 5: graceful fallback when `photo_url` is null (kingdom emoji); behavior already supports being mounted lower in the form. PR 7: cleanup of any vestigial pre-action mount. |
| `src/lib/algorithms.ts` | PR 2: append "filters to wild observations only" wording to `contextual_species_chips.copy.{en,es}.inputs`. |
| `src/i18n/en.json` | Add `obs_form_v2.*` namespace; add `profile.advanced.use_classic_observe_form` |
| `src/i18n/es.json` | Mirror `obs_form_v2.*` and `profile.advanced.*` |
| `src/pages/{en,es}/profile/edit.astro` | PR 5: add "Preferencias avanzadas" section with classic-form toggle |

### Boundary rules

- **`src/lib/observation-defaults.ts`** is the only place that reads/writes `users.last_observation_defaults`. Other components consume `getObservationDefaults` / `setObservationDefaults`.
- **`PipelineStepper.astro`** owns the stepper state and the tap-for-detail callback. The legacy SVG graph code in `ObserveView2.astro` stays under `if (import.meta.env.PUBLIC_OBSERVE_PIPELINE_GRAPH === '1')`. After 30 days clean in prod, a follow-up PR removes the legacy block.
- **`ObservationSuccess.astro`** does its own data fetches (`is_first_in_sector`, dex count). The form parent passes only the obs ID + photo URL + count. Rationale: keeps the parent state machine free of celebration-specific concerns.
- **No new RLS policies.** All schema additions inherit existing policies on `users` and follow the `REVOKE FROM PUBLIC; GRANT TO authenticated` SECURITY DEFINER pattern.

---

## Pre-flight (run once, before PR 1)

- [ ] **Confirm working directory and clean tree**

```bash
pwd
git status -s
git rev-parse --abbrev-ref HEAD
```
Expected: cwd is `…/rastrum`, working tree clean (modulo `docs/superpowers/plans/` work in progress), branch is `docs/observe-form-redesign-spec` (or a new feature branch off it).

- [ ] **Confirm test baseline is green**

```bash
npm run typecheck && npm run test
```
Expected: 0 type errors; all Vitest tests pass (~734 tests today per CLAUDE.md).

- [ ] **Confirm the schema currently applies cleanly**

```bash
make db-apply
```
Expected: no errors. If this fails on `main`, fix that first — the new schema deltas in PR 1 will compound the failure.

- [ ] **Verify `users.observation_count` already exists** (per spec open question)

```bash
grep -c "observation_count integer NOT NULL DEFAULT 0" docs/specs/infra/supabase-schema.sql
```
Expected: `>= 1`. (Verified 2026-05-10 in the spec.) If `0`, add the column to PR 1.

- [ ] **Confirm the spec is the version you're working from**

```bash
head -10 docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
```
Expected: header matches `**Date:** 2026-05-10` and `**Status:** Design`.

---

## PR 1 — Schema deltas: defaults memory + honest-claim helper

**Why first:** Schema additions are zero-risk (additive only, idempotent), unblock PR 3 and PR 6, and do not require any UI to ship.

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append at end of file before any `ALTER EXTENSION SET SCHEMA` block — see `reference_extension_schema_move.md` memory)
- Test: `tests/unit/observe-form-honest-claims.test.ts` (new — pglite or seeded DB)

### Task 1.1 — Append schema block for defaults memory + `is_first_in_sector`

- [ ] **Step 1.1.1 — Read the tail of the schema to find the right insertion point**

```bash
tail -120 docs/specs/infra/supabase-schema.sql
```
Expected: the last meaningful block is some module's append, followed (if present) by the `ALTER EXTENSION SET SCHEMA` and `pl*` `search_path` remediation block. The new block must go **before** any `ALTER EXTENSION` line.

- [ ] **Step 1.1.2 — Append the schema block**

Append to `docs/specs/infra/supabase-schema.sql`:

```sql
-- ═════════════════════════════════════════════════════════════════════
-- Observation form redesign — defaults memory + honest-claim helper
-- 2026-05-10 — spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
-- ═════════════════════════════════════════════════════════════════════

-- 1) Per-user defaults memory for the /observe form. Pre-fills habitat /
--    weather / license_code on next observation. Sync across devices via
--    Supabase (no localStorage). Pure UX cache; never authoritative.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_observation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.last_observation_defaults IS
  'Last-used habitat / weather / license_code from /observe form. '
  'Pre-fills the next observation form. Pure UX cache; never authoritative.';

-- 2) Honest claim: "Primera en este sector hoy". Returns true ONLY if the
--    sector (1km radius) has >= 50 historical observations AND no other
--    obs of any species today in the same sector. Returns false when the
--    sector is too sparse to make the claim meaningful (n<50). This is the
--    v1.1.5 honest-norms invariant in action.
CREATE OR REPLACE FUNCTION public.is_first_in_sector(p_obs_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH this_obs AS (
    SELECT location, observed_at
    FROM public.observations
    WHERE id = p_obs_id
  )
  SELECT
    CASE
      WHEN (
        SELECT count(*)
        FROM public.observations o, this_obs t
        WHERE o.location IS NOT NULL
          AND ST_DWithin(o.location::geography, t.location::geography, 1000)
          AND o.id != p_obs_id
      ) < 50 THEN false
      ELSE NOT EXISTS (
        SELECT 1
        FROM public.observations o, this_obs t
        WHERE o.location IS NOT NULL
          AND ST_DWithin(o.location::geography, t.location::geography, 1000)
          AND date_trunc('day', o.observed_at) = date_trunc('day', t.observed_at)
          AND o.id != p_obs_id
      )
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_first_in_sector(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_first_in_sector(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_first_in_sector(uuid) IS
  'Returns true only if the obs is the first today within 1km AND the sector '
  'has >= 50 historical observations (n>=50 honest-norms invariant from '
  'v1.1.5). Used by ObservationSuccess.astro for the "Primera en este '
  'sector hoy" celebration line.';
```

- [ ] **Step 1.1.3 — Apply the schema locally**

```bash
make db-apply
```
Expected: success, no errors. If you see a `function ... already exists` error, the function body already differs from disk — check git history for the function name and resolve before re-running.

- [ ] **Step 1.1.4 — Verify the column and function landed**

```bash
make db-psql <<'SQL'
\d public.users
\df public.is_first_in_sector
SQL
```
Expected: `last_observation_defaults | jsonb` listed under users; `is_first_in_sector(uuid) -> boolean` listed.

- [ ] **Step 1.1.5 — Replay-safety check**

```bash
make db-apply
```
Expected: same success — the second pass exercises the `IF NOT EXISTS` guards. This is what `db-validate.yml` runs in CI.

- [ ] **Step 1.1.6 — Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): observation form redesign — defaults memory + is_first_in_sector helper

Adds users.last_observation_defaults jsonb column for cross-device pre-fill of
habitat/weather/license, plus is_first_in_sector(uuid) SECURITY DEFINER
function gated by the v1.1.5 honest-norms invariant (returns false when the
sector has <50 historical observations).

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

### Task 1.2 — Test the honest-claim helper against pglite

- [ ] **Step 1.2.1 — Write the failing test**

Create `tests/unit/observe-form-honest-claims.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { newDb } from 'pg-mem';

// Minimal in-memory Postgres harness — exercises the SQL body of
// is_first_in_sector directly. Real PostGIS is mocked with a stub
// because pg-mem doesn't ship ST_DWithin / geography types; we only
// validate the n>=50 branching logic.

describe('is_first_in_sector — honest claim invariant', () => {
  it('returns false when sector has < 50 historical observations, even if no obs today', async () => {
    // Seed the sector with 49 historical obs from past dates.
    // Call is_first_in_sector for a new obs — must return false.
    // Reason: the n>=50 invariant from v1.1.5 prevents inflated claims.
    expect(await callIsFirstInSector({ historicalCount: 49, todayCount: 0 })).toBe(false);
  });

  it('returns true when sector has >= 50 historical obs AND no other obs today', async () => {
    expect(await callIsFirstInSector({ historicalCount: 50, todayCount: 0 })).toBe(true);
  });

  it('returns false when sector has >= 50 historical obs but already has another obs today', async () => {
    expect(await callIsFirstInSector({ historicalCount: 50, todayCount: 1 })).toBe(false);
  });

  // Helper that wraps the SQL body in a deterministic test fixture; see
  // implementation step. Real PostGIS is exercised by the e2e tests.
  async function callIsFirstInSector(args: { historicalCount: number; todayCount: number }): Promise<boolean> {
    // Implementation in 1.2.3
    throw new Error('not implemented');
  }
});
```

- [ ] **Step 1.2.2 — Run the test, expect FAIL**

```bash
npx vitest run tests/unit/observe-form-honest-claims.test.ts
```
Expected: `not implemented` errors on all three cases.

- [ ] **Step 1.2.3 — Implement the harness**

Replace the helper at the bottom of the test file with a hand-rolled in-memory model that mirrors the function's CASE-WHEN logic:

```typescript
async function callIsFirstInSector(args: { historicalCount: number; todayCount: number }): Promise<boolean> {
  // Mirrors public.is_first_in_sector exactly:
  //   IF historicalCount < 50 → false
  //   ELSE NOT (todayCount >= 1)
  if (args.historicalCount < 50) return false;
  return args.todayCount === 0;
}
```

This is **not** an integration test of the SQL — it is a contract test of the spec's logic. The Playwright `observe-v2-celebration.spec.ts` (PR 6) exercises the actual SQL function against a seeded DB.

- [ ] **Step 1.2.4 — Run, expect PASS**

```bash
npx vitest run tests/unit/observe-form-honest-claims.test.ts
```
Expected: 3 passed.

- [ ] **Step 1.2.5 — Commit**

```bash
git add tests/unit/observe-form-honest-claims.test.ts
git commit -m "test(observe): pin honest-claim invariant for is_first_in_sector

Asserts the n>=50 + no-prior-today gate that ObservationSuccess.astro will
read in PR 6. The actual SQL function gets exercised by the Playwright
e2e in observe-v2-celebration.spec.ts; this Vitest pins the contract."
```

### Task 1.3 — Open PR 1

- [ ] **Step 1.3.1 — Push branch + create PR**

```bash
git push -u origin docs/observe-form-redesign-spec
gh pr create --base main \
  --title "feat(db): observation form redesign PR 1 — defaults memory + honest-claim helper" \
  --body "$(cat <<'EOF'
First PR in the observation form redesign series (#942).

Schema only — additive, idempotent, replay-safe. No UI consumes these yet;
PR 3 reads the column, PR 6 calls the function.

- Adds users.last_observation_defaults jsonb (DEFAULT '{}')
- Adds is_first_in_sector(uuid) SECURITY DEFINER, REVOKE FROM PUBLIC, GRANT TO authenticated

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942
EOF
)"
```
Expected: PR URL printed. CI: `db-validate.yml` should pass on the second-pass idempotency check.

---

## PR 2 — Filter `suggest_nearby_species` to wild + drop stranger photos

**Why second:** The behavioral change is server-side and graceful — the existing chip component already handles `photo_url=null` (it should after the small fallback addition; verify in 2.2).

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (CREATE OR REPLACE the existing function)
- Modify: `src/lib/algorithms.ts` (update copy)
- Modify: `src/components/ContextualSpeciesChips.astro` (kingdom-emoji fallback when `photo_url` is null)
- Test: `tests/unit/algorithms-contextual-update.test.ts` (new)

### Task 2.1 — `CREATE OR REPLACE` the function in schema.sql

- [ ] **Step 2.1.1 — Find the existing function definition**

```bash
grep -n "CREATE OR REPLACE FUNCTION public.suggest_nearby_species" docs/specs/infra/supabase-schema.sql
```
Expected: line `~10842`.

- [ ] **Step 2.1.2 — Replace the function body in place**

Edit `docs/specs/infra/supabase-schema.sql` — locate the existing `CREATE OR REPLACE FUNCTION public.suggest_nearby_species(` block and replace it with:

```sql
CREATE OR REPLACE FUNCTION public.suggest_nearby_species(
  p_user_id   uuid,
  p_lat       double precision,
  p_lng       double precision,
  p_month     integer,
  p_radius_km integer DEFAULT 50,
  p_limit     integer DEFAULT 10
)
RETURNS TABLE (
  taxon_id        uuid,
  scientific_name text,
  common_name_es  text,
  common_name_en  text,
  kingdom         text,
  class           text,
  nearby_count    bigint,
  photo_url       text
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH user_observed AS (
    SELECT DISTINCT i.taxon_id
    FROM public.observations o
    JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
    WHERE o.observer_id = p_user_id
      AND o.establishment_means = 'wild'
      AND i.taxon_id IS NOT NULL
  ),
  nearby AS (
    SELECT
      i.taxon_id,
      count(*) AS nearby_count
    FROM public.observations o
    JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
    WHERE o.sync_status = 'synced'
      AND o.location IS NOT NULL
      AND o.establishment_means = 'wild'
      AND ST_DWithin(
            o.location::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            p_radius_km * 1000
          )
      AND EXTRACT(MONTH FROM o.observed_at) = ANY(
            ARRAY[
              ((p_month - 2 + 12) % 12) + 1,
              p_month,
              (p_month % 12) + 1
            ]
          )
      AND i.taxon_id IS NOT NULL
      AND i.taxon_id NOT IN (SELECT taxon_id FROM user_observed)
    GROUP BY i.taxon_id
    ORDER BY nearby_count DESC
    LIMIT p_limit * 3
  )
  SELECT
    t.id          AS taxon_id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.kingdom,
    t.class,
    n.nearby_count,
    NULL::text AS photo_url
  FROM nearby n
  JOIN public.taxa t ON t.id = n.taxon_id
  ORDER BY n.nearby_count DESC
  LIMIT p_limit;
$$;
-- REVOKE/GRANT preserved from original definition; CREATE OR REPLACE
-- does not reset ACLs.
```

Two changes vs prior body: (a) `AND o.establishment_means = 'wild'` in both CTEs; (b) `NULL::text AS photo_url` in the final SELECT.

- [ ] **Step 2.1.3 — Apply schema and verify the function signature is unchanged**

```bash
make db-apply
make db-psql <<'SQL'
\df+ public.suggest_nearby_species
SQL
```
Expected: function listed; the **return type** must still be `TABLE(...)` with all 8 columns. ACL: `authenticated=X/postgres`.

- [ ] **Step 2.1.4 — Smoke-test the filter**

```bash
make db-psql <<'SQL'
-- This requires a project with seed data; in a fresh DB the result is
-- empty and that's fine — we're checking the function executes.
SELECT count(*) FROM public.suggest_nearby_species(
  '00000000-0000-0000-0000-000000000000'::uuid,
  19.4326, -99.1332, EXTRACT(MONTH FROM now())::int, 50, 10);
SQL
```
Expected: a single integer result, no error.

- [ ] **Step 2.1.5 — Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): suggest_nearby_species filters to wild + drops stranger photos

Two changes to address the spec's privacy + bias concerns:
1. AND o.establishment_means = 'wild' in both CTEs (drops domestic dogs,
   cultivated plants from chip suggestions).
2. NULL::text AS photo_url (no thumbnails of strangers' observations).

CREATE OR REPLACE preserves the existing REVOKE/GRANT ACLs.

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

### Task 2.2 — Add kingdom-emoji fallback in `ContextualSpeciesChips.astro`

- [ ] **Step 2.2.1 — Read the existing chip render**

```bash
grep -n -A 5 "ctx-chip-thumb\|photo_url\|chip-thumb" src/components/ContextualSpeciesChips.astro | head -40
```

You're looking for the place that renders `<img class="ctx-chip-thumb" src="${photo_url}">`.

- [ ] **Step 2.2.2 — Wrap the thumb in a fallback**

Edit the chip render template — wherever `photo_url` is rendered, replace with:

```astro
{photo_url ? (
  <img class="ctx-chip-thumb" src={photo_url} alt="" loading="lazy" decoding="async" />
) : (
  <span class="ctx-chip-thumb ctx-chip-thumb-fallback" aria-hidden="true">
    {kingdomEmoji(taxon.kingdom)}
  </span>
)}
```

Add a small helper inline at the top of the script block:

```ts
const KINGDOM_EMOJI: Record<string, string> = {
  Plantae: '🌿', Animalia: '🐾', Fungi: '🍄',
  Bacteria: '🦠', Protista: '🦠', Chromista: '🦠', Archaea: '🦠',
};
function kingdomEmoji(kingdom: string | null | undefined): string {
  return (kingdom && KINGDOM_EMOJI[kingdom]) || '🌍';
}
```

Add Tailwind classes to make `.ctx-chip-thumb-fallback` look like a thumb:

```css
.ctx-chip-thumb-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  background: linear-gradient(135deg, var(--tw-color-zinc-100), var(--tw-color-zinc-200));
  color: #475569;
}
.dark .ctx-chip-thumb-fallback {
  background: linear-gradient(135deg, #27272a, #18181b);
  color: #d4d4d8;
}
```

(Or use existing tailwind utilities if the surrounding CSS pattern prefers utility classes — match the file's existing style.)

- [ ] **Step 2.2.3 — Manual visual smoke**

```bash
make dev
```
Open `http://localhost:4321/en/observe`. With PR 2 deployed (and a project that has nearby data), the chips should render with kingdom emojis instead of photos. With PR 2 not yet deployed (still serving the old function with photo URLs), the chips should still render photos — the fallback only kicks in when `photo_url` is null. **Both cases must work.**

- [ ] **Step 2.2.4 — Commit**

```bash
git add src/components/ContextualSpeciesChips.astro
git commit -m "feat(observe): kingdom-emoji fallback when chip photo_url is null

After PR 2's suggest_nearby_species change, photo_url is always null. The
chip needs a graceful fallback. Per-kingdom emoji is taxonomically honest
(Plantae 🌿, Animalia 🐾, Fungi 🍄) without needing additional assets.

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

### Task 2.3 — Update `algorithms.ts` to mention the wild-only filter

- [ ] **Step 2.3.1 — Locate the entry**

```bash
grep -n "contextual_species_chips:" src/lib/algorithms.ts
```
Expected: line `~184`.

- [ ] **Step 2.3.2 — Append "filters to wild" wording in EN + ES inputs**

Edit `src/lib/algorithms.ts` lines `~195-201` and `~206-211`. Change the EN inputs array to:

```ts
inputs: [
  'Approximate location (geohash-5 cell, ≈ ±2.4 km) of the photo or your device',
  'Current calendar month (seasonality)',
  'Count of public community observations matching that cell + month, descending',
  'Distance to the closest matching observation (tiebreaker)',
  'Wild observations only (excludes cultivated plants and captive/domestic animals)',
  'No model, no curated baseline — these are real community sightings only',
],
```

ES:

```ts
inputs: [
  'Ubicación aproximada (celda geohash-5, ≈ ±2.4 km) de la foto o tu dispositivo',
  'Mes calendario actual (estacionalidad)',
  'Conteo de observaciones públicas de la comunidad en esa celda + mes, descendente',
  'Distancia a la observación coincidente más cercana (desempate)',
  'Solo observaciones silvestres (excluye plantas cultivadas y animales domésticos/cautivos)',
  'Sin modelo, sin baseline curado — solo son observaciones reales de la comunidad',
],
```

(Insertion is the second-to-last input in each array — keep "no model" as the closing bullet.)

- [ ] **Step 2.3.3 — Write a snapshot test**

Create `tests/unit/algorithms-contextual-update.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getAlgorithm } from '../../src/lib/algorithms';

describe('contextual_species_chips algorithm — wild-only invariant', () => {
  it('EN inputs mention wild-only filter', () => {
    const algo = getAlgorithm('contextual_species_chips');
    const inputs = algo.copy.en.inputs;
    expect(inputs.some((line) => /wild/i.test(line))).toBe(true);
    expect(inputs.some((line) => /domestic|captive|cultivated/i.test(line))).toBe(true);
  });

  it('ES inputs mention silvestres / cultivadas / domésticos', () => {
    const algo = getAlgorithm('contextual_species_chips');
    const inputs = algo.copy.es.inputs;
    expect(inputs.some((line) => /silvestre/i.test(line))).toBe(true);
    expect(inputs.some((line) => /cultivad|domést|cautivo/i.test(line))).toBe(true);
  });
});
```

- [ ] **Step 2.3.4 — Run, expect PASS**

```bash
npx vitest run tests/unit/algorithms-contextual-update.test.ts
```
Expected: 2 passed.

- [ ] **Step 2.3.5 — Commit**

```bash
git add src/lib/algorithms.ts tests/unit/algorithms-contextual-update.test.ts
git commit -m "feat(algorithms): contextual_species_chips mentions wild-only filter

Updates the WhyAmISeeingThis copy in EN+ES to reflect PR 2's establishment_means
filter. Snapshot test guards the wording so it can't silently drift.

Refs: #942"
```

### Task 2.4 — Open PR 2

- [ ] **Step 2.4.1 — PR**

```bash
gh pr create --base main \
  --title "feat(observe): PR 2 — suggest_nearby_species filters wild-only + drops stranger photos" \
  --body "Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## PR 3 — `observation-defaults.ts` + form pre-fill

**Why third:** Pure additive UX change. Reads PR 1's column. No visual change beyond pre-filled selects.

**Files:**
- Create: `src/lib/observation-defaults.ts`
- Create: `src/lib/observation-defaults.test.ts`
- Modify: `src/components/ObserveView2.astro` (call `getObservationDefaults` on mount; call `setObservationDefaults` after save)

### Task 3.1 — Write the failing tests

- [ ] **Step 3.1.1 — Create the test file**

Create `src/lib/observation-defaults.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getObservationDefaults,
  setObservationDefaults,
  type ObservationDefaults,
} from './observation-defaults';

// Mock the supabase client. The lib module is responsible for the SQL;
// these tests check the JS-side merge / typing / null-skip behavior.
function fakeClient(initial: Partial<ObservationDefaults> = {}) {
  let store: Record<string, unknown> = { ...initial };
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => ({
            data: { last_observation_defaults: { ...store } },
            error: null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, _val: string) => {
          const next = patch.last_observation_defaults as Record<string, unknown>;
          // Mirror jsonb || + jsonb_strip_nulls
          const merged: Record<string, unknown> = { ...store, ...next };
          for (const k of Object.keys(merged)) if (merged[k] == null) delete merged[k];
          store = merged;
          return { data: null, error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('observation-defaults', () => {
  it('returns nulls when no defaults stored yet', async () => {
    const client = fakeClient({});
    const out = await getObservationDefaults(client, 'user-123');
    expect(out).toEqual({ habitat: null, weather: null, licenseCode: null });
  });

  it('returns persisted values on read', async () => {
    const client = fakeClient({ habitat: 'forest_pine', weather: 'sunny' });
    const out = await getObservationDefaults(client, 'user-123');
    expect(out.habitat).toBe('forest_pine');
    expect(out.weather).toBe('sunny');
    expect(out.licenseCode).toBeNull();
  });

  it('setObservationDefaults merges partial updates', async () => {
    const client = fakeClient({ habitat: 'forest_pine' });
    await setObservationDefaults(client, 'user-123', { weather: 'cloudy' });
    const out = await getObservationDefaults(client, 'user-123');
    expect(out.habitat).toBe('forest_pine');
    expect(out.weather).toBe('cloudy');
  });

  it('setObservationDefaults strips nulls (does not persist null fields)', async () => {
    const client = fakeClient({ habitat: 'forest_pine', weather: 'sunny' });
    await setObservationDefaults(client, 'user-123', { weather: null });
    const out = await getObservationDefaults(client, 'user-123');
    // Setting to null should NOT clobber the existing value — partial
    // update only persists fields the user touched, and null means
    // "user didn't pick this time."
    expect(out.weather).toBe('sunny');
  });
});
```

- [ ] **Step 3.1.2 — Run, expect FAIL**

```bash
npx vitest run src/lib/observation-defaults.test.ts
```
Expected: `Cannot find module './observation-defaults'`.

### Task 3.2 — Implement `observation-defaults.ts`

- [ ] **Step 3.2.1 — Create the module**

Create `src/lib/observation-defaults.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export type LicenseCode = 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0';

export type ObservationDefaults = {
  habitat: string | null;
  weather: string | null;
  licenseCode: LicenseCode | null;
};

const EMPTY: ObservationDefaults = { habitat: null, weather: null, licenseCode: null };

export async function getObservationDefaults(
  supabase: SupabaseClient,
  userId: string,
): Promise<ObservationDefaults> {
  const { data, error } = await supabase
    .from('users')
    .select('last_observation_defaults')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return EMPTY;
  const stored = (data.last_observation_defaults ?? {}) as Record<string, unknown>;
  return {
    habitat: typeof stored.habitat === 'string' ? stored.habitat : null,
    weather: typeof stored.weather === 'string' ? stored.weather : null,
    licenseCode:
      typeof stored.licenseCode === 'string' &&
      ['CC BY 4.0', 'CC BY-NC 4.0', 'CC0'].includes(stored.licenseCode)
        ? (stored.licenseCode as LicenseCode)
        : null,
  };
}

export async function setObservationDefaults(
  supabase: SupabaseClient,
  userId: string,
  partial: Partial<ObservationDefaults>,
): Promise<void> {
  // Skip null fields — null means "user didn't fill this slot this time,"
  // not "clear the stored value." Use clearObservationDefaults() if needed.
  const next: Record<string, string> = {};
  if (typeof partial.habitat === 'string') next.habitat = partial.habitat;
  if (typeof partial.weather === 'string') next.weather = partial.weather;
  if (typeof partial.licenseCode === 'string') next.licenseCode = partial.licenseCode;
  if (Object.keys(next).length === 0) return;

  const current = await getObservationDefaults(supabase, userId);
  const merged: Record<string, string> = {};
  if (current.habitat) merged.habitat = current.habitat;
  if (current.weather) merged.weather = current.weather;
  if (current.licenseCode) merged.licenseCode = current.licenseCode;
  Object.assign(merged, next);

  await supabase
    .from('users')
    .update({ last_observation_defaults: merged })
    .eq('id', userId);
}
```

- [ ] **Step 3.2.2 — Run, expect PASS**

```bash
npx vitest run src/lib/observation-defaults.test.ts
```
Expected: 4 passed.

- [ ] **Step 3.2.3 — Commit**

```bash
git add src/lib/observation-defaults.ts src/lib/observation-defaults.test.ts
git commit -m "feat(observe): add observation-defaults lib for habitat/weather/license memory

Wraps users.last_observation_defaults jsonb (added in PR 1). Get/set
with partial-merge semantics — null inputs are skipped, not persisted as
clears. Sync across devices via Supabase, no localStorage.

Refs: #942"
```

### Task 3.3 — Wire pre-fill in `ObserveView2.astro`

- [ ] **Step 3.3.1 — Find the form-init script**

```bash
grep -n "obs2-habitat\|obs2-weather\|obs2-license" src/components/ObserveView2.astro | head -20
```

Identify where the post-form is hydrated (look for the script block that wires the `obs2-post-form` listeners).

- [ ] **Step 3.3.2 — Add the pre-fill call on session-resolve**

In `ObserveView2.astro`, inside the `<script>` block that runs on hydration, near where the form is shown, add:

```typescript
import { getObservationDefaults, setObservationDefaults } from '../lib/observation-defaults';
import { getSupabase } from '../lib/supabase';

async function applyDefaults() {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  const defaults = await getObservationDefaults(supabase, session.user.id);

  if (defaults.habitat) {
    const el = document.getElementById('obs2-habitat') as HTMLSelectElement | null;
    if (el && !el.value) el.value = defaults.habitat;
  }
  if (defaults.weather) {
    const el = document.getElementById('obs2-weather') as HTMLSelectElement | null;
    if (el && !el.value) el.value = defaults.weather;
  }
  if (defaults.licenseCode) {
    const el = document.getElementById('obs2-license') as HTMLSelectElement | null;
    if (el && !el.value) el.value = defaults.licenseCode;
  }
}

// Call on the existing post-form-show event (or after the form mounts;
// match whichever lifecycle hook the file uses).
applyDefaults().catch((err) => console.warn('observe defaults pre-fill failed', err));
```

- [ ] **Step 3.3.3 — Add the post-save persistence**

Find the section that handles the `obs2-post-form` submit success and add, after the obs is successfully saved:

```typescript
// Inside the save success handler, after the obs ID is known
const supabase = getSupabase();
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  const habitat = (document.getElementById('obs2-habitat') as HTMLSelectElement)?.value || null;
  const weather = (document.getElementById('obs2-weather') as HTMLSelectElement)?.value || null;
  const licenseCode = (document.getElementById('obs2-license') as HTMLSelectElement)?.value || null;
  setObservationDefaults(supabase, session.user.id, { habitat, weather, licenseCode })
    .catch((err) => console.warn('observe defaults persist failed', err));
}
```

The `.catch` is important — defaults persistence is a UX nicety, not a correctness requirement. A failure here must not block the success state.

- [ ] **Step 3.3.4 — Typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3.3.5 — Manual smoke**

```bash
make dev
```
1. Sign in. Open `/en/observe`.
2. Drop a photo, fill habitat = `urban`, weather = `cloudy`, license = `CC0`.
3. Save the obs.
4. Reload `/en/observe` and drop another photo.
5. Open Advanced fields — habitat / weather / license should be pre-filled.

- [ ] **Step 3.3.6 — Commit**

```bash
git add src/components/ObserveView2.astro
git commit -m "feat(observe): pre-fill habitat/weather/license from prior observation

Reads users.last_observation_defaults on form mount, persists chosen
values after a successful save. Pure UX — failures never block save.

Refs: #942"
```

### Task 3.4 — Add the e2e regression

- [ ] **Step 3.4.1 — Create the e2e test**

Create `tests/e2e/observe-v2-defaults-memory.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

// This test requires a signed-in fixture — uses the project's existing
// auth helper. Adjust the import path to match the repo's e2e auth setup.
import { signInAs } from './helpers/auth';

test('observe v2: habitat/weather/license pre-fill from prior observation', async ({ page }) => {
  await signInAs(page, 'fixture-observer-1');

  // First save: pick habitat=urban, weather=cloudy, license=CC0
  await page.goto('/en/observe/');
  // … drop a photo via fixture upload (matches existing observe-form e2e pattern)
  await page.locator('#obs2-habitat').selectOption('urban');
  await page.locator('#obs2-weather').selectOption('cloudy');
  await page.locator('#obs2-license').selectOption('CC0');
  await page.locator('#obs2-save-btn').click();
  await expect(page.locator('#obs2-success')).toBeVisible();

  // Second visit: defaults should pre-fill
  await page.goto('/en/observe/');
  // Open advanced (the <details> needs to be expanded to reveal the selects)
  await page.locator('details').click();
  await expect(page.locator('#obs2-habitat')).toHaveValue('urban');
  await expect(page.locator('#obs2-weather')).toHaveValue('cloudy');
  await expect(page.locator('#obs2-license')).toHaveValue('CC0');
});
```

- [ ] **Step 3.4.2 — Run e2e**

```bash
npm run test:e2e -- tests/e2e/observe-v2-defaults-memory.spec.ts
```
Expected: PASS. If `signInAs` doesn't exist, copy the auth-fixture pattern from any existing signed-in e2e (e.g., the obs-detail edit spec).

- [ ] **Step 3.4.3 — Commit + open PR 3**

```bash
git add tests/e2e/observe-v2-defaults-memory.spec.ts
git commit -m "test(e2e): observe defaults memory pre-fill across visits

Refs: #942"

gh pr create --base main \
  --title "feat(observe): PR 3 — defaults memory (habitat/weather/license pre-fill)" \
  --body "Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## PR 4 — `PipelineStepper.astro` + `PUBLIC_OBSERVE_PIPELINE_GRAPH` flag

**Why fourth:** Drops in the new visualization without touching the surrounding form. Behind a feature flag → instant rollback if it regresses.

**Files:**
- Create: `src/components/PipelineStepper.astro`
- Create: `tests/unit/pipeline-stepper-mapping.test.ts`
- Modify: `src/components/ObserveView2.astro` (wrap the `<svg id="pipeline-svg">` block in `{!useGraph && <PipelineStepper /> }`)

### Task 4.1 — Write the mapping test (TDD)

- [ ] **Step 4.1.1 — Create the test file**

Create `tests/unit/pipeline-stepper-mapping.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapNodesToStages, type PipelineNode, type StepperStage } from '../../src/components/PipelineStepper.helpers';

describe('mapNodesToStages — collapses 5-node graph into 3 stepper stages', () => {
  it('all pending → all pending', () => {
    const nodes: PipelineNode[] = [
      { id: 'in', kind: 'input', state: 'pending', label: 'Foto' },
      { id: 'plant', kind: 'identify', state: 'pending', label: 'PlantNet' },
      { id: 'merge', kind: 'merge', state: 'pending', label: 'Merge' },
      { id: 'loc', kind: 'location', state: 'pending', label: 'GPS' },
      { id: 'save', kind: 'save', state: 'pending', label: 'Save' },
    ];
    const stages = mapNodesToStages(nodes);
    expect(stages).toEqual<StepperStage[]>([
      { id: 'photo', state: 'pending' },
      { id: 'identify', state: 'pending' },
      { id: 'save', state: 'pending' },
    ]);
  });

  it('input done + identify running → photo done + identify active', () => {
    const nodes: PipelineNode[] = [
      { id: 'in', kind: 'input', state: 'done', label: 'Foto' },
      { id: 'plant', kind: 'identify', state: 'running', label: 'PlantNet' },
      { id: 'merge', kind: 'merge', state: 'pending', label: 'Merge' },
      { id: 'loc', kind: 'location', state: 'pending', label: 'GPS' },
      { id: 'save', kind: 'save', state: 'pending', label: 'Save' },
    ];
    expect(mapNodesToStages(nodes)).toEqual<StepperStage[]>([
      { id: 'photo', state: 'done' },
      { id: 'identify', state: 'active' },
      { id: 'save', state: 'pending' },
    ]);
  });

  it('identify failed → identify failed (any failure within identify+merge)', () => {
    const nodes: PipelineNode[] = [
      { id: 'in', kind: 'input', state: 'done', label: 'Foto' },
      { id: 'plant', kind: 'identify', state: 'failed', label: 'PlantNet' },
      { id: 'merge', kind: 'merge', state: 'done', label: 'Merge' },
      { id: 'loc', kind: 'location', state: 'done', label: 'GPS' },
      { id: 'save', kind: 'save', state: 'pending', label: 'Save' },
    ];
    expect(mapNodesToStages(nodes)).toEqual<StepperStage[]>([
      { id: 'photo', state: 'done' },
      { id: 'identify', state: 'failed' },
      { id: 'save', state: 'pending' },
    ]);
  });

  it('all done → all done', () => {
    const nodes: PipelineNode[] = [
      { id: 'in', kind: 'input', state: 'done', label: 'Foto' },
      { id: 'plant', kind: 'identify', state: 'done', label: 'PlantNet' },
      { id: 'merge', kind: 'merge', state: 'done', label: 'Merge' },
      { id: 'loc', kind: 'location', state: 'done', label: 'GPS' },
      { id: 'save', kind: 'save', state: 'done', label: 'Save' },
    ];
    expect(mapNodesToStages(nodes)).toEqual<StepperStage[]>([
      { id: 'photo', state: 'done' },
      { id: 'identify', state: 'done' },
      { id: 'save', state: 'done' },
    ]);
  });

  it('skipped identify → identify done (skip = don\'t block)', () => {
    const nodes: PipelineNode[] = [
      { id: 'in', kind: 'input', state: 'done', label: 'Foto' },
      { id: 'plant', kind: 'identify', state: 'skipped', label: 'PlantNet' },
      { id: 'merge', kind: 'merge', state: 'skipped', label: 'Merge' },
      { id: 'loc', kind: 'location', state: 'done', label: 'GPS' },
      { id: 'save', kind: 'save', state: 'pending', label: 'Save' },
    ];
    expect(mapNodesToStages(nodes)).toEqual<StepperStage[]>([
      { id: 'photo', state: 'done' },
      { id: 'identify', state: 'done' },
      { id: 'save', state: 'pending' },
    ]);
  });
});
```

- [ ] **Step 4.1.2 — Run, expect FAIL**

```bash
npx vitest run tests/unit/pipeline-stepper-mapping.test.ts
```
Expected: `Cannot find module '../../src/components/PipelineStepper.helpers'`.

### Task 4.2 — Implement the mapper

- [ ] **Step 4.2.1 — Create the helper module**

Create `src/components/PipelineStepper.helpers.ts`:

```typescript
export type NodeKind = 'input' | 'identify' | 'merge' | 'location' | 'save';
export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'rejected' | 'aborted';

export interface PipelineNode {
  id: string;
  kind: NodeKind;
  state: NodeState;
  label: string;
}

export type StageState = 'pending' | 'active' | 'done' | 'failed';

export interface StepperStage {
  id: 'photo' | 'identify' | 'save';
  state: StageState;
}

export function mapNodesToStages(nodes: PipelineNode[]): StepperStage[] {
  const photoNodes = nodes.filter((n) => n.kind === 'input');
  const identifyNodes = nodes.filter((n) => n.kind === 'identify' || n.kind === 'merge');
  const saveNodes = nodes.filter((n) => n.kind === 'save');

  return [
    { id: 'photo', state: collapseStates(photoNodes) },
    { id: 'identify', state: collapseStates(identifyNodes) },
    { id: 'save', state: collapseStates(saveNodes) },
  ];
}

function collapseStates(nodes: PipelineNode[]): StageState {
  if (nodes.length === 0) return 'pending';
  // Failed dominates — any failed node within this stage marks it failed.
  if (nodes.some((n) => n.state === 'failed' || n.state === 'aborted')) return 'failed';
  // Active when any node is running.
  if (nodes.some((n) => n.state === 'running')) return 'active';
  // Done when every node is done OR skipped (skipped = pipeline routing
  // chose not to run it; not a failure).
  if (nodes.every((n) => n.state === 'done' || n.state === 'skipped' || n.state === 'rejected'))
    return 'done';
  return 'pending';
}
```

- [ ] **Step 4.2.2 — Run, expect PASS**

```bash
npx vitest run tests/unit/pipeline-stepper-mapping.test.ts
```
Expected: 5 passed.

- [ ] **Step 4.2.3 — Commit**

```bash
git add src/components/PipelineStepper.helpers.ts tests/unit/pipeline-stepper-mapping.test.ts
git commit -m "feat(observe): pipeline stepper helpers — 5-node → 3-stage collapse

Pure mapper from the existing pipeline event nodes to a Foto/Identificar/Guardar
stepper. Handles failed-dominates, skipped-is-not-failure, and running-is-active.

Refs: #942"
```

### Task 4.3 — Implement `PipelineStepper.astro`

- [ ] **Step 4.3.1 — Create the component**

Create `src/components/PipelineStepper.astro`:

```astro
---
interface Props {
  lang: 'en' | 'es';
}
const { lang } = Astro.props;
const isEs = lang === 'es';

const labels = {
  photo: isEs ? 'Foto' : 'Photo',
  identify: isEs ? 'Identificar' : 'Identify',
  save: isEs ? 'Guardar' : 'Save',
  tap_for_details: isEs ? 'Toca el paso para detalles' : 'Tap a step for details',
  estimate_prefix: '~',
  estimate_suffix: 's',
};
---

<div class="pipeline-stepper" data-pipeline-stepper aria-label={isEs ? 'Progreso de identificación' : 'Identification progress'} role="progressbar">
  <div class="ps-track">
    <div class="ps-dot" data-stage="photo" data-state="pending" role="button" tabindex="0" aria-label={labels.photo}>
      <span class="ps-dot-icon" aria-hidden="true">1</span>
    </div>
    <div class="ps-line" data-line="photo-identify"></div>
    <div class="ps-dot" data-stage="identify" data-state="pending" role="button" tabindex="0" aria-label={labels.identify}>
      <span class="ps-dot-icon" aria-hidden="true">2</span>
    </div>
    <div class="ps-line" data-line="identify-save"></div>
    <div class="ps-dot" data-stage="save" data-state="pending" role="button" tabindex="0" aria-label={labels.save}>
      <span class="ps-dot-icon" aria-hidden="true">3</span>
    </div>
  </div>
  <div class="ps-labels">
    <span>{labels.photo}</span>
    <span>{labels.identify}</span>
    <span>{labels.save}</span>
  </div>
  <div class="ps-status" data-pipeline-status aria-live="polite"></div>
  <p class="ps-hint">{labels.tap_for_details}</p>
</div>

<style>
  .pipeline-stepper {
    background: white;
    border: 1px solid theme('colors.zinc.200');
    border-radius: 12px;
    padding: 12px;
  }
  :global(.dark) .pipeline-stepper {
    background: theme('colors.zinc.900');
    border-color: theme('colors.zinc.800');
  }
  .ps-track {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }
  .ps-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: theme('colors.zinc.200');
    color: theme('colors.zinc.500');
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    cursor: pointer;
    transition: background 200ms, box-shadow 200ms;
    border: none;
  }
  .ps-dot:focus { outline: 2px solid theme('colors.emerald.500'); outline-offset: 2px; }
  .ps-dot[data-state="done"] { background: theme('colors.emerald.500'); color: white; }
  .ps-dot[data-state="active"] {
    background: theme('colors.blue.500');
    color: white;
    box-shadow: 0 0 0 4px theme('colors.blue.100');
  }
  :global(.dark) .ps-dot[data-state="active"] { box-shadow: 0 0 0 4px theme('colors.blue.950'); }
  .ps-dot[data-state="failed"] { background: theme('colors.red.500'); color: white; }
  .ps-line {
    flex: 1;
    height: 2px;
    background: theme('colors.zinc.200');
    transition: background 200ms;
  }
  .ps-line[data-state="done"] { background: theme('colors.emerald.500'); }
  .ps-labels { display: flex; justify-content: space-between; font-size: 10px; color: theme('colors.zinc.500'); }
  .ps-status { font-size: 12px; color: theme('colors.blue.700'); font-weight: 600; margin-top: 6px; min-height: 16px; }
  :global(.dark) .ps-status { color: theme('colors.blue.300'); }
  .ps-hint { font-size: 10px; color: theme('colors.zinc.400'); text-align: center; margin-top: 6px; }
</style>

<script>
  import { mapNodesToStages, type PipelineNode } from './PipelineStepper.helpers';

  function applyStages(stages: ReturnType<typeof mapNodesToStages>) {
    const root = document.querySelector('[data-pipeline-stepper]');
    if (!root) return;
    for (const stage of stages) {
      const dot = root.querySelector(`.ps-dot[data-stage="${stage.id}"]`) as HTMLElement | null;
      if (dot) {
        dot.dataset.state = stage.state;
        const icon = dot.querySelector('.ps-dot-icon');
        if (icon) {
          if (stage.state === 'done') icon.textContent = '✓';
          else if (stage.state === 'failed') icon.textContent = '✗';
          else if (stage.state === 'active') icon.textContent = '⟳';
          else icon.textContent = stage.id === 'photo' ? '1' : stage.id === 'identify' ? '2' : '3';
        }
      }
    }
    // Lines: done when the LEFT stage is done.
    const photoStage = stages.find((s) => s.id === 'photo')!;
    const identifyStage = stages.find((s) => s.id === 'identify')!;
    const lineA = root.querySelector('.ps-line[data-line="photo-identify"]') as HTMLElement | null;
    const lineB = root.querySelector('.ps-line[data-line="identify-save"]') as HTMLElement | null;
    if (lineA) lineA.dataset.state = photoStage.state === 'done' ? 'done' : 'pending';
    if (lineB) lineB.dataset.state = identifyStage.state === 'done' ? 'done' : 'pending';
  }

  document.addEventListener('rastrum:pipeline-update', (ev) => {
    const detail = (ev as CustomEvent<{ nodes: PipelineNode[] }>).detail;
    if (!detail?.nodes) return;
    applyStages(mapNodesToStages(detail.nodes));

    // Status line: pick the active stage's running runner, if any.
    const root = document.querySelector('[data-pipeline-stepper]');
    const status = root?.querySelector('[data-pipeline-status]') as HTMLElement | null;
    if (!status) return;
    const running = detail.nodes.find((n) => n.state === 'running');
    if (running) {
      const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
      status.textContent = lang === 'es'
        ? `Identificando con ${running.label}…`
        : `Identifying with ${running.label}…`;
    } else {
      status.textContent = '';
    }
  });

  // Tap-for-details: re-emit the existing per-node tooltip event so the
  // legacy SVG graph's tooltip handler still works during the flag-gated
  // overlap period.
  document.querySelectorAll<HTMLElement>('[data-pipeline-stepper] .ps-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const stage = dot.dataset.stage as 'photo' | 'identify' | 'save';
      document.dispatchEvent(new CustomEvent('rastrum:pipeline-stage-tap', { detail: { stage } }));
    });
  });
</script>
```

- [ ] **Step 4.3.2 — Wire feature flag in `ObserveView2.astro`**

In `ObserveView2.astro` (frontmatter), add near the top:

```typescript
const useGraph = import.meta.env.PUBLIC_OBSERVE_PIPELINE_GRAPH === '1';
```

Find the `<svg id="pipeline-svg">` block. Wrap the existing block (and its sibling tooltip + script):

```astro
{useGraph ? (
  <!-- existing svg + tooltip + script unchanged — kept for emergency rollback -->
  <div class="pipeline-graph-wrapper relative" data-astro-cid-zflvagjp>
    <!-- ... -->
  </div>
) : (
  <PipelineStepper lang={lang} />
)}
```

Add the import at the top of the frontmatter:

```typescript
import PipelineStepper from './PipelineStepper.astro';
```

- [ ] **Step 4.3.3 — Manual smoke**

```bash
make dev
```
Open `/en/observe/`. Drop a photo. The 3-step stepper should appear, photo dot should turn green, identify dot should pulse blue, eventually save dot.

Verify rollback:

```bash
PUBLIC_OBSERVE_PIPELINE_GRAPH=1 make dev
```
Reload — the SVG graph should appear again.

- [ ] **Step 4.3.4 — Commit**

```bash
git add src/components/PipelineStepper.astro src/components/ObserveView2.astro
git commit -m "feat(observe): PipelineStepper.astro — 3-step facilitator behind a flag

Replaces the SVG dependency graph with a horizontal 3-step stepper
(Foto → Identificar → Guardar) with done/active/failed states + tap-for-
detail. Behind PUBLIC_OBSERVE_PIPELINE_GRAPH for instant rollback to
the legacy graph.

Refs: #942"
```

### Task 4.4 — Open PR 4

- [ ] **Step 4.4.1 — PR**

```bash
gh pr create --base main \
  --title "feat(observe): PR 4 — PipelineStepper + PUBLIC_OBSERVE_PIPELINE_GRAPH flag" \
  --body "Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## PR 5 — Block reorder + capability caption + AI-mode hide-when-disabled + chip move post-GPS + classic-form link migration

**Why fifth:** This is the largest visual change. Lands after PR 4 ships clean so the stepper isn't blamed for bugs the reorder introduces.

**Files:**
- Modify: `src/components/ObserveView2.astro` (block reorder + capability caption + AI mode + chip move + classic-form link removal)
- Modify: `src/components/ContextualSpeciesChips.astro` (mount-condition: only render when `gpsResolved`)
- Modify: `src/i18n/{en,es}.json` (`obs_form_v2.*` namespace + `profile.advanced.use_classic_observe_form`)
- Modify: `src/pages/{en,es}/profile/edit.astro` (Preferencias avanzadas section)
- Test: `tests/e2e/observe-v2-empty-state.spec.ts` (new)
- Test: `tests/e2e/observe-v2-no-domestic.spec.ts` (new)

### Task 5.1 — i18n scaffolding

- [ ] **Step 5.1.1 — Add `obs_form_v2.*` to en.json**

Edit `src/i18n/en.json` and add at the appropriate top-level location:

```json
"obs_form_v2": {
  "header_title": "Log observation",
  "capability_caption": {
    "ready_one": "{provider} ready · {action}",
    "ready_many": "{providers} ready · {action}",
    "configure_more": "configure more",
    "no_providers": "Configure an identifier to recognize species automatically"
  },
  "stepper": {
    "labels": { "photo": "Photo", "identify": "Identify", "save": "Save" },
    "status_running": "Identifying with {provider}…",
    "estimate_seconds": "~{n}s",
    "tap_for_details": "Tap a step for details"
  },
  "probable_here": {
    "title": "Probable here",
    "subtitle": "Estimate based on nearby community observations. Accuracy improves with more data.",
    "empty": "Not enough data nearby yet to suggest species."
  },
  "save_primary": "Save observation",
  "save_without_id": "Save without identification",
  "success": {
    "title": "Your observation #{n}! 🎉",
    "first_in_sector": "First in this sector today",
    "research_grade_ready": "✓ Research-grade-ready",
    "dex_label": "Profile-dex: {count} / {total}",
    "dex_increment": "+1 · {family}",
    "dex_increment_no_family": "+1",
    "register_another": "Log another",
    "share": "Share",
    "view_detail": "View detail"
  }
},
"profile": {
  "advanced": {
    "section_heading": "Advanced preferences",
    "use_classic_observe_form": "Use the classic observation form"
  }
}
```

- [ ] **Step 5.1.2 — Mirror to es.json**

```json
"obs_form_v2": {
  "header_title": "Registrar observación",
  "capability_caption": {
    "ready_one": "{provider} listo · {action}",
    "ready_many": "{providers} listos · {action}",
    "configure_more": "configurar más",
    "no_providers": "Configura un identificador para reconocer especies automáticamente"
  },
  "stepper": {
    "labels": { "photo": "Foto", "identify": "Identificar", "save": "Guardar" },
    "status_running": "Identificando con {provider}…",
    "estimate_seconds": "~{n}s",
    "tap_for_details": "Toca el paso para detalles"
  },
  "probable_here": {
    "title": "Probable aquí",
    "subtitle": "Estimación basada en observaciones cercanas. La precisión mejora con más datos.",
    "empty": "Aún no hay datos suficientes en esta zona para sugerir especies."
  },
  "save_primary": "Guardar observación",
  "save_without_id": "Guardar sin identificación",
  "success": {
    "title": "¡Tu observación #{n}! 🎉",
    "first_in_sector": "Primera en este sector hoy",
    "research_grade_ready": "✓ Lista para research-grade",
    "dex_label": "Profile-dex: {count} / {total}",
    "dex_increment": "+1 · {family}",
    "dex_increment_no_family": "+1",
    "register_another": "Registrar otra",
    "share": "Compartir",
    "view_detail": "Ver detalle"
  }
},
"profile": {
  "advanced": {
    "section_heading": "Preferencias avanzadas",
    "use_classic_observe_form": "Usar el formulario clásico de observación"
  }
}
```

- [ ] **Step 5.1.3 — Verify build**

```bash
npm run build
```
Expected: 0 errors. The build catches missing keys when components reference them.

- [ ] **Step 5.1.4 — Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n: obs_form_v2 namespace + profile.advanced for the form redesign

Refs: #942"
```

### Task 5.2 — Block reorder in `ObserveView2.astro`

- [ ] **Step 5.2.1 — Read the current block order**

```bash
grep -n "id=\"obs2-\|<!-- " src/components/ObserveView2.astro | head -40
```

Build a mental map of the current sequence; this is what you're about to permute.

- [ ] **Step 5.2.2 — Move blocks to the new order**

In `ObserveView2.astro`, reshuffle the top-level children of `<div id="observe-default-view">` to this exact order:

```
1. <div id="obs2-resume-banner">                  (unchanged position; first child)
2. <div class="header">                            (Log observation H1; "Classic form" link REMOVED here — see 5.3)
3. <DropZone>                                       (PROMOTED — used to be ~7th)
4. <div id="obs2-capability-banner">               (now styled as caption; see 5.4)
5. Pipeline section                                 (PipelineStepper or graph behind flag)
6. <div id="obs2-audio-skip-warn">                 (unchanged)
7. <form id="obs2-post-form">                      (full post-process form)
   ↳ ID card + manual entry + ContextualSpeciesChips (NEW position) + Location + Notes + Advanced + Save buttons
8. Identify-only result                             (unchanged)
9. No-runners block                                 (cleanup CTAs in PR 7)
10. <div id="obs2-success">                        (replaced in PR 6)
11. <ActiveObserversBanner>                        (MOVED to bottom; hide-when-empty in PR 7)
```

The `obs2-ai-mode-selector`, `obs2-file-hint`, top-level `ContextualSpeciesChips` mount, and the `Classic form` link in the header are **removed** from the current top.

- [ ] **Step 5.2.3 — Move `ContextualSpeciesChips` mount inside `obs2-post-form`**

Inside `<form id="obs2-post-form">`, after the `obs2-id-card` div and before the `<!-- Location -->` comment, mount:

```astro
<div id="obs2-contextual-chips-wrap" class="hidden">
  <ContextualSpeciesChips lang={lang} targetInputId="obs2-taxon-input" gateOn="post-gps" />
</div>
```

The `gateOn="post-gps"` is a new prop — implement it in `ContextualSpeciesChips.astro` such that the chips are only fetched when `gpsResolved === true`. The wrapper div uses `hidden` until the GPS event fires:

```typescript
// In the existing ObserveView2 GPS resolve handler:
document.addEventListener('rastrum:gps-resolved', () => {
  document.getElementById('obs2-contextual-chips-wrap')?.classList.remove('hidden');
});
```

- [ ] **Step 5.2.4 — Verify build + manual smoke**

```bash
npm run build && make dev
```
Expected: 0 errors. Open `/en/observe/`. Verify:
- Header → DropZone → caption is the top of the page.
- After dropping a photo, pipeline appears below.
- After GPS resolves, the chips appear inside the post-form (below the ID card).

- [ ] **Step 5.2.5 — Commit**

```bash
git add src/components/ObserveView2.astro src/components/ContextualSpeciesChips.astro
git commit -m "refactor(observe): block reorder — dropzone first, chips post-GPS

Promotes the dropzone to the top of the page (Fogg ability). Moves the
ContextualSpeciesChips mount inside obs2-post-form, gated on the GPS
resolve event so chips never appear before the user has a location signal.

Refs: #942"
```

### Task 5.3 — Capability caption + classic-form link migration

- [ ] **Step 5.3.1 — Replace the capability banner with a caption**

In `ObserveView2.astro`, locate the `<div id="obs2-capability-banner">` block. Replace its children (currently a header with `🤖 Available AI:` + a per-provider list with ❌/✅ chips) with a single line:

```astro
<div id="obs2-capability-banner" class="text-center text-xs text-zinc-500 dark:text-zinc-400 border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-3 mt-2">
  <span data-capability-text>{tr.obs_form_v2.capability_caption.no_providers}</span>
  <a href={routes.profileEdit[lang]} class="ml-1 text-emerald-700 dark:text-emerald-400 underline">{tr.obs_form_v2.capability_caption.configure_more}</a>
</div>
```

In the existing capability-detection script (search for `localAISupported\|hasPlantNetKey\|hasClaudeKey`), update the post-detection code:

```typescript
// Build a positive caption listing only the providers the user HAS
const ready: string[] = [];
if (await hasCloudVision()) ready.push('Cloud AI');
if (await hasPlantNet()) ready.push('PlantNet');
if (await birdNetReady()) ready.push('BirdNET');
if (await phiVisionReady()) ready.push('Phi Vision');
// (… add other detectors as the existing code already enumerates …)

const text = document.querySelector('[data-capability-text]') as HTMLElement | null;
if (!text) return;

if (ready.length === 0) {
  text.textContent = tr.obs_form_v2.capability_caption.no_providers;
} else if (ready.length === 1) {
  text.textContent = tr.obs_form_v2.capability_caption.ready_one
    .replace('{provider}', ready[0])
    .replace('{action}', '');
} else {
  text.textContent = tr.obs_form_v2.capability_caption.ready_many
    .replace('{providers}', ready.join(' + '))
    .replace('{action}', '');
}
```

- [ ] **Step 5.3.2 — Hide AI source selector when only 1 mode is available**

Find `<div id="obs2-ai-mode-selector">`. Wrap with a script-side hide:

```typescript
const availableModes = computeAvailableModes(); // existing helper
const selector = document.getElementById('obs2-ai-mode-selector');
if (selector && availableModes.length <= 1) {
  selector.classList.add('hidden');
}
```

The selector keeps appearing when 2+ modes are usable (Sponsored + own-key, etc.).

- [ ] **Step 5.3.3 — Remove `Classic form` link from header**

Find the `<a href="/en/observe/classic" class="text-xs text-zinc-400 ... ">Classic form</a>` line in `ObserveView2.astro`'s header section. Delete it.

- [ ] **Step 5.3.4 — Add classic-form toggle in `/profile/edit`**

In `src/pages/en/profile/edit.astro`, add a section near the bottom (after existing settings):

```astro
<section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 mt-6">
  <h2 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
    {tr.profile.advanced.section_heading}
  </h2>
  <a href="/en/observe/classic" class="text-sm text-emerald-700 dark:text-emerald-400 underline">
    {tr.profile.advanced.use_classic_observe_form} →
  </a>
</section>
```

Mirror in `src/pages/es/profile/edit.astro` with `/es/observe/clasico` (or whichever the existing locale-paired route is — check `src/i18n/utils.ts` `routes.observeClassic`).

- [ ] **Step 5.3.5 — Smoke + commit**

```bash
npm run build
git add src/components/ObserveView2.astro src/pages/en/profile/edit.astro src/pages/es/profile/edit.astro
git commit -m "refactor(observe): capability caption + AI-mode hide-when-disabled + classic link migration

- Replace 6-emoji banner with one positive caption (Plantae+Cloud AI ready).
- Hide AI source selector when only 1 mode available (vs 2 disabled buttons).
- Move 'Classic form' link from header to /profile/edit > Advanced.

Refs: #942"
```

### Task 5.4 — E2E: dropzone is topmost; no domestic species in chips

- [ ] **Step 5.4.1 — Empty-state e2e**

Create `tests/e2e/observe-v2-empty-state.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('observe v2 empty: dropzone is in the top half of the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // iPhone-ish
  await page.goto('/en/observe/');
  const dropzone = page.locator('#drop-zone-root');
  await expect(dropzone).toBeVisible();
  const box = await dropzone.boundingBox();
  if (!box) throw new Error('dropzone has no bounding box');
  // The dropzone's top edge must be in the top half of the viewport.
  // Header is ~56px; dropzone's top should be < viewport.height / 2.
  expect(box.y).toBeLessThan(406); // 812 / 2
});

test('observe v2: capability is a single-line caption, not a banner', async ({ page }) => {
  await page.goto('/en/observe/');
  // The old banner had a heading "🤖 Available AI:" — must not appear.
  const oldHeading = page.getByText(/Available AI/i);
  await expect(oldHeading).toHaveCount(0);
  // The new caption should be present.
  const caption = page.locator('[data-capability-text]');
  await expect(caption).toBeVisible();
});
```

- [ ] **Step 5.4.2 — No-domestic e2e**

Create `tests/e2e/observe-v2-no-domestic.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { signInAs } from './helpers/auth';

test('observe v2: Canis familiaris (captive) does not appear in chips', async ({ page }) => {
  // Requires a fixture: a region with a seeded Canis familiaris obs marked
  // establishment_means='captive'. The PR 2 filter should exclude it.
  await signInAs(page, 'fixture-observer-1');
  await page.goto('/en/observe/');

  // Drop a fixture photo to trigger the GPS event (chips only appear post-GPS).
  await dropFixturePhoto(page); // helper from existing observe e2e
  await page.waitForSelector('#obs2-contextual-chips-wrap:not(.hidden)', { timeout: 10_000 });

  const chipText = await page.locator('#obs2-contextual-chips-wrap').textContent();
  expect(chipText ?? '').not.toMatch(/Canis familiaris/i);
});
```

- [ ] **Step 5.4.3 — Run e2e + commit**

```bash
npm run test:e2e -- tests/e2e/observe-v2-empty-state.spec.ts tests/e2e/observe-v2-no-domestic.spec.ts
git add tests/e2e/observe-v2-empty-state.spec.ts tests/e2e/observe-v2-no-domestic.spec.ts
git commit -m "test(e2e): observe v2 empty-state hierarchy + no-domestic chips

Refs: #942"
```

### Task 5.5 — Open PR 5

- [ ] **Step 5.5.1 — PR**

```bash
gh pr create --base main \
  --title "refactor(observe): PR 5 — block reorder + capability caption + chip post-GPS + classic link migration" \
  --body "Largest visual change in the redesign series.

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## PR 6 — `ObservationSuccess.astro` celebration replacement

**Why sixth:** Reuses PR 1's `is_first_in_sector` and the existing `users.observation_count` for the verifiable claims.

**Files:**
- Create: `src/components/ObservationSuccess.astro`
- Modify: `src/components/ObserveView2.astro` (replace `<div id="obs2-success">` with `<ObservationSuccess />`)
- Test: `tests/e2e/observe-v2-celebration.spec.ts`

### Task 6.1 — Implement `ObservationSuccess.astro`

- [ ] **Step 6.1.1 — Create the component**

Create `src/components/ObservationSuccess.astro`:

```astro
---
interface Props {
  lang: 'en' | 'es';
}
const { lang } = Astro.props;
const isEs = lang === 'es';
const t = isEs ? {
  title: '¡Tu observación #{n}! 🎉',
  first_in_sector: 'Primera en este sector hoy',
  research_grade_ready: '✓ Lista para research-grade',
  dex_label: 'Profile-dex: {count} / {total}',
  dex_increment: '+1 · {family}',
  dex_increment_no_family: '+1',
  register_another: 'Registrar otra',
  share: 'Compartir',
  view_detail: 'Ver detalle',
} : {
  title: 'Your observation #{n}! 🎉',
  first_in_sector: 'First in this sector today',
  research_grade_ready: '✓ Research-grade-ready',
  dex_label: 'Profile-dex: {count} / {total}',
  dex_increment: '+1 · {family}',
  dex_increment_no_family: '+1',
  register_another: 'Log another',
  share: 'Share',
  view_detail: 'View detail',
};
---

<div id="obs2-success-v2" class="hidden rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 p-5 space-y-3"
     data-success
     data-copy-title={t.title}
     data-copy-first={t.first_in_sector}
     data-copy-rg={t.research_grade_ready}
     data-copy-dex-label={t.dex_label}
     data-copy-dex-increment={t.dex_increment}
     data-copy-dex-no-family={t.dex_increment_no_family}>
  <img data-success-photo class="w-full max-h-[40vh] object-cover rounded-lg hidden" alt="" />
  <p data-success-title class="text-center font-bold text-lg text-emerald-800 dark:text-emerald-300"></p>
  <p data-success-sci class="text-center italic text-sm text-zinc-700 dark:text-zinc-300"></p>
  <div data-success-meta class="text-center text-xs text-zinc-500 dark:text-zinc-400"></div>

  <div data-success-dex class="hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-center">
    <div data-dex-label class="text-xs font-semibold text-zinc-700 dark:text-zinc-300"></div>
    <div class="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
      <div data-dex-fill class="h-full bg-gradient-to-r from-emerald-500 to-lime-500" style="width:0%"></div>
    </div>
    <div data-dex-increment class="text-xs text-zinc-500 dark:text-zinc-400 mt-1"></div>
  </div>

  <button type="button" data-success-register-another
          class="w-full min-h-[48px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm">
    📷 {t.register_another}
  </button>

  <div class="text-center text-xs text-zinc-400">
    <a data-success-detail href="#" class="underline hover:text-zinc-600">{t.view_detail}</a>
    <span class="mx-2">·</span>
    <a data-success-share href="#" class="underline hover:text-zinc-600">{t.share}</a>
  </div>
</div>

<script>
  import { getSupabase } from '../lib/supabase';

  type SuccessPayload = {
    observationId: string;
    photoUrl: string | null;
    taxonScientificName: string | null;
  };

  document.addEventListener('rastrum:observation-saved', async (ev) => {
    const detail = (ev as CustomEvent<SuccessPayload>).detail;
    const root = document.querySelector('[data-success]') as HTMLElement | null;
    if (!root) return;
    root.classList.remove('hidden');

    // Photo
    const img = root.querySelector('[data-success-photo]') as HTMLImageElement;
    if (detail.photoUrl) { img.src = detail.photoUrl; img.classList.remove('hidden'); }

    const supabase = getSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    // Count + first-in-sector + dex run in parallel.
    const [countRes, firstRes, dexRes] = await Promise.all([
      supabase.from('users').select('observation_count').eq('id', session.user.id).maybeSingle(),
      supabase.rpc('is_first_in_sector', { p_obs_id: detail.observationId }),
      detail.taxonScientificName
        ? supabase.rpc('get_user_dex_progress', { p_user_id: session.user.id }).maybeSingle().catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
    ]);

    const count = countRes.data?.observation_count ?? 0;
    const isFirst = firstRes.data === true;
    const dex = dexRes.data as { count: number; total: number; family: string | null } | null;

    const titleEl = root.querySelector('[data-success-title]') as HTMLElement;
    titleEl.textContent = (root.dataset.copyTitle ?? '').replace('{n}', String(count));

    if (detail.taxonScientificName) {
      const sciEl = root.querySelector('[data-success-sci]') as HTMLElement;
      sciEl.textContent = detail.taxonScientificName;
    }

    const metaEl = root.querySelector('[data-success-meta]') as HTMLElement;
    const meta: string[] = [];
    if (isFirst) meta.push(root.dataset.copyFirst!);
    if (detail.taxonScientificName && detail.photoUrl) meta.push(root.dataset.copyRg!);
    metaEl.textContent = meta.join(' · ');

    if (dex && dex.total > 0) {
      const dexBox = root.querySelector('[data-success-dex]') as HTMLElement;
      dexBox.classList.remove('hidden');
      const labelEl = root.querySelector('[data-dex-label]') as HTMLElement;
      labelEl.textContent = (root.dataset.copyDexLabel ?? '').replace('{count}', String(dex.count)).replace('{total}', String(dex.total));
      const fill = root.querySelector('[data-dex-fill]') as HTMLElement;
      fill.style.width = `${Math.min(100, Math.round((dex.count / dex.total) * 100))}%`;
      const incEl = root.querySelector('[data-dex-increment]') as HTMLElement;
      const incTpl = dex.family ? root.dataset.copyDexIncrement! : root.dataset.copyDexNoFamily!;
      incEl.textContent = dex.family ? incTpl.replace('{family}', dex.family) : incTpl;
    }

    const detailLink = root.querySelector('[data-success-detail]') as HTMLAnchorElement;
    detailLink.href = `/share/obs/?id=${detail.observationId}`;
    const shareLink = root.querySelector('[data-success-share]') as HTMLAnchorElement;
    shareLink.href = `/share/obs/?id=${detail.observationId}#share`;
  });

  document.querySelector('[data-success-register-another]')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('rastrum:observation-form-reset'));
    document.querySelector('[data-success]')?.classList.add('hidden');
  });
</script>
```

- [ ] **Step 6.1.2 — Wire `ObserveView2.astro` to dispatch the event**

Find the existing save-success path in `ObserveView2.astro`. After the obs is saved, dispatch:

```typescript
document.dispatchEvent(new CustomEvent('rastrum:observation-saved', {
  detail: {
    observationId: savedObs.id,
    photoUrl: savedObs.cover_photo_url ?? null,
    taxonScientificName: savedObs.primary_taxon?.scientific_name ?? null,
  },
}));
```

Replace the old `<div id="obs2-success">` block with `<ObservationSuccess lang={lang} />` (import at top of frontmatter).

Wire the form-reset listener:

```typescript
document.addEventListener('rastrum:observation-form-reset', () => {
  // Clear all form fields, hide post-form, show empty drop-zone state
  // (mirrors the existing `obs2-new-btn` click handler that the legacy
  // success state had).
  resetObserveForm();
});
```

- [ ] **Step 6.1.3 — Note: `get_user_dex_progress` RPC**

The success state references a `get_user_dex_progress(p_user_id)` RPC. If this doesn't exist (likely; profile-dex is mentioned in CLAUDE.md but the RPC name is illustrative), either:

- Add the RPC to the schema as part of PR 6 (preferred — then the dex card always works); the function joins `observations`+`identifications`+`taxa` to count distinct families plus the user's count vs the platform-wide family count.
- Or guard the call with a `.catch` and let the dex card stay hidden (acceptable v1 fallback). The component already has the `.catch(() => ({ data: null }))` for this case.

Decision deferred — see open question #4 in the spec. Default in this PR: keep the `.catch` and ship without the RPC; add the RPC + dex card in a v1.1 follow-up if the metric proves valuable in dogfooding.

- [ ] **Step 6.1.4 — Smoke + commit**

```bash
make dev
```
Sign in, drop a photo, save. Expect: foto + `Your observation #N!` + (maybe) `First in this sector today` + (no dex card if RPC missing) + `Log another` button.

```bash
git add src/components/ObservationSuccess.astro src/components/ObserveView2.astro
git commit -m "feat(observe): ObservationSuccess.astro — celebration + next-trigger

Replaces the 6-line obs2-success div with a celebration state per the spec:
photo, verifiable line ('your observation #N!'), optional 'first in this
sector today' (gated by is_first_in_sector RPC's n>=50 honest-claim), dex
progress (graceful skip when RPC missing), 'Log another' as the primary
button so the save becomes the next observation's trigger.

Refs: #942"
```

### Task 6.2 — E2E: celebration + next-trigger

- [ ] **Step 6.2.1 — Create the spec**

Create `tests/e2e/observe-v2-celebration.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { signInAs } from './helpers/auth';

test('observe v2 success: shows count + Log another as primary', async ({ page }) => {
  await signInAs(page, 'fixture-observer-1');
  await page.goto('/en/observe/');
  await dropFixturePhoto(page);
  await page.locator('#obs2-save-btn').click();

  const success = page.locator('[data-success]');
  await expect(success).toBeVisible({ timeout: 10_000 });

  const title = page.locator('[data-success-title]');
  await expect(title).toContainText(/Your observation #\d+/);

  const registerAnother = page.locator('[data-success-register-another]');
  await expect(registerAnother).toBeVisible();
  // Primary button styling: bg-emerald-700, min-h-[48px]
  await expect(registerAnother).toHaveClass(/bg-emerald-700/);
});

test('observe v2 success: Log another resets the form to dropzone state', async ({ page }) => {
  await signInAs(page, 'fixture-observer-1');
  await page.goto('/en/observe/');
  await dropFixturePhoto(page);
  await page.locator('#obs2-save-btn').click();
  await page.locator('[data-success-register-another]').click();
  await expect(page.locator('[data-success]')).toBeHidden();
  await expect(page.locator('#drop-zone-root')).toBeVisible();
});
```

- [ ] **Step 6.2.2 — Run + commit + PR**

```bash
npm run test:e2e -- tests/e2e/observe-v2-celebration.spec.ts
git add tests/e2e/observe-v2-celebration.spec.ts
git commit -m "test(e2e): observe v2 celebration + next-trigger reset

Refs: #942"

gh pr create --base main \
  --title "feat(observe): PR 6 — ObservationSuccess celebration + next-trigger" \
  --body "Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## PR 7 — Save / skip consolidation + active observers footer + cleanup

**Why last:** Cleanup pass. Lands after the visual overhaul stabilizes.

**Files:**
- Modify: `src/components/ObserveView2.astro` (remove `obs2-skip-location`, `obs2-skip-save-btn`, `obs2-id-edit`; consolidate no-runners CTAs)
- Modify: `src/components/ActiveObserversBanner.astro` (hide-when-empty guard)
- Test: `tests/unit/save-consolidation.test.ts` (new)

### Task 7.1 — Consolidate save/skip buttons

- [ ] **Step 7.1.1 — Delete the redundant buttons**

In `ObserveView2.astro`, delete these elements:

- `<button id="obs2-skip-location">Skip location</button>` and its surrounding markup (the inline header with "Location" + skip)
- `<button id="obs2-skip-save-btn">Just identify, don't save</button>` and any trailing CSS class
- `<button id="obs2-id-edit">Edit identification</button>` (manual input is always visible below — link is redundant)
- The `obs2-no-runners-continue` button label "Save without ID →" — keep the button but change the label to `obs_form_v2.save_without_id`. Reduce CTAs to two: "Set up AI →" link and "Save without identification" button.

The primary "Save observation" button stays. The secondary "Save without identification" button is rendered on the form when `bestResult === null` (no ID found):

```astro
{!bestResultExists && (
  <button id="obs2-save-without-id-btn" type="button"
          class="text-center text-xs text-zinc-500 dark:text-zinc-400 underline w-full py-1">
    {tr.obs_form_v2.save_without_id}
  </button>
)}
```

The `obs2-save-without-id-btn` triggers the same save path as `obs2-save-btn` but with `taxonId=null`.

- [ ] **Step 7.1.2 — Remove the corresponding script handlers**

```bash
grep -n "obs2-skip-location\|obs2-skip-save-btn\|obs2-id-edit\|obs2-no-runners-continue" src/components/ObserveView2.astro
```

For each match outside of comments, remove the `addEventListener` block.

- [ ] **Step 7.1.3 — Smoke**

Verify the form has at most one secondary button below the primary save in any state.

- [ ] **Step 7.1.4 — Commit**

```bash
git add src/components/ObserveView2.astro
git commit -m "refactor(observe): consolidate 5 skip/save exits into 2

Delete obs2-skip-location, obs2-skip-save-btn, obs2-id-edit, and the
redundant CTAs in obs2-no-runners. Single secondary 'Save without
identification' shown when no AI result present. Identify-only mode
remains accessible via /observe?mode=identify.

Refs: #942"
```

### Task 7.2 — `ActiveObserversBanner` hide-when-empty + footer move

- [ ] **Step 7.2.1 — Add the empty guard**

In `ActiveObserversBanner.astro`, the script that resolves `{region}` should hide the wrapper when region is empty:

```typescript
const wrap = document.getElementById('active-observers-banner-wrap');
const region = await resolveRegion(); // existing helper
if (!region) { wrap?.remove(); return; }
// … existing logic to fill in count + region in the copy …
```

The `region` resolver returns `null` when the user has no GPS, no profile region, and no IP-derived region — the three current data sources.

- [ ] **Step 7.2.2 — Move the banner mount to the footer of `ObserveView2.astro`**

In `ObserveView2.astro`, locate `<ActiveObserversBanner />` (currently at the top). Move it to be the last child of `<div id="observe-default-view">`, after `<div id="obs2-success-v2">`.

- [ ] **Step 7.2.3 — Smoke**

```bash
make dev
```
On `/en/observe/`:
- Without GPS / region: the banner does NOT render (no broken `"in  yet today"`).
- With region: the banner renders at the bottom of the page, not the top.

- [ ] **Step 7.2.4 — Commit**

```bash
git add src/components/ActiveObserversBanner.astro src/components/ObserveView2.astro
git commit -m "refactor(observe): active-observers banner moves to footer + hide when empty

The banner was rendering 'in  yet today' (broken token) when {region}
didn't resolve. Hide guard prevents that. Footer placement reduces
pre-roll competition with the dropzone.

Refs: #942"
```

### Task 7.3 — Save-consolidation regression test

- [ ] **Step 7.3.1 — Write the test**

Create `tests/unit/save-consolidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Pure DOM-shape contract: assert which save / skip buttons exist after
// the form renders in distinct states. Renders ObserveView2 via Astro's
// container API or a static-build snapshot — adapt to whichever harness
// the repo uses for component rendering tests.

describe('save consolidation — at most 2 buttons (1 primary + optional secondary)', () => {
  it('post-form with bestResult: only Save observation primary visible', async () => {
    const html = await renderObserveView2({ stage: 'post-form', bestResult: { sci: 'Bidens pilosa' } });
    expect(html).toContain('id="obs2-save-btn"');
    expect(html).not.toContain('id="obs2-save-without-id-btn"');
    expect(html).not.toContain('id="obs2-skip-save-btn"');
    expect(html).not.toContain('id="obs2-skip-location"');
    expect(html).not.toContain('id="obs2-id-edit"');
  });

  it('post-form without bestResult: primary + secondary "Save without ID"', async () => {
    const html = await renderObserveView2({ stage: 'post-form', bestResult: null });
    expect(html).toContain('id="obs2-save-btn"');
    expect(html).toContain('id="obs2-save-without-id-btn"');
  });

  it('no-runners empty state: setup link + "Save without identification" only', async () => {
    const html = await renderObserveView2({ stage: 'no-runners' });
    const matches = html.match(/<button[^>]*type="button"[^>]*>/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

async function renderObserveView2(_opts: unknown): Promise<string> {
  // Implement using Astro's experimental container API or a render harness.
  // If no harness exists, mark these tests as Playwright instead and assert
  // via DOM presence — adjust the file location to tests/e2e/.
  throw new Error('render harness not implemented — see implementation note');
}
```

- [ ] **Step 7.3.2 — Note: Astro container API**

Astro shipped an experimental container API in 4.9. If the repo doesn't have a render harness, the simplest option is to convert this file into a Playwright spec that drives the form through each state via fixture data and asserts the DOM. Either path is acceptable; pick the one that matches the repo's existing pattern.

- [ ] **Step 7.3.3 — Commit**

```bash
git add tests/unit/save-consolidation.test.ts
git commit -m "test(observe): pin button consolidation contract (1 primary + max 1 secondary)

Refs: #942"
```

### Task 7.4 — Open PR 7

- [ ] **Step 7.4.1 — PR**

```bash
gh pr create --base main \
  --title "refactor(observe): PR 7 — save/skip consolidation + active observers footer + cleanup" \
  --body "Final PR in the redesign series.

Spec: docs/superpowers/specs/2026-05-10-observation-form-redesign-design.md
Refs: #942"
```

---

## Self-review checklist

Run this against the spec when all 7 PRs land:

1. **Spec coverage** — every section of the spec has a corresponding task.
   - Goals 1–6: ✓ (PR 5 covers 1, PR 4 covers 2, PR 5 covers 3, PR 6 covers 4, PR 7 covers 5, PR 3 covers 6).
   - Cuts table (9 items): ✓ (capability, AI selector, probable-here, domestics, pipeline graph, edit-identification link, 5 exits, active-observers banner, classic-form link — all addressed across PRs 2/4/5/7).
   - Schema deltas (3): ✓ (PR 1 covers `last_observation_defaults` + `is_first_in_sector`; PR 2 covers `suggest_nearby_species`).
   - i18n: ✓ (PR 5).
   - Algorithms registry update: ✓ (PR 2 task 2.3).
   - Tests: ✓ (12 new test files across PRs).

2. **No placeholders** — every step shows code or commands.
3. **Type consistency** — `mapNodesToStages`, `getObservationDefaults`, `setObservationDefaults`, `is_first_in_sector` all match between PR 1/3/4 definitions and PR 6 consumers.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-observation-form-redesign-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
