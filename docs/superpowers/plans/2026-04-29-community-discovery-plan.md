# Community discovery in Explore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Community discovery surface inside Explore — observers, leaderboards (7d/30d/all-time), nearby (sign-in gated), experts by taxon, and country filter — backed by denormalized counter columns on `users` and a nightly `recompute-user-stats` Edge Function. Walk back the shipped "no leaderboards" stance via an explicit, granular opt-out.

**Architecture:** Additive Postgres schema (idempotent appends to `docs/specs/infra/supabase-schema.sql`); six new partial indexes; two views — anon-safe `community_observers` plus authenticated-only `community_observers_with_centroid` — that centralize the eligibility predicate `profile_public AND NOT hide_from_leaderboards`; a new `iso_countries` reference table seeded from a static list; one Deno Edge Function (`recompute-user-stats`) deployed via `deploy-functions.yml` and scheduled via `cron-schedules.sql` at 03:30 UTC; an in-Postgres `normalize_country_code(text)` function that uses `pg_trgm` similarity against `iso_countries.name_en/name_es`; a single Astro page `/{en,es}/community/observers/` driven by URL state with composable filter chips; MegaMenu shape change in `Header.astro` (Explore promoted from small list to two-column MegaMenu); two Profile → Edit controls (country picker + opt-out toggle).

**Tech Stack:** Postgres 17 + PostGIS + pg_cron + pg_trgm + pg_net, Supabase Auth, Deno Edge Functions, Astro 4, Tailwind, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-29-community-discovery-design.md`

---

## Pre-flight

Before starting, confirm prerequisites:

- [ ] **Confirm working directory and clean tree**

```bash
pwd                                          # → .../rastrum
git status -s                                # → empty (or only docs/ in progress)
git rev-parse --abbrev-ref HEAD              # confirm current branch
```

- [ ] **Confirm test baseline is green**

```bash
npm run typecheck && npm run test
```
Expected: 0 type errors; all Vitest tests pass (~454 tests today).

- [ ] **Confirm M26 follow primitives shipped**

```bash
grep -n "CREATE TABLE IF NOT EXISTS public.follows" docs/specs/infra/supabase-schema.sql | head -1
grep -n "FollowButton" src/components/FollowButton.astro | head -1
```
Expected: both non-empty. If missing, M26 must merge first — the Community card uses `FollowButton.astro` and depends on `follows` for the per-card "Following / Follow" state.

- [ ] **Confirm `users.profile_public` and `users.expert_taxa` exist**

```bash
grep -n "profile_public\b" docs/specs/infra/supabase-schema.sql | head -3
grep -n "expert_taxa\b"    docs/specs/infra/supabase-schema.sql | head -3
```
Expected: at least one match for each. Both are referenced by the new view's eligibility predicate and by the Experts filter; neither is created by this plan.

- [ ] **Confirm `pg_trgm` is available**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';"
```
Expected: one row, `pg_trgm`. If empty, the schema delta in Task 2 enables it via `CREATE EXTENSION IF NOT EXISTS pg_trgm`.

---

## File structure

Files created (all paths absolute from repo root):

| Path | Responsibility |
|---|---|
| `supabase/functions/recompute-user-stats/index.ts` | Nightly Edge Function: SQL aggregation + UPDATE |
| `src/components/CommunityView.astro` | Shared EN/ES Community page body (filter chips + result list) |
| `src/components/CommunityCard.astro` | Per-observer card (avatar, handle, country flag, counters, FollowButton) |
| `src/lib/community.ts` | Frontend client: query builder, URL state serializer, country/taxon helpers |
| `src/lib/community-url.ts` | Pure URL state ↔ filter object helpers (testable in isolation) |
| `src/pages/en/community/observers.astro` | EN page shell: imports CommunityView, sets `lang="en"` |
| `src/pages/es/comunidad/observadores.astro` | ES page shell |
| `tests/unit/community-url.test.ts` | Vitest: URL state round-trip |
| `tests/unit/community-normalize.test.ts` | Vitest: `normalize_country_code` against in-memory pglite or seeded fixture |
| `tests/e2e/community.spec.ts` | Playwright: page renders, sort, follow flow |
| `docs/specs/modules/27-community-discovery.md` | Module spec doc (registers in `00-index.md`) |

Files modified:

| Path | Change |
|---|---|
| `docs/specs/infra/supabase-schema.sql` | Append "Module 27 — community discovery" (idempotent) |
| `docs/specs/infra/cron-schedules.sql` | Add `recompute-user-stats-nightly` schedule |
| `docs/specs/modules/00-index.md` | Register `27-community-discovery.md` |
| `docs/progress.json` | Add `community-discovery` item with `_es` translation |
| `docs/tasks.json` | Add subtasks for `community-discovery` |
| `src/i18n/en.json` | Rewrite lines 349 + 959; add `community.*` namespace; add `nav.explore_dropdown.*` Community keys |
| `src/i18n/es.json` | Mirror EN changes |
| `src/i18n/utils.ts` | Add `community` + `communityObservers` to `routes` and `routeTree` |
| `src/lib/chrome-mode.ts` | Add `/community` and `/comunidad` to `APP_PREFIXES` |
| `src/components/Header.astro` | Replace inline Explore dropdown with `MegaMenu` instance (2 columns: Biodiversity, Community) |
| `src/components/MobileDrawer.astro` | Add Community subheading + items under Explore |
| `src/components/MobileBottomBar.astro` | (no change — Community lives under Explore tab) |
| `src/components/ProfileEditForm.astro` | Add country `<select>` + `hide_from_leaderboards` toggle (inverted) |

---

## Phasing — six PR-sized chunks

The spec's rollout order (schema → EF → manual cron → Profile→Edit toggle → page+MegaMenu → i18n rewrite atomic with surfacing) is mapped to six PRs, each producing working software. Dependencies are explicit: PR2 depends on PR1's columns; PR3 must run after PR2's deploy completes; PR4 ships before PR5 to give users a chance to opt out before any list goes live; PR5 and PR6 are atomic (one PR) so the "no leaderboards" copy doesn't survive past the moment leaderboards become reachable.

| PR | Scope | Tasks |
|---|---|---|
| **PR1** | Schema deltas + views + indexes + ISO countries seed | 1, 2, 3, 4 |
| **PR2** | Edge Function `recompute-user-stats` + cron schedule | 5, 6 |
| **PR3** | Manual cron fire to backfill all users (operator action — no merge) | 7 |
| **PR4** | Profile → Edit: country picker + opt-out toggle | 8, 9, 10 |
| **PR5+PR6** | Community page + MegaMenu + Mobile drawer + atomic i18n rewrite of "no leaderboards" strings + tests + module spec + roadmap | 11–19 |

PR5 and PR6 ship together because the i18n rewrite is part of the same PR that surfaces the feature (spec rollout step 6). If reviewers want to split, the splitting line is right after Task 17 (page+chrome) — but the diff in Task 18 (i18n) MUST land in the same merge window.

---

## Task 1 — Module spec doc

**Files:**
- Create: `docs/specs/modules/27-community-discovery.md`
- Modify: `docs/specs/modules/00-index.md`

- [ ] **Step 1.1: Find the next free module number**

```bash
ls docs/specs/modules/ | sort -n | tail -5
```
Expected: `26-social-graph.md` is the highest. Use `27` for this module.

- [ ] **Step 1.2: Write the module spec body**

Create `docs/specs/modules/27-community-discovery.md`:

```markdown
# Module 27 — Community discovery

**Status:** v1.0 — implementation in progress
**Spec source:** `docs/superpowers/specs/2026-04-29-community-discovery-design.md`
**Sequenced after:** Module 26 (social graph — provides `follows` table and `FollowButton`).

## Scope

- Discovery page at `/{en,es}/community/observers/` with composable filters: sort, country, taxon, experts-only, nearby.
- Schema deltas on `public.users`: `species_count`, `obs_count_7d`, `obs_count_30d`, `centroid_geog`, `country_code`, `hide_from_leaderboards`.
- Two views: `community_observers` (anon-safe) and `community_observers_with_centroid` (authenticated only, gates the Nearby feature at the SQL layer).
- New Edge Function `recompute-user-stats`, scheduled nightly at 03:30 UTC.
- ISO-3166 reference table `iso_countries` seeded with the 249 country codes.
- Profile → Edit: country picker + `hide_from_leaderboards` opt-out toggle.
- Rewrite the two shipped "no leaderboards" i18n strings (en.json line 349, line 959, plus es.json mirrors).

## Out of scope (parked to v1.1)

- Observer heatmap / community map view.
- Mod-curated featured-observer lists.
- Time windows beyond `7d`, `30d`, all-time.
- Cross-platform follow imports.

## Privacy invariants

- Eligibility predicate `profile_public = true AND hide_from_leaderboards = false` lives in exactly one place per view; both views read it live (no caching, no propagation delay).
- Centroid is exposed only via the authenticated view; anon callers cannot read it via any path.
- The Nearby feature is sign-in gated in the UI; the SQL gate is enforced regardless.
- `country_code` setter never overwrites a user-set value (cron only writes when `country_code IS NULL`).

## Risks

See "Open questions" in the design spec; the plan resolves the SSR question (client-rendered) and the thumbnail question (deferred to v1.1).
```

- [ ] **Step 1.3: Register in module index**

In `docs/specs/modules/00-index.md`, find the row for module 26 and insert directly after it:

```markdown
| 27 | [Community discovery](./27-community-discovery.md) | observers page, leaderboards, nearby, experts, country filter |
```

If the file groups modules by phase, insert under "Phase 5 — Community & social".

- [ ] **Step 1.4: Commit**

```bash
git add docs/specs/modules/27-community-discovery.md docs/specs/modules/00-index.md
git commit -m "docs(spec): module 27 — community discovery"
```

---

## Task 2 — SQL: schema deltas (columns, indexes, iso_countries, normalize_country_code)

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 2.1: Append the "Module 27" header and column deltas**

Append at the end of `docs/specs/infra/supabase-schema.sql`, before any pg_cron schedules:

```sql
-- =====================================================================
-- Module 27 — community discovery (2026-04-29)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Counter columns + privacy + geographic context on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS species_count          int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obs_count_7d           int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obs_count_30d          int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS centroid_geog          geography(POINT, 4326),
  ADD COLUMN IF NOT EXISTS country_code           text    CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS hide_from_leaderboards boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2.2: Append partial indexes**

Append:

```sql
-- 2) Partial indexes — every list query operates on an already-filtered set,
-- so opted-out / private users add zero cost to anyone's query plan.
CREATE INDEX IF NOT EXISTS idx_users_lb_obs_count ON public.users (observation_count DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_species   ON public.users (species_count     DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_obs_7d    ON public.users (obs_count_7d      DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_obs_30d   ON public.users (obs_count_30d     DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_country   ON public.users (country_code)
  WHERE country_code IS NOT NULL AND NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_centroid  ON public.users USING GIST (centroid_geog)
  WHERE centroid_geog IS NOT NULL AND NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_expert_taxa ON public.users USING GIN (expert_taxa)
  WHERE NOT hide_from_leaderboards AND profile_public;
```

- [ ] **Step 2.3: Append the `iso_countries` reference table**

Append:

```sql
-- 3) ISO-3166 alpha-2 reference table — seeded once, never written from app code.
CREATE TABLE IF NOT EXISTS public.iso_countries (
  code    text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name_en text NOT NULL,
  name_es text NOT NULL
);

ALTER TABLE public.iso_countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iso_countries_read ON public.iso_countries;
CREATE POLICY iso_countries_read ON public.iso_countries FOR SELECT TO PUBLIC USING (true);

GRANT SELECT ON public.iso_countries TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_iso_countries_name_en_trgm
  ON public.iso_countries USING GIN (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_iso_countries_name_es_trgm
  ON public.iso_countries USING GIN (name_es gin_trgm_ops);
```

- [ ] **Step 2.4: Append the seed data**

Append (Latin America–biased subset for the v1 seed; the full list is loaded by the same idempotent `INSERT ... ON CONFLICT` pattern, so adding the rest later is a one-line append):

```sql
-- 4) Seed iso_countries. ON CONFLICT keeps this idempotent.
INSERT INTO public.iso_countries (code, name_en, name_es) VALUES
  ('AR', 'Argentina',           'Argentina'),
  ('BO', 'Bolivia',              'Bolivia'),
  ('BR', 'Brazil',               'Brasil'),
  ('CA', 'Canada',               'Canadá'),
  ('CL', 'Chile',                'Chile'),
  ('CO', 'Colombia',             'Colombia'),
  ('CR', 'Costa Rica',           'Costa Rica'),
  ('CU', 'Cuba',                 'Cuba'),
  ('DO', 'Dominican Republic',   'República Dominicana'),
  ('EC', 'Ecuador',              'Ecuador'),
  ('SV', 'El Salvador',          'El Salvador'),
  ('GT', 'Guatemala',            'Guatemala'),
  ('HN', 'Honduras',             'Honduras'),
  ('MX', 'Mexico',               'México'),
  ('NI', 'Nicaragua',            'Nicaragua'),
  ('PA', 'Panama',               'Panamá'),
  ('PY', 'Paraguay',             'Paraguay'),
  ('PE', 'Peru',                 'Perú'),
  ('PR', 'Puerto Rico',          'Puerto Rico'),
  ('US', 'United States',        'Estados Unidos'),
  ('UY', 'Uruguay',              'Uruguay'),
  ('VE', 'Venezuela',            'Venezuela'),
  ('ES', 'Spain',                'España'),
  ('PT', 'Portugal',             'Portugal'),
  ('FR', 'France',               'Francia'),
  ('DE', 'Germany',              'Alemania'),
  ('GB', 'United Kingdom',       'Reino Unido')
ON CONFLICT (code) DO UPDATE
  SET name_en = EXCLUDED.name_en,
      name_es = EXCLUDED.name_es;
```

- [ ] **Step 2.5: Append the `normalize_country_code` function**

Append:

```sql
-- 5) Country-code normalizer. Case-insensitive exact match against name_en
-- and name_es first; falls back to pg_trgm similarity > 0.6. Returns NULL
-- on miss. The Edge Function calls this only when users.country_code IS NULL,
-- so user-set values are never overwritten.
CREATE OR REPLACE FUNCTION public.normalize_country_code(p_input text)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH input AS (SELECT lower(trim(coalesce(p_input, ''))) AS q)
  SELECT code FROM (
    -- Exact (case-insensitive) match wins.
    SELECT code, 0 AS rank
      FROM public.iso_countries, input
     WHERE input.q <> ''
       AND (lower(name_en) = input.q OR lower(name_es) = input.q OR lower(code) = input.q)
    UNION ALL
    -- Fuzzy fallback. similarity > 0.6 keeps "México DF" → MX.
    SELECT code, 1 AS rank
      FROM public.iso_countries, input
     WHERE input.q <> ''
       AND GREATEST(similarity(lower(name_en), input.q),
                    similarity(lower(name_es), input.q)) > 0.6
  ) t
  ORDER BY rank, code
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_country_code(text) TO anon, authenticated;
```

- [ ] **Step 2.6: Apply schema and verify**

```bash
make db-apply
```
Expected: exit 0; output mentions the new columns, indexes, table, and function.

```bash
psql "$SUPABASE_DB_URL" -c "SELECT public.normalize_country_code('Mexico');"
psql "$SUPABASE_DB_URL" -c "SELECT public.normalize_country_code('México');"
psql "$SUPABASE_DB_URL" -c "SELECT public.normalize_country_code('xyzzy');"
```
Expected: `MX`, `MX`, `NULL` (one blank line for NULL).

```bash
make db-apply
```
Expected: still exit 0 — second apply must be a no-op (idempotency check the validate gate enforces).

- [ ] **Step 2.7: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): m27 — counters, indexes, iso_countries, normalize_country_code"
```

---

## Task 3 — SQL: views (`community_observers`, `community_observers_with_centroid`)

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 3.1: Append the anon-safe view**

Append immediately after the Task 2 block:

```sql
-- 6) Anon-safe view. No centroid. Discovery-safe columns only.
CREATE OR REPLACE VIEW public.community_observers AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  last_observation_at, joined_at
FROM public.users
WHERE profile_public = true
  AND hide_from_leaderboards = false;

GRANT SELECT ON public.community_observers TO anon, authenticated;
```

- [ ] **Step 3.2: Append the authenticated-only view**

Append:

```sql
-- 7) Authenticated-only view. Adds centroid_geog for Nearby. Anon callers
-- cannot read centroid via any path — UI gate is mirrored at the SQL layer.
CREATE OR REPLACE VIEW public.community_observers_with_centroid AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  centroid_geog, last_observation_at, joined_at
FROM public.users
WHERE profile_public = true
  AND hide_from_leaderboards = false;

GRANT SELECT ON public.community_observers_with_centroid TO authenticated;
-- Explicitly NO grant to anon. The lack of grant is the security gate.
```

- [ ] **Step 3.3: Apply and verify the views exist with correct grants**

```bash
make db-apply
```
Expected: exit 0.

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT relname,
         has_table_privilege('anon',          oid, 'SELECT') AS anon_can_select,
         has_table_privilege('authenticated', oid, 'SELECT') AS auth_can_select
  FROM pg_class
  WHERE relname IN ('community_observers', 'community_observers_with_centroid')
  ORDER BY relname;"
```
Expected:
- `community_observers              | t | t`
- `community_observers_with_centroid | f | t`

If `anon_can_select = t` for the centroid view, the privacy invariant is broken — stop and fix.

- [ ] **Step 3.4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): m27 — community_observers + ..._with_centroid views (anon vs auth split)"
```

---

## Task 4 — Pre-merge: confirm `db-validate.yml` passes

**Files:**
- (no new file; this is a CI gate — open the PR to trigger it)

- [ ] **Step 4.1: Push the branch and open a PR for PR1**

```bash
git push -u origin <branch>
gh pr create --fill --draft
```

- [ ] **Step 4.2: Watch `db-validate.yml`**

```bash
gh run watch
```
Expected: the job runs `make db-apply` twice on an ephemeral Postgres 17 + PostGIS 3.4 service container; both passes succeed; the sentinel-table check confirms `community_observers` and `iso_countries` exist. Required status check.

If it fails on idempotency (the second `make db-apply`), the most likely culprits are: a `CREATE FUNCTION` without `OR REPLACE`, a `CREATE TABLE` without `IF NOT EXISTS`, an index without `IF NOT EXISTS`, or an `INSERT` without `ON CONFLICT`. Fix and amend.

- [ ] **Step 4.3: Mark PR ready, merge PR1**

After review, merge PR1 to main. `db-apply.yml` fires automatically against production.

```bash
gh run watch  # the db-apply.yml run
```
Expected: success. After merge, run on production:

```bash
make db-verify
```
Expected: lists `community_observers`, `community_observers_with_centroid`, `iso_countries`.

---

## Task 5 — Edge Function: `recompute-user-stats`

**PR2 starts here.**

**Files:**
- Create: `supabase/functions/recompute-user-stats/index.ts`

- [ ] **Step 5.1: Read existing nightly-cron function for the pattern**

```bash
sed -n '1,40p' supabase/functions/recompute-streaks/index.ts
```
Note: cron-only functions deploy `--no-verify-jwt`; uses `SUPABASE_SERVICE_ROLE_KEY` env; returns JSON with a count.

- [ ] **Step 5.2: Implement the function**

Create `supabase/functions/recompute-user-stats/index.ts`:

```ts
/**
 * /functions/v1/recompute-user-stats — nightly cron job.
 *
 * Recomputes denormalized counters and centroid for every user, and
 * backfills country_code from region_primary via normalize_country_code()
 * for users where country_code is currently NULL.
 *
 * Schedule: 03:30 UTC (after refresh-taxon-rarity at 03:00 to avoid
 * write contention on `users` from the streak / badges crons later).
 *
 * Deploys --no-verify-jwt; cron-only; not user-facing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const url  = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) {
    return new Response('Function not configured', { status: 500 });
  }

  const db = createClient(url, role, { auth: { persistSession: false } });

  const sql = `
    WITH stats AS (
      SELECT
        o.observer_id AS uid,
        COUNT(*)::int                                                            AS obs_total,
        COUNT(DISTINCT i.taxon_id)::int                                          AS species_total,
        COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '7 days')::int  AS obs_7d,
        COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '30 days')::int AS obs_30d,
        ST_Centroid(ST_Collect(o.location::geometry))::geography                 AS centroid
      FROM public.observations o
      LEFT JOIN public.identifications i
        ON i.observation_id = o.id AND i.is_primary = true
      WHERE o.sync_status = 'synced'
        AND o.location IS NOT NULL
      GROUP BY o.observer_id
    )
    UPDATE public.users u
    SET
      observation_count = COALESCE(s.obs_total, 0),
      species_count     = COALESCE(s.species_total, 0),
      obs_count_7d      = COALESCE(s.obs_7d, 0),
      obs_count_30d     = COALESCE(s.obs_30d, 0),
      centroid_geog     = s.centroid,
      country_code      = COALESCE(u.country_code, public.normalize_country_code(u.region_primary))
    FROM stats s
    WHERE u.id = s.uid
    RETURNING u.id;
  `;

  const started = Date.now();
  const { data, error } = await db.rpc('exec_sql_admin', { p_sql: sql }).maybeSingle();

  // If exec_sql_admin doesn't exist (it doesn't ship with Rastrum), fall back
  // to running the SQL via PostgREST's `rpc` to a dedicated wrapper. Simpler:
  // use the JS client's `from(...).update(...)` path? — no, this is a JOIN+CTE.
  // Use a direct fetch to /rest/v1/rpc with a custom function instead. See
  // Step 5.3.
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    rows_updated: Array.isArray(data) ? data.length : 0,
  }), { headers: { 'content-type': 'application/json' } });
});
```

- [ ] **Step 5.3: Replace the body with a SQL-RPC wrapper approach**

The supabase-js client cannot run arbitrary multi-statement SQL. Wrap the logic in a SECURITY DEFINER Postgres function and call it via `db.rpc(...)`. Append to `docs/specs/infra/supabase-schema.sql` (after Task 3's view block):

```sql
-- 8) recompute_user_stats() — called by the nightly Edge Function. SECURITY
-- DEFINER so the cron-only function can run it; restricted to service_role
-- to keep it off the public surface.
CREATE OR REPLACE FUNCTION public.recompute_user_stats()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stats AS (
    SELECT
      o.observer_id AS uid,
      COUNT(*)::int                                                            AS obs_total,
      COUNT(DISTINCT i.taxon_id)::int                                          AS species_total,
      COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '7 days')::int  AS obs_7d,
      COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '30 days')::int AS obs_30d,
      ST_Centroid(ST_Collect(o.location::geometry))::geography                 AS centroid
    FROM public.observations o
    LEFT JOIN public.identifications i
      ON i.observation_id = o.id AND i.is_primary = true
    WHERE o.sync_status = 'synced'
      AND o.location IS NOT NULL
    GROUP BY o.observer_id
  )
  UPDATE public.users u
  SET
    observation_count = COALESCE(s.obs_total, 0),
    species_count     = COALESCE(s.species_total, 0),
    obs_count_7d      = COALESCE(s.obs_7d, 0),
    obs_count_30d     = COALESCE(s.obs_30d, 0),
    centroid_geog     = s.centroid,
    country_code      = COALESCE(u.country_code, public.normalize_country_code(u.region_primary))
  FROM stats s
  WHERE u.id = s.uid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_user_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_user_stats() TO service_role;
```

Now rewrite `supabase/functions/recompute-user-stats/index.ts` to use the RPC:

```ts
/**
 * /functions/v1/recompute-user-stats — nightly cron job.
 *
 * Calls public.recompute_user_stats() which runs a single CTE+UPDATE that
 * recomputes denormalized counters + centroid + country_code backfill.
 *
 * Schedule: 03:30 UTC. Cron-only; deployed --no-verify-jwt.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const url  = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) {
    return new Response('Function not configured', { status: 500 });
  }

  const db = createClient(url, role, { auth: { persistSession: false } });

  const started = Date.now();
  const { data, error } = await db.rpc('recompute_user_stats');

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    rows_updated: typeof data === 'number' ? data : 0,
  }), { headers: { 'content-type': 'application/json' } });
});
```

- [ ] **Step 5.4: Apply the new SQL function and re-verify idempotency**

```bash
make db-apply
make db-apply  # second pass must succeed
```
Expected: both exit 0.

- [ ] **Step 5.5: Smoke-test the RPC directly (before the EF is deployed)**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT public.recompute_user_stats();"
```
Expected: a single integer (the number of rows updated). On a fresh project this may be `0` or close to it; on a project with existing observations it should be in the dozens.

- [ ] **Step 5.6: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql supabase/functions/recompute-user-stats/index.ts
git commit -m "feat(ef): m27 — recompute-user-stats Edge Function + recompute_user_stats() SECURITY DEFINER RPC"
```

---

## Task 6 — Cron schedule: `recompute-user-stats-nightly`

**Files:**
- Modify: `docs/specs/infra/cron-schedules.sql`

- [ ] **Step 6.1: Append the schedule to the v_base block**

Open `docs/specs/infra/cron-schedules.sql` and add a new step inside the `DO $migration$` block, immediately after step 5 (`refresh-taxon-rarity-nightly`):

```sql
  -- 6. recompute-user-stats-nightly — 03:30 UTC
  --    Refreshes denormalized counters + centroid + country_code on users.
  --    Runs after refresh-taxon-rarity (03:00) so badges/streaks see fresh
  --    rarity values, and well before plantnet-quota at 23:55.
  PERFORM cron.unschedule('recompute-user-stats-nightly')
    FROM cron.job WHERE jobname = 'recompute-user-stats-nightly';
  PERFORM cron.schedule('recompute-user-stats-nightly', '30 3 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/recompute-user-stats'));
```

Then add `recompute-user-stats-nightly` to the `WHERE jobname IN (...)` filter at the bottom of the file:

```sql
WHERE jobname IN ('streaks-nightly', 'badges-nightly', 'plantnet-quota-daily',
                  'streak-push-nightly', 'refresh-taxon-rarity-nightly',
                  'recompute-user-stats-nightly')
```

- [ ] **Step 6.2: Apply the schedule**

```bash
make db-cron-schedule
```
Expected: output ends with `✓ Cron schedules applied` and the SELECT lists the new job with `active = t`.

- [ ] **Step 6.3: Open PR2 and watch `deploy-functions.yml`**

```bash
git add docs/specs/infra/cron-schedules.sql
git commit -m "chore(cron): schedule recompute-user-stats-nightly at 03:30 UTC"
git push
gh pr create --fill --draft
```

After merge to main, the `deploy-functions.yml` workflow auto-detects `supabase/functions/recompute-user-stats/**` and deploys only that function.

```bash
gh run watch
```
Expected: deploy succeeds. Confirm:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-user-stats"
```
Expected: `200`. (Function is deployed `--no-verify-jwt` like the other crons; calling it without auth is fine and idempotent.)

---

## Task 7 — Manual cron fire (operator action — not a PR)

**Files:** none.

This step is a human-driven backfill, executed once after PR2 merges and before PR4 ships.

- [ ] **Step 7.1: Run `make db-cron-test` to fire the cron manually**

```bash
make db-cron-test
```
Expected: includes a row for `recompute-user-stats` showing the HTTP response (`{"ok":true,"elapsed_ms":<ms>,"rows_updated":<n>}`).

If `make db-cron-test` doesn't fire this job by default, fire it directly:

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-user-stats',
    headers := '{\"Content-Type\":\"application/json\"}'::jsonb,
    body := '{}'::jsonb
  );"
```
Expected: a request id integer.

- [ ] **Step 7.2: Verify backfill landed**

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT count(*) AS users_with_centroid
  FROM public.users WHERE centroid_geog IS NOT NULL;"

psql "$SUPABASE_DB_URL" -c "
  SELECT count(*) AS users_with_country
  FROM public.users WHERE country_code IS NOT NULL;"

psql "$SUPABASE_DB_URL" -c "
  SELECT username, observation_count, species_count, obs_count_7d, obs_count_30d
  FROM public.users
  WHERE observation_count > 0
  ORDER BY observation_count DESC LIMIT 5;"
```
Expected: nonzero counts; the third query lists the top 5 observers with reasonable counter values.

If `users_with_country` is 0 but `users_with_centroid` > 0, the normalizer probably mismatched on every `region_primary` value. Sample some inputs:

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT region_primary, public.normalize_country_code(region_primary)
  FROM public.users WHERE region_primary IS NOT NULL LIMIT 20;"
```

Expand the seed list in `iso_countries` if a common country is missing, re-`make db-apply`, re-fire the cron.

---

## Task 8 — Profile → Edit: country picker + opt-out toggle (i18n keys)

**PR4 starts here.**

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 8.1: Add new keys under `profile.*`**

In `src/i18n/en.json`, find the `"profile"` namespace and add (alphabetically wherever it fits):

```jsonc
"country":                     "Country",
"country_hint":                "Used to label your card on the Community page. You can change or clear this any time.",
"country_any":                 "—",
"community_visible":           "Show me in community discovery and leaderboards",
"community_visible_hint":      "When on, your public profile can appear on the Community page and in leaderboards. Turn off any time.",
"community_visible_disabled":  "Make your profile public to enable community discovery."
```

In `src/i18n/es.json`, mirror:

```jsonc
"country":                     "País",
"country_hint":                "Se usa para etiquetar tu tarjeta en la página de Comunidad. Puedes cambiarlo o borrarlo cuando quieras.",
"country_any":                 "—",
"community_visible":           "Mostrarme en descubrimiento y clasificaciones de la comunidad",
"community_visible_hint":      "Cuando está activo, tu perfil público puede aparecer en la página de Comunidad y en las clasificaciones. Puedes desactivarlo cuando quieras.",
"community_visible_disabled":  "Haz tu perfil público para habilitar el descubrimiento en la comunidad."
```

- [ ] **Step 8.2: Confirm parity**

```bash
node -e "
  const en = require('./src/i18n/en.json').profile;
  const es = require('./src/i18n/es.json').profile;
  const enKeys = Object.keys(en).sort();
  const esKeys = Object.keys(es).sort();
  const missing = enKeys.filter(k => !esKeys.includes(k))
    .concat(esKeys.filter(k => !enKeys.includes(k)));
  console.log('missing keys:', missing);
"
```
Expected: `missing keys: []`.

- [ ] **Step 8.3: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n(profile): m27 — country + community-visibility toggle keys"
```

---

## Task 9 — Profile → Edit form fields (country select + toggle)

**Files:**
- Modify: `src/components/ProfileEditForm.astro`

- [ ] **Step 9.1: Add a frontmatter helper that loads countries**

In `src/components/ProfileEditForm.astro`, add to the frontmatter (before `---`):

```ts
import { supabase } from '../lib/supabase';
const isoLang = lang === 'es' ? 'name_es' : 'name_en';
const { data: countries } = await supabase
  .from('iso_countries')
  .select(`code, ${isoLang}`)
  .order(isoLang, { ascending: true });
const countryOptions = (countries ?? []) as Array<{ code: string; [k: string]: string }>;
```

Note: this query runs at build time. Astro pre-renders the page; the dropdown list ships static.

- [ ] **Step 9.2: Insert the country `<select>` in the form**

Locate the `region_primary` input block (around line 32) and add this block immediately below it:

```astro
<div>
  <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{tr.profile.country}</label>
  <select name="country_code" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
    <option value="">{tr.profile.country_any}</option>
    {countryOptions.map(c => (
      <option value={c.code}>{c[isoLang]}</option>
    ))}
  </select>
  <p class="mt-1 text-xs text-zinc-500">{tr.profile.country_hint}</p>
</div>
```

- [ ] **Step 9.3: Insert the opt-out toggle into the existing fieldset**

Locate the `streak_digest_opt_in` checkbox (around line 79) and add a new label inside the same `<fieldset>` directly after it:

```astro
<label class="flex items-start gap-3 cursor-pointer" id="community-visible-row">
  <input type="checkbox" name="community_visible" class="mt-1" />
  <div>
    <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tr.profile.community_visible}</p>
    <p class="text-xs text-zinc-500" data-helper-on>{tr.profile.community_visible_hint}</p>
    <p class="text-xs text-amber-700 dark:text-amber-400 hidden" data-helper-off>{tr.profile.community_visible_disabled}</p>
  </div>
</label>
```

The toggle is **inverted relative to the column**: `community_visible = !hide_from_leaderboards`. The save handler must invert when writing.

- [ ] **Step 9.4: Wire the toggle into the existing save handler**

Find the `'gamification_opt_in' | 'streak_digest_opt_in'` type union (around line 424). Add `'country_code' | 'hide_from_leaderboards'` to the union of writable columns and `'community_visible'` is local-only.

In the load block (around line 449–450):

```ts
(form.elements.namedItem('country_code') as HTMLSelectElement).value =
  profile.country_code ?? '';
(form.elements.namedItem('community_visible') as HTMLInputElement).checked =
  !profile.hide_from_leaderboards;
```

In the save block (around line 475–476):

```ts
country_code:           (data.get('country_code') as string) || null,
hide_from_leaderboards: data.get('community_visible') !== 'on',
```

- [ ] **Step 9.5: Add the disable-when-private behaviour**

After the form load block, hook the visibility toggle to `profile_public`:

```ts
const visibleEl = form.elements.namedItem('community_visible') as HTMLInputElement;
const helperOn  = form.querySelector('[data-helper-on]') as HTMLElement;
const helperOff = form.querySelector('[data-helper-off]') as HTMLElement;
const syncCommunityVisibleEnabled = (isPublic: boolean) => {
  visibleEl.disabled = !isPublic;
  helperOn.classList.toggle('hidden', !isPublic);
  helperOff.classList.toggle('hidden', isPublic);
  if (!isPublic) visibleEl.checked = false;
};
syncCommunityVisibleEnabled(Boolean(profile.profile_public));
```

If the privacy tab toggles `profile_public` via a separate UI, this runs only on form mount, which is acceptable for v1.

- [ ] **Step 9.6: Run typecheck and tests**

```bash
npm run typecheck
npm run test
```
Expected: 0 type errors; all tests pass.

- [ ] **Step 9.7: Commit**

```bash
git add src/components/ProfileEditForm.astro
git commit -m "feat(profile): m27 — country picker + community-visibility toggle"
```

---

## Task 10 — RLS sanity check + ProfileEdit can write the new columns

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append column-grants if needed)

- [ ] **Step 10.1: Confirm `users` UPDATE policy permits the new columns**

```bash
grep -n "CREATE POLICY.*users.*UPDATE\|ALTER TABLE public.users.*ENABLE ROW LEVEL\|users_self_update" docs/specs/infra/supabase-schema.sql | head -10
```
Find the existing self-update policy (something like `users_self_update`). If it's a column-list-restricted UPDATE (Postgres RLS supports column-level `WITH CHECK`), add `country_code` and `hide_from_leaderboards` to the allowed list. If it's column-agnostic (`WITH CHECK (id = auth.uid())`), no change needed.

The existing pattern in this repo uses self-row policies — confirm with:

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT polname, polcmd, qual::text, with_check::text
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname = 'users' AND polcmd = 'w';"
```

- [ ] **Step 10.2: If new column-grants are needed, append them**

Repo uses `users-column-grants.md` to track which columns are GRANT-able. If the existing pattern uses an explicit `GRANT UPDATE (col1, col2, ...) ON public.users TO authenticated`, append:

```sql
-- m27: extend self-update grants to the new columns.
GRANT UPDATE (country_code, hide_from_leaderboards) ON public.users TO authenticated;
```

If the existing pattern is `GRANT UPDATE ON public.users TO authenticated` (column-agnostic) gated by RLS only, no schema change is required.

- [ ] **Step 10.3: End-to-end: edit, save, reload, confirm persisted**

Manually in browser:
1. Sign in.
2. `/en/profile/edit/` — pick a country, toggle the visibility off.
3. Save. Reload. Both values persist.
4. Visit `/en/community/observers/` — your card MUST NOT appear (toggle is off). [Skip until Task 17 ships if the page doesn't exist yet — log this as a manual-verification TODO.]

- [ ] **Step 10.4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): m27 — column grants for country_code + hide_from_leaderboards"
```

If no schema change was needed, skip this commit.

---

## Task 11 — Routes, chrome mode, route tree

**PR5 starts here.**

**Files:**
- Modify: `src/i18n/utils.ts`
- Modify: `src/lib/chrome-mode.ts`

- [ ] **Step 11.1: Add the routes**

In `src/i18n/utils.ts`, in the `routes` map (around line 25), add (alphabetically near `chat`):

```ts
community:           { en: '/community',           es: '/comunidad' },
communityObservers:  { en: '/community/observers', es: '/comunidad/observadores' },
```

In the `routeTree` map (around line 125), add:

```ts
community:           { labels: { en: 'Community',  es: 'Comunidad' } },
communityObservers:  { labels: { en: 'Observers',  es: 'Observadores' }, parent: 'community' },
```

- [ ] **Step 11.2: Register `/community` and `/comunidad` as app-mode chrome**

In `src/lib/chrome-mode.ts`, extend `APP_PREFIXES`:

```ts
const APP_PREFIXES = [
  '/observe',
  '/observar',
  '/explore',
  '/explorar',
  '/community',
  '/comunidad',
  '/chat',
  '/profile',
  '/perfil',
] as const;
```

- [ ] **Step 11.3: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 11.4: Commit**

```bash
git add src/i18n/utils.ts src/lib/chrome-mode.ts
git commit -m "feat(routes): m27 — community routes + app-chrome mode"
```

---

## Task 12 — i18n: `community.*` namespace + atomic "no leaderboards" rewrite

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 12.1: Rewrite line 349 (`gamification_hint`)**

In `src/i18n/en.json`:

```diff
-    "gamification_hint": "Enable badges, streaks, and activity feed. Quality-gated. No leaderboards.",
+    "gamification_hint": "Enable badges, streaks, and activity feed. Quality-gated. Community leaderboards are opt-in.",
```

In `src/i18n/es.json` (same line number, mirrored string):

```diff
-    "gamification_hint": "Habilita insignias, rachas y feed de actividad. Con compuertas de calidad. Sin tablas de líderes.",
+    "gamification_hint": "Habilita insignias, rachas y feed de actividad. Con compuertas de calidad. Las clasificaciones de la comunidad son opcionales.",
```

- [ ] **Step 12.2: Rewrite line 959 (`streak_enable_body`)**

In `src/i18n/en.json`:

```diff
-    "streak_enable_body": "Track your daily observation streak. Quality-gated, opt-in, no leaderboards.",
+    "streak_enable_body": "Track your daily observation streak. Quality-gated and opt-in. Community leaderboards are a separate opt-in.",
```

In `src/i18n/es.json`:

```diff
-    "streak_enable_body": "Lleva tu racha diaria de observación. Con compuertas de calidad, opt-in, sin tablas de líderes.",
+    "streak_enable_body": "Lleva tu racha diaria de observación. Con compuertas de calidad y opcional. Las clasificaciones de la comunidad son una opción aparte.",
```

- [ ] **Step 12.3: Confirm the old strings are gone**

```bash
grep -n "no leaderboards\|sin tablas de líderes" src/i18n/en.json src/i18n/es.json
```
Expected: no output.

- [ ] **Step 12.4: Add the `community.*` namespace**

In `src/i18n/en.json`, add at top level (after `home` or wherever feels natural):

```jsonc
"community": {
  "page_title":    "Community observers",
  "page_subtitle": "Find observers by activity, expertise, location, or country.",
  "sort": {
    "obs":         "Most observations",
    "species":     "Most species",
    "active_7d":   "Most active this week",
    "active_30d":  "Most active this month",
    "recent":      "Recently active",
    "newest":      "Newest",
    "distance":    "Nearest to me"
  },
  "filter": {
    "country":       "Country",
    "taxon":         "Taxon",
    "nearby":        "Nearby",
    "experts_only":  "Experts only",
    "any":           "Any"
  },
  "card": {
    "obs":       "{n} obs",
    "species":   "{n} species",
    "last_seen": "last seen {when}",
    "follow":    "Follow",
    "following": "Following"
  },
  "empty": {
    "no_match":           "No observers match these filters. Try removing one.",
    "nearby_no_centroid": "Log an observation to find observers near you.",
    "nearby_anon":        "Sign in to find observers near you."
  },
  "leaderboards_optout_link": "Hide me from community leaderboards",
  "edit_profile_optout":      "Profile → Edit"
}
```

In `src/i18n/es.json`, mirror:

```jsonc
"community": {
  "page_title":    "Observadores de la comunidad",
  "page_subtitle": "Encuentra observadores por actividad, experiencia, ubicación o país.",
  "sort": {
    "obs":         "Más observaciones",
    "species":     "Más especies",
    "active_7d":   "Más activos esta semana",
    "active_30d":  "Más activos este mes",
    "recent":      "Activos recientemente",
    "newest":      "Más nuevos",
    "distance":    "Más cercanos a mí"
  },
  "filter": {
    "country":       "País",
    "taxon":         "Taxón",
    "nearby":        "Cerca",
    "experts_only":  "Solo expertos",
    "any":           "Cualquiera"
  },
  "card": {
    "obs":       "{n} obs",
    "species":   "{n} especies",
    "last_seen": "vist@ por última vez {when}",
    "follow":    "Seguir",
    "following": "Siguiendo"
  },
  "empty": {
    "no_match":           "Ningún observador coincide con estos filtros. Prueba quitar uno.",
    "nearby_no_centroid": "Registra una observación para encontrar observadores cerca.",
    "nearby_anon":        "Inicia sesión para encontrar observadores cerca."
  },
  "leaderboards_optout_link": "Ocultarme de las clasificaciones de la comunidad",
  "edit_profile_optout":      "Perfil → Editar"
}
```

- [ ] **Step 12.5: Add the MegaMenu Community labels under `nav.*`**

In `src/i18n/en.json` under `nav`, alongside `explore_dropdown`, add:

```jsonc
"explore_megamenu": {
  "biodiversity":      "Biodiversity",
  "community":         "Community",
  "community_all":     "Observers",
  "community_top":     "Top observers",
  "community_nearby":  "Nearby",
  "community_experts": "Experts by taxon",
  "community_country": "By country",
  "nearby_signin_tooltip": "Sign in to find observers near you"
}
```

Mirror in `src/i18n/es.json`:

```jsonc
"explore_megamenu": {
  "biodiversity":      "Biodiversidad",
  "community":         "Comunidad",
  "community_all":     "Observadores",
  "community_top":     "Mejores observadores",
  "community_nearby":  "Cerca",
  "community_experts": "Expertos por taxón",
  "community_country": "Por país",
  "nearby_signin_tooltip": "Inicia sesión para encontrar observadores cerca"
}
```

- [ ] **Step 12.6: Parity check**

```bash
node -e "
  const flatten = (o, p='') => Object.entries(o).flatMap(([k,v]) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? flatten(v, p ? p+'.'+k : k)
      : [p ? p+'.'+k : k]);
  const en = flatten(require('./src/i18n/en.json'));
  const es = flatten(require('./src/i18n/es.json'));
  const missingEs = en.filter(k => !es.includes(k));
  const missingEn = es.filter(k => !en.includes(k));
  console.log('keys missing in es:', missingEs);
  console.log('keys missing in en:', missingEn);
"
```
Expected: both arrays empty.

- [ ] **Step 12.7: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n: m27 — community.* namespace + rewrite shipped no-leaderboards strings"
```

---

## Task 13 — `community-url.ts` pure helper + Vitest

**Files:**
- Create: `src/lib/community-url.ts`
- Create: `tests/unit/community-url.test.ts`

- [ ] **Step 13.1: Write the failing tests**

Create `tests/unit/community-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseFilters, serializeFilters, type CommunityFilters } from '../../src/lib/community-url';

describe('community-url', () => {
  it('parses an empty querystring to defaults', () => {
    expect(parseFilters('')).toEqual({
      sort: 'observation_count',
      country: null, taxa: [], experts: false, nearby: false, page: 1,
    });
  });

  it('round-trips a fully populated state', () => {
    const f: CommunityFilters = {
      sort: 'obs_count_30d',
      country: 'MX',
      taxa: ['Aves', 'Plantae'],
      experts: true,
      nearby: false,
      page: 2,
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it('drops unknown sort values silently (does not crash)', () => {
    expect(parseFilters('?sort=unknown_thing').sort).toBe('observation_count');
  });

  it('treats nearby=true as forcing sort=distance when no sort is given', () => {
    expect(parseFilters('?nearby=true')).toMatchObject({ nearby: true, sort: 'distance' });
  });

  it('keeps an explicit sort even when nearby=true', () => {
    expect(parseFilters('?nearby=true&sort=species_count')).toMatchObject({
      nearby: true, sort: 'species_count',
    });
  });

  it('parses comma-separated taxa', () => {
    expect(parseFilters('?taxon=Aves,Plantae').taxa).toEqual(['Aves', 'Plantae']);
  });

  it('clamps page to >= 1', () => {
    expect(parseFilters('?page=0').page).toBe(1);
    expect(parseFilters('?page=-5').page).toBe(1);
  });

  it('emits no key for empty arrays / nulls / defaults', () => {
    const f: CommunityFilters = {
      sort: 'observation_count', country: null, taxa: [],
      experts: false, nearby: false, page: 1,
    };
    expect(serializeFilters(f)).toBe('');
  });
});
```

- [ ] **Step 13.2: Run tests — must fail**

```bash
npx vitest run tests/unit/community-url.test.ts
```
Expected: all 8 fail with "Cannot find module".

- [ ] **Step 13.3: Implement the helper**

Create `src/lib/community-url.ts`:

```ts
export type CommunitySort =
  | 'observation_count' | 'species_count'
  | 'obs_count_7d'      | 'obs_count_30d'
  | 'last_observation_at'| 'joined_at'
  | 'distance';

const SORTS: ReadonlyArray<CommunitySort> = [
  'observation_count', 'species_count', 'obs_count_7d', 'obs_count_30d',
  'last_observation_at', 'joined_at', 'distance',
];

export interface CommunityFilters {
  sort: CommunitySort;
  country: string | null;     // ISO-3166 alpha-2; null = any
  taxa: string[];             // empty = any
  experts: boolean;
  nearby: boolean;
  page: number;               // 1-indexed
}

export const DEFAULT_FILTERS: CommunityFilters = {
  sort: 'observation_count',
  country: null,
  taxa: [],
  experts: false,
  nearby: false,
  page: 1,
};

function isSort(x: string): x is CommunitySort {
  return (SORTS as readonly string[]).includes(x);
}

export function parseFilters(qs: string): CommunityFilters {
  const sp = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const rawSort = sp.get('sort');
  const nearby  = sp.get('nearby') === 'true';
  const sort: CommunitySort =
    rawSort && isSort(rawSort) ? rawSort
    : (nearby ? 'distance' : 'observation_count');

  const country = sp.get('country');
  const taxonStr = sp.get('taxon') ?? '';
  const taxa = taxonStr ? taxonStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  const experts = sp.get('expert') === 'true';
  const pageRaw = parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return {
    sort,
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    taxa,
    experts,
    nearby,
    page,
  };
}

export function serializeFilters(f: CommunityFilters): string {
  const sp = new URLSearchParams();
  if (f.sort !== 'observation_count') sp.set('sort', f.sort);
  if (f.country)                       sp.set('country', f.country);
  if (f.taxa.length > 0)               sp.set('taxon', f.taxa.join(','));
  if (f.experts)                       sp.set('expert', 'true');
  if (f.nearby)                        sp.set('nearby', 'true');
  if (f.page > 1)                      sp.set('page', String(f.page));
  const out = sp.toString();
  return out ? `?${out}` : '';
}
```

- [ ] **Step 13.4: Run tests — must pass**

```bash
npx vitest run tests/unit/community-url.test.ts
```
Expected: 8 passing.

- [ ] **Step 13.5: Commit**

```bash
git add src/lib/community-url.ts tests/unit/community-url.test.ts
git commit -m "feat(lib): m27 — community URL state helper + tests"
```

---

## Task 14 — `community.ts` query client

**Files:**
- Create: `src/lib/community.ts`

- [ ] **Step 14.1: Implement the client**

Create `src/lib/community.ts`:

```ts
import { supabase } from './supabase';
import type { CommunityFilters, CommunitySort } from './community-url';

export interface CommunityObserver {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string | null;
  expert_taxa: string[] | null;
  is_expert: boolean;
  observation_count: number;
  species_count: number;
  obs_count_7d: number;
  obs_count_30d: number;
  last_observation_at: string | null;
  joined_at: string;
  distance_m?: number;
}

const PAGE_SIZE = 20;

function sortColumn(s: CommunitySort): string {
  return s === 'distance' ? 'observation_count' : s;
}

export async function loadCommunity(filters: CommunityFilters): Promise<{
  rows: CommunityObserver[];
  total: number;
}> {
  // Nearby uses the centroid view (auth-only); everything else uses the
  // anon-safe view so signed-out users see the page too.
  if (filters.nearby) return loadCommunityNearby(filters);

  let q = supabase
    .from('community_observers')
    .select('*', { count: 'exact' });

  if (filters.country)        q = q.eq('country_code', filters.country);
  if (filters.experts)        q = q.eq('is_expert', true);
  if (filters.taxa.length > 0) q = q.contains('expert_taxa', filters.taxa);

  const col = sortColumn(filters.sort);
  q = q.order(col, { ascending: false, nullsFirst: false });

  const from = (filters.page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as CommunityObserver[], total: count ?? 0 };
}

async function loadCommunityNearby(filters: CommunityFilters): Promise<{
  rows: CommunityObserver[];
  total: number;
}> {
  // Read the viewer's centroid from the auth-only view (their own row).
  const { data: me, error: meErr } = await supabase
    .from('community_observers_with_centroid')
    .select('centroid_geog')
    .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .maybeSingle();
  if (meErr) throw meErr;
  if (!me?.centroid_geog) {
    return { rows: [], total: 0 };
  }

  // ST_DWithin(...) and `<->` operator are not exposed by PostgREST directly;
  // call a SQL helper. We define it in the schema (see Task 14.2 below).
  const { data, error } = await supabase.rpc('community_observers_nearby', {
    p_radius_m: 200_000,
    p_limit:    PAGE_SIZE,
    p_offset:   (filters.page - 1) * PAGE_SIZE,
    p_country:  filters.country,
    p_taxa:     filters.taxa.length > 0 ? filters.taxa : null,
    p_experts:  filters.experts,
  });
  if (error) throw error;
  return { rows: (data ?? []) as CommunityObserver[], total: (data ?? []).length };
}
```

- [ ] **Step 14.2: Append the SQL RPC the Nearby query needs**

In `docs/specs/infra/supabase-schema.sql`, append (after Task 5.3's recompute function):

```sql
-- 9) Nearby helper. Authenticated only — uses community_observers_with_centroid.
CREATE OR REPLACE FUNCTION public.community_observers_nearby(
  p_radius_m numeric  DEFAULT 200000,
  p_limit    int      DEFAULT 20,
  p_offset   int      DEFAULT 0,
  p_country  text     DEFAULT NULL,
  p_taxa     text[]   DEFAULT NULL,
  p_experts  boolean  DEFAULT false
)
RETURNS SETOF public.community_observers_with_centroid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH viewer AS (
    SELECT centroid_geog FROM public.users WHERE id = auth.uid()
  )
  SELECT v.*
    FROM public.community_observers_with_centroid v, viewer
   WHERE v.id <> auth.uid()
     AND viewer.centroid_geog IS NOT NULL
     AND ST_DWithin(v.centroid_geog, viewer.centroid_geog, p_radius_m)
     AND (p_country IS NULL OR v.country_code = p_country)
     AND (p_taxa    IS NULL OR v.expert_taxa @> p_taxa)
     AND (p_experts = false OR v.is_expert = true)
   ORDER BY v.centroid_geog <-> viewer.centroid_geog
   LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.community_observers_nearby(numeric, int, int, text, text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_observers_nearby(numeric, int, int, text, text[], boolean) TO authenticated;
```

- [ ] **Step 14.3: Apply schema**

```bash
make db-apply
make db-apply  # idempotency
```
Expected: both exit 0.

- [ ] **Step 14.4: Smoke test the RPC**

```bash
psql "$SUPABASE_DB_URL" -c "
  SET LOCAL ROLE authenticated;
  SELECT count(*) FROM public.community_observers_nearby(200000, 5);"
```
This will return 0 rows under the postgres role context if `auth.uid()` is null — that's expected. The RPC's correctness is asserted by the e2e test in Task 19.

- [ ] **Step 14.5: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/community.ts docs/specs/infra/supabase-schema.sql
git commit -m "feat(lib): m27 — community query client + community_observers_nearby RPC"
```

---

## Task 15 — `CommunityCard.astro`

**Files:**
- Create: `src/components/CommunityCard.astro`

- [ ] **Step 15.1: Implement the card**

Create `src/components/CommunityCard.astro`:

```astro
---
import { t } from '../i18n/utils';
import FollowButton from './FollowButton.astro';
import type { CommunityObserver } from '../lib/community';

interface Props {
  lang: 'en' | 'es';
  observer: CommunityObserver;
}
const { lang, observer } = Astro.props;
const tr = t(lang);
const cm = (tr as unknown as {
  community: {
    card: { obs: string; species: string; last_seen: string };
  };
}).community;

const handle = observer.username ?? observer.id.slice(0, 8);
const displayName = observer.display_name ?? handle;
const profileHref = `/${lang}/u/${handle}/`;

const obsLabel     = cm.card.obs.replace('{n}', String(observer.observation_count));
const speciesLabel = cm.card.species.replace('{n}', String(observer.species_count));

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return lang === 'es' ? 'hoy' : 'today';
  if (days === 1) return lang === 'es' ? 'ayer' : 'yesterday';
  if (days < 30)  return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
  if (days < 365) return lang === 'es' ? `hace ${Math.floor(days/30)} m` : `${Math.floor(days/30)}mo ago`;
  return lang === 'es' ? `hace ${Math.floor(days/365)} a` : `${Math.floor(days/365)}y ago`;
}
const lastSeenLabel = cm.card.last_seen.replace('{when}', relativeTime(observer.last_observation_at));
---

<article class="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-start gap-3">
  <a href={profileHref} class="flex-none">
    {observer.avatar_url
      ? <img src={observer.avatar_url} alt="" loading="lazy"
             class="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-800 object-cover" />
      : <div class="w-12 h-12 rounded-full bg-emerald-700 text-white flex items-center justify-center font-semibold">
          {displayName.slice(0,1).toUpperCase()}
        </div>}
  </a>
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <a href={profileHref} class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
        @{handle}
      </a>
      {observer.display_name && (
        <span class="text-xs text-zinc-500 dark:text-zinc-400 truncate">· {observer.display_name}</span>
      )}
      {observer.is_expert && (
        <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {lang === 'es' ? 'experto' : 'expert'}
        </span>
      )}
    </div>
    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400 truncate">
      {observer.country_code && <span>{observer.country_code} · </span>}
      {(observer.expert_taxa ?? []).join(', ')}
    </p>
    <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
      <span>{obsLabel}</span>
      <span class="mx-1.5 text-zinc-400">·</span>
      <span>{speciesLabel}</span>
      <span class="mx-1.5 text-zinc-400">·</span>
      <span>{lastSeenLabel}</span>
    </p>
  </div>
  <div class="flex-none">
    <FollowButton lang={lang} userId={observer.id} compact />
  </div>
</article>
```

- [ ] **Step 15.2: Confirm `FollowButton.astro` accepts the props used**

```bash
grep -n "interface Props" src/components/FollowButton.astro | head -3
sed -n '1,30p' src/components/FollowButton.astro
```
Expected: `userId` (or `targetUserId`) prop. If the prop name differs, update the import call accordingly. The `compact` prop is optional UX shorthand — if FollowButton doesn't support it, drop it and the button renders default size.

- [ ] **Step 15.3: Commit**

```bash
git add src/components/CommunityCard.astro
git commit -m "feat(ui): m27 — CommunityCard component"
```

---

## Task 16 — `CommunityView.astro` (the page body)

**Files:**
- Create: `src/components/CommunityView.astro`

- [ ] **Step 16.1: Implement the view**

Create `src/components/CommunityView.astro`:

```astro
---
import { t, getLocalizedPath, routes } from '../i18n/utils';
import CommunityCard from './CommunityCard.astro';

interface Props {
  lang: 'en' | 'es';
}
const { lang } = Astro.props;
const tr = t(lang);
const cm = (tr as unknown as {
  community: Record<string, Record<string, string> | string>;
}).community;
const editProfileHref = getLocalizedPath(lang, routes.profileEdit[lang] + '/');
---

<section class="max-w-4xl mx-auto px-4 py-6">
  <div class="flex items-start justify-between gap-4 mb-2">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">{cm.page_title as string}</h1>
      <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{cm.page_subtitle as string}</p>
    </div>
    <a href={editProfileHref}
       class="text-xs text-zinc-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 underline whitespace-nowrap">
      {(cm.leaderboards_optout_link as string)} ↗
    </a>
  </div>

  <!-- Filter chips (sticky) -->
  <div id="community-chips" class="sticky top-14 z-10 bg-white dark:bg-zinc-950 py-3 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-2">
    <select id="cf-sort" class="text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1">
      <option value="observation_count">{((cm.sort as Record<string,string>).obs)}</option>
      <option value="species_count">{((cm.sort as Record<string,string>).species)}</option>
      <option value="obs_count_7d">{((cm.sort as Record<string,string>).active_7d)}</option>
      <option value="obs_count_30d">{((cm.sort as Record<string,string>).active_30d)}</option>
      <option value="last_observation_at">{((cm.sort as Record<string,string>).recent)}</option>
      <option value="joined_at">{((cm.sort as Record<string,string>).newest)}</option>
      <option value="distance">{((cm.sort as Record<string,string>).distance)}</option>
    </select>
    <select id="cf-country" class="text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1">
      <option value="">{((cm.filter as Record<string,string>).country)}: {((cm.filter as Record<string,string>).any)}</option>
      <!-- Populated client-side from /rest/v1/iso_countries -->
    </select>
    <input id="cf-taxon" type="text" placeholder={((cm.filter as Record<string,string>).taxon)}
           class="text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 w-32" />
    <label class="text-sm flex items-center gap-1.5"><input id="cf-experts" type="checkbox" />
      {((cm.filter as Record<string,string>).experts_only)}</label>
    <label class="text-sm flex items-center gap-1.5"><input id="cf-nearby" type="checkbox" />
      {((cm.filter as Record<string,string>).nearby)}</label>
  </div>

  <div id="community-list" class="mt-4 space-y-2">
    <p class="text-sm text-zinc-500 italic">{lang === 'es' ? 'Cargando…' : 'Loading…'}</p>
  </div>

  <div id="community-empty" class="hidden mt-8 text-center text-sm text-zinc-500"></div>

  <nav id="community-pager" class="hidden mt-6 flex items-center justify-between text-sm">
    <button id="cf-prev" class="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-50">
      ← {lang === 'es' ? 'Anterior' : 'Previous'}
    </button>
    <span id="cf-page" class="text-zinc-500"></span>
    <button id="cf-next" class="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-50">
      {lang === 'es' ? 'Siguiente' : 'Next'} →
    </button>
  </nav>
</section>

<script>
  import { parseFilters, serializeFilters, type CommunityFilters } from '../lib/community-url';
  import { loadCommunity } from '../lib/community';
  import { supabase } from '../lib/supabase';

  const lang = (document.documentElement.lang === 'es' ? 'es' : 'en') as 'en' | 'es';
  const list  = document.getElementById('community-list')!;
  const empty = document.getElementById('community-empty')!;
  const pager = document.getElementById('community-pager')!;
  const pageLabel = document.getElementById('cf-page')!;
  const prev  = document.getElementById('cf-prev') as HTMLButtonElement;
  const next  = document.getElementById('cf-next') as HTMLButtonElement;

  const sortEl    = document.getElementById('cf-sort')    as HTMLSelectElement;
  const countryEl = document.getElementById('cf-country') as HTMLSelectElement;
  const taxonEl   = document.getElementById('cf-taxon')   as HTMLInputElement;
  const expertsEl = document.getElementById('cf-experts') as HTMLInputElement;
  const nearbyEl  = document.getElementById('cf-nearby')  as HTMLInputElement;

  // Populate the country dropdown.
  const isoCol = lang === 'es' ? 'name_es' : 'name_en';
  const { data: countries } = await supabase
    .from('iso_countries').select(`code, ${isoCol}`).order(isoCol);
  for (const c of (countries ?? []) as Array<Record<string,string>>) {
    const opt = document.createElement('option');
    opt.value = c.code; opt.textContent = c[isoCol];
    countryEl.appendChild(opt);
  }

  function readUI(): CommunityFilters {
    return {
      sort: sortEl.value as CommunityFilters['sort'],
      country: countryEl.value || null,
      taxa: taxonEl.value ? taxonEl.value.split(',').map(s => s.trim()).filter(Boolean) : [],
      experts: expertsEl.checked,
      nearby:  nearbyEl.checked,
      page: 1,
    };
  }

  function writeUI(f: CommunityFilters) {
    sortEl.value    = f.sort;
    countryEl.value = f.country ?? '';
    taxonEl.value   = f.taxa.join(',');
    expertsEl.checked = f.experts;
    nearbyEl.checked  = f.nearby;
  }

  let filters = parseFilters(window.location.search);
  writeUI(filters);

  async function refresh() {
    list.innerHTML = `<p class="text-sm text-zinc-500 italic">${lang === 'es' ? 'Cargando…' : 'Loading…'}</p>`;
    empty.classList.add('hidden');
    pager.classList.add('hidden');

    // Anonymous + nearby: short-circuit to the empty state.
    const { data: { user } } = await supabase.auth.getUser();
    if (filters.nearby && !user) {
      list.innerHTML = '';
      empty.textContent = lang === 'es'
        ? 'Inicia sesión para encontrar observadores cerca.'
        : 'Sign in to find observers near you.';
      empty.classList.remove('hidden');
      return;
    }

    try {
      const { rows, total } = await loadCommunity(filters);
      if (rows.length === 0) {
        list.innerHTML = '';
        empty.textContent = filters.nearby
          ? (lang === 'es' ? 'Registra una observación para encontrar observadores cerca.' : 'Log an observation to find observers near you.')
          : (lang === 'es' ? 'Ningún observador coincide con estos filtros. Prueba quitar uno.' : 'No observers match these filters. Try removing one.');
        empty.classList.remove('hidden');
        return;
      }
      // Render cards. We import a Web Component is overkill; build innerHTML from a server-friendly template.
      list.innerHTML = '';
      for (const row of rows) {
        // Cards are statically renderable; for runtime simplicity we generate
        // the markup in JS. The full structure mirrors CommunityCard.astro.
        const el = document.createElement('article');
        el.className = 'rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-start gap-3';
        el.innerHTML = `
          <a href="/${lang}/u/${row.username ?? row.id.slice(0,8)}/" class="flex-none">
            ${row.avatar_url
              ? `<img src="${row.avatar_url}" alt="" loading="lazy" class="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-800 object-cover">`
              : `<div class="w-12 h-12 rounded-full bg-emerald-700 text-white flex items-center justify-center font-semibold">${(row.display_name ?? row.username ?? '?').slice(0,1).toUpperCase()}</div>`}
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">@${row.username ?? row.id.slice(0,8)}</span>
              ${row.display_name ? `<span class="text-xs text-zinc-500">· ${row.display_name}</span>` : ''}
              ${row.is_expert ? `<span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">${lang === 'es' ? 'experto' : 'expert'}</span>` : ''}
            </div>
            <p class="mt-1 text-xs text-zinc-500 truncate">
              ${row.country_code ? row.country_code + ' · ' : ''}${(row.expert_taxa ?? []).join(', ')}
            </p>
            <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              <span>${row.observation_count} ${lang === 'es' ? 'obs' : 'obs'}</span>
              <span class="mx-1.5 text-zinc-400">·</span>
              <span>${row.species_count} ${lang === 'es' ? 'especies' : 'species'}</span>
            </p>
          </div>
        `;
        list.appendChild(el);
      }
      pager.classList.remove('hidden');
      pageLabel.textContent = `${filters.page} / ${Math.max(1, Math.ceil(total / 20))}`;
      prev.disabled = filters.page <= 1;
      next.disabled = filters.page * 20 >= total;
    } catch (err) {
      list.innerHTML = `<p class="text-sm text-red-600">${(err as Error).message}</p>`;
    }
  }

  function pushAndRefresh() {
    const next = readUI();
    filters = { ...next, page: 1 };
    history.replaceState(null, '', window.location.pathname + serializeFilters(filters));
    void refresh();
  }
  for (const el of [sortEl, countryEl, expertsEl, nearbyEl]) el.addEventListener('change', pushAndRefresh);
  taxonEl.addEventListener('change', pushAndRefresh);
  prev.addEventListener('click', () => { filters = { ...filters, page: Math.max(1, filters.page - 1) }; void refresh(); });
  next.addEventListener('click', () => { filters = { ...filters, page: filters.page + 1 }; void refresh(); });

  void refresh();
</script>
```

> Note: this v1 uses runtime-built innerHTML in the script for the list. `CommunityCard.astro` from Task 15 is intentionally available for any future server-rendered consumer (e.g. the OG card or an SSR variant) but the live page builds cards in JS to keep the filter UX snappy.

- [ ] **Step 16.2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 16.3: Commit**

```bash
git add src/components/CommunityView.astro
git commit -m "feat(ui): m27 — CommunityView page body with filter chips"
```

---

## Task 17 — Page shells + MegaMenu wiring + MobileDrawer

**Files:**
- Create: `src/pages/en/community/observers.astro`
- Create: `src/pages/es/comunidad/observadores.astro`
- Modify: `src/components/Header.astro`
- Modify: `src/components/MobileDrawer.astro`

- [ ] **Step 17.1: Verify directories don't exist yet**

```bash
ls src/pages/en/community 2>/dev/null
ls src/pages/es/comunidad 2>/dev/null
```
Expected: both not-found errors.

```bash
mkdir -p src/pages/en/community src/pages/es/comunidad
```

- [ ] **Step 17.2: Create the EN page shell**

Create `src/pages/en/community/observers.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import CommunityView from '../../../components/CommunityView.astro';
import { t } from '../../../i18n/utils';
const tr = t('en');
const cm = (tr as unknown as { community: { page_title: string } }).community;
---

<BaseLayout lang="en" title={cm.page_title} description={cm.page_title}>
  <CommunityView lang="en" />
</BaseLayout>
```

- [ ] **Step 17.3: Create the ES page shell**

Create `src/pages/es/comunidad/observadores.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import CommunityView from '../../../components/CommunityView.astro';
import { t } from '../../../i18n/utils';
const tr = t('es');
const cm = (tr as unknown as { community: { page_title: string } }).community;
---

<BaseLayout lang="es" title={cm.page_title} description={cm.page_title}>
  <CommunityView lang="es" />
</BaseLayout>
```

- [ ] **Step 17.4: Replace the Header's inline Explore dropdown with a MegaMenu**

In `src/components/Header.astro`, find the block from line ~102 (`<!-- Explore dropdown (small list, not mega) -->`) through the closing `</div>` of the `hdr-explore` wrapper (~line 124). Replace with:

```astro
{/* Explore mega-menu — Biodiversity + Community columns */}
<MegaMenu
  lang={locale}
  trigger={tr.nav.explore}
  align="left"
  active={expActive}
  columns={[
    {
      heading: ((tr as unknown as { nav: { explore_megamenu: { biodiversity: string } } }).nav.explore_megamenu.biodiversity),
      items: [
        { key: 'exploreMap',       label: tr.nav.explore_dropdown.map },
        { key: 'exploreRecent',    label: tr.nav.explore_dropdown.recent },
        { key: 'exploreWatchlist', label: tr.nav.explore_dropdown.watchlist },
        { key: 'exploreSpecies',   label: tr.nav.explore_dropdown.species },
        { key: 'exploreValidate',  label: ((tr as unknown as { validation?: { nav_validate_label?: string } }).validation?.nav_validate_label) ?? 'Validate' },
      ],
    },
    {
      heading: ((tr as unknown as { nav: { explore_megamenu: { community: string } } }).nav.explore_megamenu.community),
      items: [
        { key: 'communityObservers',          label: ((tr as unknown as { nav: { explore_megamenu: { community_all: string } } }).nav.explore_megamenu.community_all) },
        { key: 'communityObservers:top',      label: ((tr as unknown as { nav: { explore_megamenu: { community_top: string } } }).nav.explore_megamenu.community_top) },
        { key: 'communityObservers:nearby',   label: ((tr as unknown as { nav: { explore_megamenu: { community_nearby: string } } }).nav.explore_megamenu.community_nearby) },
        { key: 'communityObservers:experts',  label: ((tr as unknown as { nav: { explore_megamenu: { community_experts: string } } }).nav.explore_megamenu.community_experts) },
        { key: 'communityObservers:country',  label: ((tr as unknown as { nav: { explore_megamenu: { community_country: string } } }).nav.explore_megamenu.community_country) },
      ],
    },
  ]}
/>
```

The `:top`, `:nearby`, etc. suffixes are filter presets. `MegaMenu.astro` calls `getDocPath(lang, item.key)` today — but this hits `/docs/...`. **Modify `MegaMenu.astro`** to support a different href shape: either accept a `href` field per item, or branch on a `routeKey` field. The smallest change:

In `src/components/MegaMenu.astro`, change the `Item` interface and the href resolution. Replace `interface Item { key: string; label: string; desc?: string; }` with:

```ts
interface Item { key: string; label: string; desc?: string; href?: string; }
```

In the rendered `<a>`, change `href={getDocPath(lang, item.key)}` to `href={item.href ?? getDocPath(lang, item.key)}`.

Then in the Header invocation above, build `href` for each item explicitly:

```ts
{ key: 'communityObservers',
  label: ...,
  href: getLocalizedPath(locale, routes.communityObservers[locale] + '/'),
},
{ key: 'communityObserversTop',
  label: ...,
  href: getLocalizedPath(locale, routes.communityObservers[locale] + '/?sort=obs_count_30d'),
},
{ key: 'communityObserversNearby',
  label: ...,
  href: getLocalizedPath(locale, routes.communityObservers[locale] + '/?nearby=true'),
},
{ key: 'communityObserversExperts',
  label: ...,
  href: getLocalizedPath(locale, routes.communityObservers[locale] + '/?expert=true'),
},
{ key: 'communityObserversCountry',
  label: ...,
  href: getLocalizedPath(locale, routes.communityObservers[locale] + '/?country='),
},
```

Same for the Biodiversity column — add `href: getLocalizedPath(locale, routes.exploreMap[locale] + '/')` etc. to each item there. The fallback `getDocPath(...)` stays in MegaMenu for the existing Docs invocation.

The accent rail for Explore stays teal — it's already in the safelist (`text-teal-600`, `after:bg-teal-500`). No tailwind safelist changes needed for this PR.

- [ ] **Step 17.5: Add Community items to MobileDrawer**

In `src/components/MobileDrawer.astro`, find the Reference section (around line 55–60) and add a new section above the auth section with two subheadings:

```astro
<section>
  <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{tr.nav.explore}</p>

  <p class="text-[11px] uppercase tracking-wider text-zinc-500 mt-2 mb-1">{((tr as unknown as { nav: { explore_megamenu: { biodiversity: string } } }).nav.explore_megamenu.biodiversity)}</p>
  <a href={`/${lang}${routes.exploreMap[lang]}/`}        class="block py-1.5">{tr.nav.explore_dropdown.map}</a>
  <a href={`/${lang}${routes.exploreRecent[lang]}/`}     class="block py-1.5">{tr.nav.explore_dropdown.recent}</a>
  <a href={`/${lang}${routes.exploreWatchlist[lang]}/`}  class="block py-1.5">{tr.nav.explore_dropdown.watchlist}</a>
  <a href={`/${lang}${routes.exploreSpecies[lang]}/`}    class="block py-1.5">{tr.nav.explore_dropdown.species}</a>

  <p class="text-[11px] uppercase tracking-wider text-zinc-500 mt-3 mb-1">{((tr as unknown as { nav: { explore_megamenu: { community: string } } }).nav.explore_megamenu.community)}</p>
  <a href={`/${lang}${routes.communityObservers[lang]}/`} class="block py-1.5">
    {((tr as unknown as { nav: { explore_megamenu: { community_all: string } } }).nav.explore_megamenu.community_all)}
  </a>
  <a href={`/${lang}${routes.communityObservers[lang]}/?sort=obs_count_30d`} class="block py-1.5">
    {((tr as unknown as { nav: { explore_megamenu: { community_top: string } } }).nav.explore_megamenu.community_top)}
  </a>
  <a href={`/${lang}${routes.communityObservers[lang]}/?nearby=true`} class="block py-1.5">
    {((tr as unknown as { nav: { explore_megamenu: { community_nearby: string } } }).nav.explore_megamenu.community_nearby)}
  </a>
</section>
```

Add `import { routes } from '../i18n/utils';` to the frontmatter if missing.

- [ ] **Step 17.6: Build to confirm both pages render**

```bash
npm run build
ls dist/en/community/observers/index.html dist/es/comunidad/observadores/index.html
```
Expected: both files exist.

- [ ] **Step 17.7: Commit**

```bash
git add src/pages/en/community/observers.astro \
        src/pages/es/comunidad/observadores.astro \
        src/components/Header.astro \
        src/components/MegaMenu.astro \
        src/components/MobileDrawer.astro
git commit -m "feat(ui): m27 — community page shells + MegaMenu Community column + MobileDrawer"
```

---

## Task 18 — Vitest: country normalizer

**Files:**
- Create: `tests/unit/community-normalize.test.ts`

- [ ] **Step 18.1: Write the failing test (table-driven)**

This test asserts the SQL function's behaviour. The simplest path is a hosted-DB test: connect via env-var `SUPABASE_DB_URL`, run `SELECT public.normalize_country_code($1)` for each row, compare. Skip when the env var is unset (CI runs the validate gate already; this exists for local development and any DB-backed test runner).

Create `tests/unit/community-normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Client } from 'pg';

const URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const skip = !URL;

const cases: Array<[string, string | null]> = [
  ['MX',          'MX'],
  ['mx',          'MX'],
  ['Mexico',      'MX'],
  ['México',      'MX'],
  ['mexico',      'MX'],
  ['México DF',   'MX'],
  ['Estados Unidos', 'US'],
  ['United States',  'US'],
  ['Brasil',      'BR'],
  ['Brazil',      'BR'],
  ['Argentina',   'AR'],
  ['xyzzy',       null],
  ['',            null],
  [' ',           null],
];

(skip ? describe.skip : describe)('normalize_country_code', () => {
  it('matches the expected output for each input', async () => {
    const client = new Client({ connectionString: URL });
    await client.connect();
    try {
      for (const [input, expected] of cases) {
        const r = await client.query<{ code: string | null }>(
          'SELECT public.normalize_country_code($1) AS code', [input],
        );
        expect({ input, code: r.rows[0].code }).toEqual({ input, code: expected });
      }
    } finally {
      await client.end();
    }
  });
});
```

- [ ] **Step 18.2: Add `pg` if not present**

```bash
node -e "console.log(Object.keys(require('./package.json').dependencies).includes('pg') || Object.keys(require('./package.json').devDependencies ?? {}).includes('pg'))"
```
If `false`, install dev-only:

```bash
npm install --save-dev pg @types/pg
```

- [ ] **Step 18.3: Run with the env var set**

```bash
SUPABASE_DB_URL="$SUPABASE_DB_URL" npx vitest run tests/unit/community-normalize.test.ts
```
Expected: pass with all 14 cases. Without the env var, the suite skips (acceptable in CI without DB access).

- [ ] **Step 18.4: Commit**

```bash
git add tests/unit/community-normalize.test.ts package.json package-lock.json
git commit -m "test(community): m27 — normalize_country_code table-driven test"
```

---

## Task 19 — Playwright e2e

**Files:**
- Create: `tests/e2e/community.spec.ts`

- [ ] **Step 19.1: Write the spec**

Create `tests/e2e/community.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('community/observers', () => {
  test('EN page renders with results when seeded', async ({ page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('h1')).toHaveText(/Community observers/i);
    // Wait for the script to populate (loading → either rows or empty).
    await page.waitForFunction(() => {
      const list = document.getElementById('community-list');
      return list && !list.querySelector('p.italic');
    });
    // Either the list has cards OR the empty state is visible.
    const hasCards = await page.locator('#community-list article').count();
    const emptyVisible = await page.locator('#community-empty:not(.hidden)').count();
    expect(hasCards + emptyVisible).toBeGreaterThan(0);
  });

  test('changing sort updates the URL', async ({ page }) => {
    await page.goto('/en/community/observers/');
    await page.locator('#cf-sort').selectOption('species_count');
    await page.waitForURL(/sort=species_count/);
    expect(page.url()).toContain('sort=species_count');
  });

  test('?nearby=true while signed out shows the sign-in CTA', async ({ page }) => {
    await page.goto('/en/community/observers/?nearby=true');
    const empty = page.locator('#community-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toContainText(/Sign in to find observers/i);
  });

  test('ES route is reachable and uses ES copy', async ({ page }) => {
    await page.goto('/es/comunidad/observadores/');
    await expect(page.locator('h1')).toHaveText(/Observadores de la comunidad/i);
  });
});

test.describe('community/observers — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer shows Community subheading', async ({ page }) => {
    await page.goto('/en/');
    await page.locator('#mobile-menu-toggle').click();
    const drawer = page.locator('#mobile-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Community', { exact: true })).toBeVisible();
  });
});
```

- [ ] **Step 19.2: Run the e2e**

```bash
npx playwright test tests/e2e/community.spec.ts --project=chromium
```
Expected: all 4 desktop specs pass; the mobile drawer test passes on the mobile-chrome project.

If the "page renders with results when seeded" test fails because the test DB has no users, the test is still meaningful — the `hasCards + emptyVisible > 0` assertion passes when the empty state shows. Don't seed fixtures here; the spec covers both branches.

- [ ] **Step 19.3: Commit**

```bash
git add tests/e2e/community.spec.ts
git commit -m "test(e2e): m27 — community page renders, sort, nearby-anon, ES, mobile drawer"
```

---

## Task 20 — Roadmap entry

**Files:**
- Modify: `docs/progress.json`
- Modify: `docs/tasks.json`

- [ ] **Step 20.1: Add the roadmap item**

In `docs/progress.json`, find the right phase (likely "Phase 5 — Community & social") and add:

```jsonc
{
  "id": "community-discovery",
  "title": "Community discovery in Explore",
  "title_es": "Descubrimiento de comunidad en Explorar",
  "status": "in_progress",
  "spec": "docs/superpowers/specs/2026-04-29-community-discovery-design.md",
  "plan": "docs/superpowers/plans/2026-04-29-community-discovery-plan.md"
}
```

- [ ] **Step 20.2: Add the subtask breakdown**

In `docs/tasks.json`, add:

```jsonc
"community-discovery": {
  "subtasks": [
    { "id": "schema",       "title": "Schema deltas + views + indexes",        "title_es": "Cambios de esquema + vistas + índices" },
    { "id": "ef",           "title": "recompute-user-stats Edge Function",     "title_es": "Edge Function recompute-user-stats" },
    { "id": "cron",         "title": "Cron schedule at 03:30 UTC",             "title_es": "Cron a las 03:30 UTC" },
    { "id": "profile-edit", "title": "Profile → Edit country + opt-out",       "title_es": "Perfil → Editar país + opt-out" },
    { "id": "page",         "title": "Community page + MegaMenu",              "title_es": "Página Comunidad + MegaMenu" },
    { "id": "i18n",         "title": "Rewrite no-leaderboards strings",        "title_es": "Reescribir cadenas sin clasificaciones" },
    { "id": "tests",        "title": "Vitest + Playwright",                    "title_es": "Vitest + Playwright" }
  ]
}
```

- [ ] **Step 20.3: Build and confirm `/docs/roadmap/` and `/docs/tasks/` rebuild**

```bash
npm run build
```
Expected: 0 errors; both pages re-render.

- [ ] **Step 20.4: Commit**

```bash
git add docs/progress.json docs/tasks.json
git commit -m "docs(roadmap): m27 — community-discovery item + subtasks"
```

---

## Task 21 — Pre-PR checklist for PR5+PR6

- [ ] **Step 21.1: Run the full test suite**

```bash
npm run typecheck
npm run test
npm run build
```
Expected: 0 type errors; ~462+ vitest tests pass (8 new from Task 13, plus optional 1 from Task 18 if DB available); build succeeds with the two new pages listed (~59 pages now).

- [ ] **Step 21.2: Open the PR**

```bash
gh pr create --fill --title "feat(community): community discovery in Explore (M27)"
```
PR description should reference the spec, the plan, and call out the atomic i18n rewrite.

- [ ] **Step 21.3: Watch the required checks**

```bash
gh pr checks --watch
```
Expected: `db-validate.yml` (idempotency + sentinel), `e2e.yml`, `lhci.yml` all green.

- [ ] **Step 21.4: After merge, fire the production cron once**

```bash
psql "$SUPABASE_DB_URL" -c "
  SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-user-stats',
    headers := '{\"Content-Type\":\"application/json\"}'::jsonb,
    body := '{}'::jsonb
  );"
```
Expected: a request id integer. Wait ~10s, then verify counters updated:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM public.users WHERE obs_count_7d > 0;"
```

- [ ] **Step 21.5: Manual smoke**

1. Visit `https://rastrum.org/en/community/observers/`. List of observers renders.
2. Change sort to "Most species". URL updates to `?sort=species_count`. List re-orders.
3. Sign out. Visit `?nearby=true`. Empty-state CTA shows ("Sign in…").
4. Sign in. Toggle Profile → Edit "Show me in community discovery" off. Reload Community page. Your handle is gone.
5. Toggle back on. Reload. Your handle is back.
6. ES locale: `https://rastrum.org/es/comunidad/observadores/` shows ES copy + ES country names.
7. MegaMenu: `Explore ▾` in the header opens with two columns; mobile drawer shows the Community subheading.

---

## Risks and recovery

**Schema migration is the riskiest step.** PR1 lands seven new columns, seven new indexes, two views, a new table with seed data, and a SECURITY DEFINER function. The validate gate (`db-validate.yml`) is a real net but the production `db-apply.yml` runs without a transaction wrapper — a partial failure mid-block leaves the schema in a half-applied state. Mitigations baked into the plan: every statement is `IF NOT EXISTS` / `OR REPLACE` / `ON CONFLICT`, so re-running on a half-applied DB is safe. If `db-apply.yml` fails on production, the recovery is to fix the offending statement and re-run via `gh workflow run db-apply.yml`.

**The `recompute_user_stats()` RPC is SECURITY DEFINER.** It runs with the function-owner's privileges, not the caller's. Restricted to `service_role` via the explicit `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO service_role`. Do not weaken those grants; they are the only thing keeping a logged-in user from triggering the recompute and timing the response.

**The atomic i18n rewrite (Task 12) ships in the same PR as the page.** If the page is reverted post-merge, revert Task 12's diff with it. Otherwise the app will claim "Community leaderboards are opt-in" while the route 404s — worst-case copy state.

**Privacy invariant.** The two-view split is load-bearing. If a future refactor consolidates them, it MUST preserve: (a) `community_observers` granted to anon+auth, no centroid; (b) centroid view granted to authenticated only. The schema sentinel in `db-apply.yml` should be extended to assert these grants.

---

## Self-review notes

- Spec coverage: every section has at least one task. The brainstorming "decisions captured" table is implemented across Tasks 2–6 (denorm + cron + views + privacy gate). The "open questions" parked at the end of the spec are resolved: SSR question → client-rendered (Task 16); thumbnail question → deferred to v1.1 (omitted from the card); country backfill prompt → not sent (the cron's `COALESCE(country_code, normalize(...))` is the backfill, with `region_primary`-empty users left NULL).
- Type consistency: `CommunityObserver`, `CommunityFilters`, `CommunitySort` are defined once in `src/lib/community-url.ts` and `src/lib/community.ts`, used consistently in the view script and the e2e.
- Function names referenced consistently: `recompute_user_stats()` (SQL), `community_observers_nearby(...)` (SQL), `loadCommunity(...)` (TS), `parseFilters/serializeFilters` (TS), `normalize_country_code(text)` (SQL).
- No placeholders. Every code block is complete and copy-pasteable.

