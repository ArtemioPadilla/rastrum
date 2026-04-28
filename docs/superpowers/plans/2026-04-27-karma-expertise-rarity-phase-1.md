# Karma + Expertise + Rarity — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the karma engine end-to-end: data model, computation triggered by `recompute_consensus`, predictability microcopy in the suggest modal, profile karma section, and a Pokédex page. After Phase 1, every consensus event awards/penalizes karma per the spec, and users can see their score and per-taxon expertise.

**Architecture:** All karma math runs in Postgres inside the existing `recompute_consensus` flow — no new Edge Functions in v1. A nightly `pg_cron` job materializes `taxon_rarity` so per-event lookups are O(1). The `taxa.ancestor_path uuid[]` GIN-indexed array converts "most-specific ancestor of expertise" into a single array overlap. Frontend (Astro components + a new `src/lib/karma.ts`) reads cached `users.karma_total` and joins `user_expertise` for display.

**Tech Stack:** Postgres 15 (Supabase), Astro 4, TypeScript, Vitest, Playwright. SQL changes are idempotent and applied via `make db-apply`. Edge Functions are NOT touched in Phase 1.

**Spec:** `docs/superpowers/specs/2026-04-27-karma-expertise-rarity-design.md` (Phase 1 only).

**Phase 2 (engagement layers) and Phase 3 (IUCN/NOM data) get separate plans after Phase 1 ships.**

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `docs/specs/infra/supabase-schema.sql` | Modify | Append: 4 new tables, 1 column on `taxa`, 3 columns on `users`, ancestor-path trigger, `refresh_taxon_rarity()`, `award_karma()`, extend `recompute_consensus()`, migration shim. All idempotent. |
| `docs/specs/infra/supabase-cron-schedules.sql` | Modify | Append one cron entry: nightly 03:00 UTC `refresh_taxon_rarity()`. |
| `docs/specs/modules/23-karma-expertise-rarity.md` | Create | Module spec entry. Cross-links from module 22. |
| `docs/specs/modules/00-index.md` | Modify | Register module 23. |
| `docs/specs/modules/22-community-validation.md` | Modify | Mark v1.2 line as superseded by module 23. |
| `docs/progress.json` | Modify | Add karma roadmap items (3, one per phase). |
| `docs/tasks.json` | Modify | Add subtasks for Phase 1. |
| `src/lib/karma.ts` | Create | Pure TS helpers: `rarityTier()`, `microcopyForVote()`, `formatDelta()`. No DOM, no Supabase. |
| `src/components/SuggestIdModal.astro` | Modify | Hydrate + render pre-vote microcopy block. |
| `src/components/ProfileView.astro` | Modify | New karma section between streak and badges. |
| `src/components/PokedexView.astro` | Create | Pokédex grid view, fed by aggregation query. |
| `src/pages/en/profile/dex/index.astro` | Create | EN route to Pokédex. |
| `src/pages/es/perfil/dex/index.astro` | Create | ES route to Pokédex. |
| `src/i18n/en.json` | Modify | New strings under `karma`, `pokedex`, `validation.microcopy_*`. |
| `src/i18n/es.json` | Modify | Spanish parity. |
| `src/i18n/utils.ts` | Modify | Add `routes.dex = { en: '/profile/dex', es: '/perfil/dex' }` and `docPages` if needed. |
| `tests/unit/karma.test.ts` | Create | Vitest for `src/lib/karma.ts` pure helpers. |

> No e2e Playwright spec for karma. The microcopy hydration depends on a Supabase session + an observation owned by someone other than the viewer; per existing project convention (CLAUDE.md "Audit / E2E" section: avoid e2e flows that need real Supabase auth), the math coverage stays in the Vitest unit test and the modal is verified manually via `make dev`.

---

## Task 1 — Schema: new tables and columns (additive)

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append at end)

- [ ] **Step 1: Add the SQL block to the schema file**

Append this block to `docs/specs/infra/supabase-schema.sql` directly above the final `-- END OF SCHEMA` marker (or just at the end if no marker exists):

```sql
-- ============================================================
-- KARMA + EXPERTISE + RARITY (module 23) — additive Phase 1
-- ============================================================

-- 1. user_expertise: continuous score per (user, taxon).
CREATE TABLE IF NOT EXISTS public.user_expertise (
  user_id      uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  taxon_id     uuid    NOT NULL REFERENCES public.taxa(id)  ON DELETE CASCADE,
  score        numeric NOT NULL DEFAULT 0,
  verified_at  timestamptz,
  verified_by  uuid    REFERENCES public.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, taxon_id)
);
CREATE INDEX IF NOT EXISTS idx_user_expertise_taxon
  ON public.user_expertise(taxon_id);
CREATE INDEX IF NOT EXISTS idx_user_expertise_score
  ON public.user_expertise(user_id, score DESC);

ALTER TABLE public.user_expertise ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_expertise_public_read ON public.user_expertise;
CREATE POLICY user_expertise_public_read ON public.user_expertise
  FOR SELECT USING (true);

-- 2. taxa.ancestor_path: precomputed array of ancestor IDs (most-specific first).
ALTER TABLE public.taxa
  ADD COLUMN IF NOT EXISTS ancestor_path uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_taxa_ancestor_path
  ON public.taxa USING GIN (ancestor_path);

-- 3. taxon_rarity: nightly-materialized rarity buckets and multipliers.
CREATE TABLE IF NOT EXISTS public.taxon_rarity (
  taxon_id      uuid PRIMARY KEY REFERENCES public.taxa(id) ON DELETE CASCADE,
  obs_count     integer NOT NULL,
  percentile    numeric NOT NULL,
  bucket        smallint NOT NULL CHECK (bucket BETWEEN 1 AND 5),
  multiplier    numeric NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.taxon_rarity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taxon_rarity_public_read ON public.taxon_rarity;
CREATE POLICY taxon_rarity_public_read ON public.taxon_rarity
  FOR SELECT USING (true);

-- 4. karma_events: append-only ledger.
CREATE TABLE IF NOT EXISTS public.karma_events (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  observation_id  uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  taxon_id        uuid REFERENCES public.taxa(id) ON DELETE SET NULL,
  delta           numeric NOT NULL,
  reason          text NOT NULL CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust'
  )),
  rarity_bucket   smallint,
  expertise_rank  integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_karma_events_user
  ON public.karma_events(user_id, created_at DESC);

ALTER TABLE public.karma_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karma_events_self_read ON public.karma_events;
CREATE POLICY karma_events_self_read ON public.karma_events
  FOR SELECT USING (auth.uid() = user_id);

-- 5. users: karma_total + grace columns.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS karma_total      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS karma_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS grace_until      timestamptz,
  ADD COLUMN IF NOT EXISTS vote_count       integer NOT NULL DEFAULT 0;

-- 6. Backfill grace_until for existing users (only the first time).
UPDATE public.users
   SET grace_until = COALESCE(grace_until, created_at + INTERVAL '30 days')
 WHERE grace_until IS NULL;

GRANT SELECT ON public.user_expertise TO anon, authenticated;
GRANT SELECT ON public.taxon_rarity   TO anon, authenticated;
GRANT SELECT ON public.karma_events   TO authenticated;
```

- [ ] **Step 2: Apply schema and verify**

Run:
```bash
make db-apply
make db-verify
```
Expected: no errors. `make db-verify` lists the four new tables (`user_expertise`, `taxon_rarity`, `karma_events`) plus the new columns on `users` and `taxa`.

- [ ] **Step 3: Smoke-assert RLS + PK constraints**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "
SELECT tablename, rowsecurity
FROM   pg_tables
WHERE  schemaname='public'
  AND  tablename IN ('user_expertise','taxon_rarity','karma_events');
"
```
Expected: all three rows show `rowsecurity = t`.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): module 23 — karma + expertise + rarity tables (additive)"
```

---

## Task 2 — `taxa.ancestor_path` trigger + one-time backfill

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Add the function + trigger + backfill**

Append:

```sql
-- ============================================================
-- ancestor_path computation: walk parent_id chain on INSERT/UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_ancestor_path(p_taxon_id uuid)
RETURNS uuid[] AS $$
DECLARE
  result uuid[] := '{}';
  current_id uuid := p_taxon_id;
  parent_id uuid;
  guard int := 0;
BEGIN
  LOOP
    SELECT t.parent_id INTO parent_id FROM public.taxa t WHERE t.id = current_id;
    EXIT WHEN parent_id IS NULL;
    result := array_append(result, parent_id);
    current_id := parent_id;
    guard := guard + 1;
    IF guard > 30 THEN  -- safety: kingdoms are at most ~10 ranks deep
      RAISE EXCEPTION 'compute_ancestor_path: cycle or runaway at taxon %', p_taxon_id;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.taxa_set_ancestor_path()
RETURNS trigger AS $$
BEGIN
  NEW.ancestor_path := public.compute_ancestor_path(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_taxa_ancestor_path ON public.taxa;
CREATE TRIGGER trg_taxa_ancestor_path
  BEFORE INSERT OR UPDATE OF parent_id ON public.taxa
  FOR EACH ROW EXECUTE FUNCTION public.taxa_set_ancestor_path();

-- One-shot backfill of every existing taxa row.
UPDATE public.taxa SET ancestor_path = public.compute_ancestor_path(id);
```

- [ ] **Step 2: Apply and assert ancestor_path is populated**

Run:
```bash
make db-apply
psql "$SUPABASE_DB_URL" -c "
SELECT count(*) FILTER (WHERE ancestor_path = '{}') AS roots,
       count(*) FILTER (WHERE array_length(ancestor_path, 1) > 0) AS with_path,
       count(*) AS total
FROM public.taxa;
"
```
Expected: roots > 0 (at least the kingdoms), with_path is the rest, total = roots + with_path. If the `taxa` table is empty in your DB, that's fine — just no rows updated.

- [ ] **Step 3: Test the trigger on insert**

Run:
```bash
psql "$SUPABASE_DB_URL" -c "
BEGIN;
WITH k AS (
  INSERT INTO public.taxa (id, scientific_name, kingdom, parent_id)
  VALUES (gen_random_uuid(), 'TestKingdom_A', 'Plantae', NULL)
  RETURNING id
), c AS (
  INSERT INTO public.taxa (id, scientific_name, kingdom, parent_id)
  SELECT gen_random_uuid(), 'TestChild_A', 'Plantae', k.id FROM k
  RETURNING id, ancestor_path
)
SELECT array_length(ancestor_path, 1) AS depth FROM c;
ROLLBACK;
"
```
Expected: depth = 1 (the child has exactly one ancestor — the kingdom).

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): taxa.ancestor_path trigger + backfill"
```

---

## Task 3 — Migration shim from `is_expert` to `user_expertise`

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Add the idempotent backfill block**

Append:

```sql
-- ============================================================
-- One-time migration: hydrate user_expertise from is_expert + expert_taxa.
-- Idempotent thanks to ON CONFLICT DO NOTHING.
-- ============================================================
INSERT INTO public.user_expertise (user_id, taxon_id, score, verified_at, verified_by)
SELECT u.id,
       t.id,
       50,
       now(),
       NULL
FROM   public.users u
CROSS JOIN LATERAL unnest(u.expert_taxa) AS kingdom_name
JOIN   public.taxa t
       ON  t.kingdom = kingdom_name
       AND t.parent_id IS NULL
WHERE  u.is_expert = true
  AND  u.expert_taxa IS NOT NULL
ON CONFLICT (user_id, taxon_id) DO NOTHING;
```

- [ ] **Step 2: Apply and verify**

Run:
```bash
make db-apply
psql "$SUPABASE_DB_URL" -c "
SELECT count(*) AS verified_rows
FROM public.user_expertise WHERE verified_at IS NOT NULL;
"
```
Expected: equals `(SELECT sum(array_length(expert_taxa, 1)) FROM users WHERE is_expert)`. If you have no experts in DB yet, count = 0 (still correct).

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): migrate is_expert→user_expertise (idempotent shim)"
```

---

## Task 4 — `refresh_taxon_rarity()` function

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Add the function**

Append:

```sql
-- ============================================================
-- refresh_taxon_rarity: nightly recompute of percentile buckets.
-- Buckets:
--   1 = top 10% most common  → multiplier 1.0
--   2 = percentile 50–90     → multiplier 1.5
--   3 = percentile 10–50     → multiplier 2.5
--   4 = top 10% rarest       → multiplier 4.0
--   5 = obs_count < 5        → multiplier 5.0  (overrides bucket 4)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_taxon_rarity()
RETURNS void AS $$
BEGIN
  WITH counts AS (
    SELECT t.id AS taxon_id,
           COALESCE(c.n, 0) AS obs_count
    FROM   public.taxa t
    LEFT JOIN (
      SELECT taxon_id, count(*) AS n
      FROM   public.identifications
      WHERE  taxon_id IS NOT NULL
      GROUP BY taxon_id
    ) c ON c.taxon_id = t.id
  ),
  ranked AS (
    SELECT taxon_id, obs_count,
           CASE WHEN obs_count = 0 THEN 100.0
                ELSE 100.0 * (1.0 - percent_rank() OVER (ORDER BY obs_count DESC))
           END AS percentile
    FROM   counts
  ),
  bucketed AS (
    SELECT taxon_id, obs_count, percentile,
      CASE
        WHEN obs_count > 0 AND obs_count < 5 THEN 5
        WHEN percentile >= 90              THEN 1   -- top 10% common
        WHEN percentile >= 50              THEN 2   -- 50–90
        WHEN percentile >= 10              THEN 3   -- 10–50
        ELSE                                    4   -- bottom 10% (rarest)
      END AS bucket
    FROM ranked
  )
  INSERT INTO public.taxon_rarity AS tr (taxon_id, obs_count, percentile, bucket, multiplier, refreshed_at)
  SELECT taxon_id,
         obs_count,
         percentile,
         bucket,
         CASE bucket
           WHEN 1 THEN 1.0
           WHEN 2 THEN 1.5
           WHEN 3 THEN 2.5
           WHEN 4 THEN 4.0
           WHEN 5 THEN 5.0
         END,
         now()
  FROM   bucketed
  ON CONFLICT (taxon_id) DO UPDATE
    SET obs_count    = EXCLUDED.obs_count,
        percentile   = EXCLUDED.percentile,
        bucket       = EXCLUDED.bucket,
        multiplier   = EXCLUDED.multiplier,
        refreshed_at = EXCLUDED.refreshed_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.refresh_taxon_rarity() TO service_role;
```

- [ ] **Step 2: Apply and run once**

Run:
```bash
make db-apply
psql "$SUPABASE_DB_URL" -c "SELECT public.refresh_taxon_rarity();"
psql "$SUPABASE_DB_URL" -c "
SELECT bucket, count(*) AS taxa_in_bucket, round(avg(multiplier), 2) AS mult
FROM public.taxon_rarity
GROUP BY bucket
ORDER BY bucket;
"
```
Expected: rows for each bucket present (counts depend on your DB data; if `taxa` is small, bucket 5 may dominate).

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): refresh_taxon_rarity() — percentile buckets + multipliers"
```

---

## Task 5 — `pg_cron` schedule for nightly rarity refresh

**Files:**
- Modify: `docs/specs/infra/supabase-cron-schedules.sql`

- [ ] **Step 1: Add the cron entry**

Append (or insert near the existing entries):

```sql
-- Nightly rarity refresh — 03:00 UTC.
SELECT cron.unschedule('refresh-taxon-rarity-nightly')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'refresh-taxon-rarity-nightly'
  );

SELECT cron.schedule(
  'refresh-taxon-rarity-nightly',
  '0 3 * * *',
  $$ SELECT public.refresh_taxon_rarity(); $$
);
```

- [ ] **Step 2: Apply via Make target and assert**

Run:
```bash
make db-cron-schedule
psql "$SUPABASE_DB_URL" -c "
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'refresh-taxon-rarity-nightly';
"
```
Expected: one row, `schedule = '0 3 * * *'`, `active = t`.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-cron-schedules.sql
git commit -m "feat(cron): nightly refresh_taxon_rarity at 03:00 UTC"
```

---

## Task 6 — `award_karma()` helper function

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append)

- [ ] **Step 1: Add the function**

Append:

```sql
-- ============================================================
-- award_karma: insert a karma_events row + update users/user_expertise.
--   p_outcome ∈ ('win', 'loss')
--   p_confidence ∈ (0.5, 0.7, 0.9)  → confidence_factor (0.4, 0.7, 1.0)
-- ============================================================
CREATE OR REPLACE FUNCTION public.award_karma(
  p_user_id        uuid,
  p_observation_id uuid,
  p_taxon_id       uuid,
  p_outcome        text,
  p_confidence     numeric DEFAULT 0.7
)
RETURNS numeric AS $$
DECLARE
  v_rarity         public.taxon_rarity;
  v_obs_path       uuid[];
  v_matched_taxon  uuid;
  v_matched_rank   integer;
  v_streak_mult    numeric := 1.0;
  v_expertise_mult numeric := 1.0;
  v_conf_factor    numeric;
  v_grace          boolean;
  v_user           public.users;
  v_delta          numeric;
  v_penalty_rarity numeric;
BEGIN
  -- Confidence → factor.
  v_conf_factor := CASE
    WHEN p_confidence >= 0.85 THEN 1.0
    WHEN p_confidence >= 0.65 THEN 0.7
    ELSE                            0.4
  END;

  -- Rarity. Falls back to 1.0× if not yet materialized.
  SELECT * INTO v_rarity FROM public.taxon_rarity WHERE taxon_id = p_taxon_id;
  IF NOT FOUND THEN
    v_rarity.multiplier := 1.0;
    v_rarity.bucket     := 1;
  END IF;

  -- Observation taxon's ancestor_path = self || ancestors.
  SELECT array_prepend(t.id, t.ancestor_path)
    INTO v_obs_path
    FROM public.taxa t
   WHERE t.id = p_taxon_id;

  -- User's most-specific expertise that is in the observation lineage.
  SELECT ue.taxon_id, array_position(v_obs_path, ue.taxon_id)
    INTO v_matched_taxon, v_matched_rank
    FROM public.user_expertise ue
   WHERE ue.user_id = p_user_id
     AND ue.taxon_id = ANY(v_obs_path)
   ORDER BY array_position(v_obs_path, ue.taxon_id) ASC
   LIMIT 1;

  -- Verified expert in the matched ancestor → multiplier bump.
  IF v_matched_taxon IS NOT NULL THEN
    SELECT 1.5
      INTO v_expertise_mult
      FROM public.user_expertise
     WHERE user_id = p_user_id
       AND taxon_id = v_matched_taxon
       AND verified_at IS NOT NULL;
    IF v_expertise_mult IS NULL THEN v_expertise_mult := 1.0; END IF;
  END IF;

  -- Streak multiplier (reads existing user_streaks).
  SELECT CASE
           WHEN current_streak >= 30 THEN 1.5
           WHEN current_streak >=  7 THEN 1.2
           ELSE                            1.0
         END
    INTO v_streak_mult
    FROM public.user_streaks
   WHERE user_id = p_user_id;
  IF v_streak_mult IS NULL THEN v_streak_mult := 1.0; END IF;

  -- Grace check.
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
  v_grace := (v_user.grace_until IS NOT NULL
              AND v_user.grace_until > now()
              AND COALESCE(v_user.vote_count, 0) < 20);

  -- Delta computation.
  IF p_outcome = 'win' THEN
    v_delta := 5 * v_rarity.multiplier * v_streak_mult * v_expertise_mult * v_conf_factor;
  ELSIF p_outcome = 'loss' THEN
    IF v_grace THEN
      v_delta := 0;
    ELSE
      v_penalty_rarity := LEAST(v_rarity.multiplier, 2.0);
      v_delta := -2 * v_penalty_rarity * v_conf_factor;
    END IF;
  ELSE
    RAISE EXCEPTION 'award_karma: invalid p_outcome %', p_outcome;
  END IF;

  -- Insert ledger row.
  INSERT INTO public.karma_events
    (user_id, observation_id, taxon_id, delta, reason,
     rarity_bucket, expertise_rank)
  VALUES
    (p_user_id, p_observation_id, p_taxon_id, v_delta,
     CASE WHEN p_outcome = 'win' THEN 'consensus_win' ELSE 'consensus_loss' END,
     v_rarity.bucket, v_matched_rank);

  -- Update user totals + vote counter.
  UPDATE public.users
     SET karma_total      = karma_total + v_delta,
         karma_updated_at = now(),
         vote_count       = COALESCE(vote_count, 0) + 1
   WHERE id = p_user_id;

  -- Wins also accrue per-taxon expertise on the matched ancestor (or
  -- on the kingdom of the observation if no expertise existed yet).
  IF p_outcome = 'win' AND v_delta > 0 THEN
    IF v_matched_taxon IS NOT NULL THEN
      UPDATE public.user_expertise
         SET score = score + v_delta,
             updated_at = now()
       WHERE user_id = p_user_id AND taxon_id = v_matched_taxon;
    ELSE
      INSERT INTO public.user_expertise (user_id, taxon_id, score)
      SELECT p_user_id,
             COALESCE(v_obs_path[array_length(v_obs_path, 1)], p_taxon_id),
             v_delta
      ON CONFLICT (user_id, taxon_id) DO UPDATE
         SET score = public.user_expertise.score + EXCLUDED.score,
             updated_at = now();
    END IF;
  END IF;

  RETURN v_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.award_karma(uuid, uuid, uuid, text, numeric) TO service_role;
```

- [ ] **Step 2: Apply and unit-test the function in psql**

Run:
```bash
make db-apply
psql "$SUPABASE_DB_URL" <<'SQL'
BEGIN;
DO $$
DECLARE
  uid uuid; oid uuid; tid uuid; delta numeric;
BEGIN
  -- Pick any test user + observation + taxon; create if needed.
  SELECT id INTO uid FROM public.users LIMIT 1;
  SELECT id INTO oid FROM public.observations LIMIT 1;
  SELECT id INTO tid FROM public.taxa LIMIT 1;

  IF uid IS NULL OR oid IS NULL OR tid IS NULL THEN
    RAISE NOTICE 'Skipping award_karma smoke — empty fixtures';
    RETURN;
  END IF;

  delta := public.award_karma(uid, oid, tid, 'win', 0.9);
  RAISE NOTICE 'win delta = %', delta;
  delta := public.award_karma(uid, oid, tid, 'loss', 0.7);
  RAISE NOTICE 'loss delta = %', delta;
END $$;
ROLLBACK;
SQL
```
Expected: NOTICE lines show `win delta = 5.0` (or higher with rarity/streak) and `loss delta` is negative or `0` if user is in grace.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): award_karma() — delta + ledger + expertise update"
```

---

## Task 7 — Extend `recompute_consensus()` to call `award_karma()`

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (replace existing `recompute_consensus` block in-place via `CREATE OR REPLACE`)

- [ ] **Step 1: Append the replacement function**

Append AFTER all previous module-23 blocks (so it's the last definition Postgres sees):

```sql
-- ============================================================
-- recompute_consensus — replaced to (a) keep existing weighted
-- aggregation + research-grade promotion, (b) award karma deltas
-- to all voters when consensus actually changed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_consensus(p_observation_id uuid)
RETURNS void AS $$
DECLARE
  winning_taxon  uuid;
  winning_score  numeric;
  validator_count integer;
  prev_research_grade boolean;
  was_promoted   boolean := false;
  v_voter        record;
  v_winner_rank  integer;
  v_voter_rank   integer;
  v_obs_path     uuid[];
  v_outcome      text;
BEGIN
  -- Existing aggregation (unchanged behavior at the top, expertise-aware
  -- weighting now reads user_expertise rather than is_expert kingdom).
  WITH weighted AS (
    SELECT i.taxon_id,
           SUM(
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM public.user_expertise ue
                 WHERE ue.user_id = i.validated_by
                   AND ue.taxon_id = ANY(
                     SELECT array_prepend(t.id, t.ancestor_path)
                     FROM public.taxa t WHERE t.id = i.taxon_id
                   )
               )
               THEN 3.0
               ELSE 1.0
             END
           ) AS score,
           count(DISTINCT i.validated_by) AS validators
    FROM   public.identifications i
    WHERE  i.observation_id = p_observation_id
      AND  i.taxon_id IS NOT NULL
      AND  i.validated_by IS NOT NULL
    GROUP BY i.taxon_id
  )
  SELECT taxon_id, score, validators
    INTO winning_taxon, winning_score, validator_count
    FROM weighted
   ORDER BY score DESC
   LIMIT 1;

  IF winning_taxon IS NULL THEN RETURN; END IF;

  -- Tie guard (existing behavior).
  IF (
    SELECT count(*) FROM (
      SELECT i.taxon_id,
             SUM(CASE
                   WHEN EXISTS (
                     SELECT 1 FROM public.user_expertise ue
                     WHERE ue.user_id = i.validated_by
                       AND ue.taxon_id = ANY(
                         SELECT array_prepend(t.id, t.ancestor_path)
                         FROM public.taxa t WHERE t.id = i.taxon_id
                       )
                   )
                   THEN 3.0
                   ELSE 1.0
                 END) AS s
      FROM public.identifications i
      WHERE i.observation_id = p_observation_id
        AND i.taxon_id IS NOT NULL
        AND i.validated_by IS NOT NULL
      GROUP BY i.taxon_id
    ) sub
    WHERE sub.s = winning_score
  ) > 1 THEN
    RETURN;  -- tie blocks promotion AND blocks karma awards
  END IF;

  -- Read previous research-grade state.
  SELECT COALESCE(bool_or(is_research_grade), false)
    INTO prev_research_grade
    FROM public.identifications
   WHERE observation_id = p_observation_id AND is_primary;

  -- Promote if eligible.
  IF winning_score >= 2.0 AND validator_count >= 2 THEN
    UPDATE public.identifications
       SET is_research_grade = true
     WHERE observation_id = p_observation_id
       AND taxon_id = winning_taxon
       AND is_primary;
    was_promoted := NOT prev_research_grade;
  END IF;

  -- Karma is only awarded when consensus actually crossed into research-grade
  -- on this call. Repeat calls without a state change are no-ops.
  IF NOT was_promoted THEN RETURN; END IF;

  -- Determine the winning voter's expertise rank in the lineage of winning_taxon
  -- (used to decide which losing voters got beaten by a deeper expert).
  SELECT array_prepend(t.id, t.ancestor_path)
    INTO v_obs_path
    FROM public.taxa t
   WHERE t.id = winning_taxon;

  SELECT MIN(array_position(v_obs_path, ue.taxon_id))
    INTO v_winner_rank
    FROM public.identifications i
    JOIN public.user_expertise ue ON ue.user_id = i.validated_by
   WHERE i.observation_id = p_observation_id
     AND i.taxon_id = winning_taxon
     AND ue.taxon_id = ANY(v_obs_path);

  -- For each distinct voter on this observation, award karma.
  FOR v_voter IN
    SELECT DISTINCT i.validated_by AS user_id, i.taxon_id, i.confidence
    FROM   public.identifications i
    WHERE  i.observation_id = p_observation_id
      AND  i.validated_by IS NOT NULL
  LOOP
    IF v_voter.taxon_id = winning_taxon THEN
      v_outcome := 'win';
    ELSE
      -- Loss only counts if SOME winning-side voter has a deeper expertise
      -- in this lineage than this voter. Otherwise it was a peer disagreement
      -- and we silently skip the karma update.
      SELECT MIN(array_position(v_obs_path, ue.taxon_id))
        INTO v_voter_rank
        FROM public.user_expertise ue
       WHERE ue.user_id = v_voter.user_id
         AND ue.taxon_id = ANY(v_obs_path);

      IF v_voter_rank IS NULL OR (v_winner_rank IS NOT NULL AND v_winner_rank < v_voter_rank) THEN
        v_outcome := 'loss';
      ELSE
        CONTINUE;
      END IF;
    END IF;

    PERFORM public.award_karma(
      v_voter.user_id,
      p_observation_id,
      winning_taxon,
      v_outcome,
      COALESCE(v_voter.confidence, 0.7)
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recompute_consensus(uuid) TO service_role;
```

- [ ] **Step 2: Apply and integration-test end-to-end**

Run:
```bash
make db-apply
psql "$SUPABASE_DB_URL" <<'SQL'
BEGIN;
-- Pick or create fixtures. Force a 2-distinct-voter, expert-vs-novice consensus.
-- This is a smoke test only — adjust IDs to match your fixtures.
DO $$
DECLARE
  uid_expert uuid; uid_novice uuid; oid uuid; tid_winner uuid;
  delta_expert numeric; karma_before_expert numeric; karma_before_novice numeric;
BEGIN
  SELECT id INTO uid_expert FROM public.users WHERE is_expert LIMIT 1;
  SELECT id INTO uid_novice FROM public.users WHERE NOT COALESCE(is_expert,false) AND id <> uid_expert LIMIT 1;
  SELECT id INTO oid FROM public.observations LIMIT 1;
  SELECT id INTO tid_winner FROM public.taxa LIMIT 1;

  IF uid_expert IS NULL OR uid_novice IS NULL OR oid IS NULL OR tid_winner IS NULL THEN
    RAISE NOTICE 'Skipping integration smoke — insufficient fixtures'; RETURN;
  END IF;

  SELECT karma_total INTO karma_before_expert FROM public.users WHERE id = uid_expert;
  SELECT karma_total INTO karma_before_novice FROM public.users WHERE id = uid_novice;

  PERFORM public.recompute_consensus(oid);
  RAISE NOTICE 'expert delta = %', (SELECT karma_total FROM public.users WHERE id = uid_expert) - karma_before_expert;
  RAISE NOTICE 'novice delta = %', (SELECT karma_total FROM public.users WHERE id = uid_novice) - karma_before_novice;
END $$;
ROLLBACK;
SQL
```
Expected: NOTICE lines fire; `karma_events` rows visible if the smoke fixtures actually trigger a research-grade flip. (If your DB doesn't have the right pre-existing identifications, this is a no-op — that's fine for smoke; the unit assertions in psql cover the math.)

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): recompute_consensus awards karma + uses user_expertise weights"
```

---

## Task 8 — `src/lib/karma.ts` (pure helpers + Vitest)

**Files:**
- Create: `src/lib/karma.ts`
- Create: `tests/unit/karma.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/karma.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  rarityTier,
  microcopyForVote,
  formatDelta,
  RARITY_BUCKETS,
} from '../../src/lib/karma';

describe('rarityTier', () => {
  it('returns 1 star for bucket 1 (most common)', () => {
    expect(rarityTier(1)).toBe('★');
  });
  it('returns 5 stars for bucket 5 (ultra-rare)', () => {
    expect(rarityTier(5)).toBe('★★★★★');
  });
});

describe('formatDelta', () => {
  it('prepends + on positive', () => {
    expect(formatDelta(5)).toBe('+5');
  });
  it('shows negative as-is', () => {
    expect(formatDelta(-2)).toBe('-2');
  });
  it('rounds to nearest int', () => {
    expect(formatDelta(4.6)).toBe('+5');
  });
});

describe('microcopyForVote', () => {
  it('renders standard line for non-grace user', () => {
    const txt = microcopyForVote({
      lang: 'en',
      bucket: 3,
      multiplier: 2.5,
      expertiseLevel: 'Plantae',
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: false,
    });
    expect(txt).toContain('★★★');
    expect(txt).toContain('1.0×');
    expect(txt).toContain('+13');   // 5 × 2.5 × 1.0 × 1.0 × 1.0
    expect(txt).toContain('-4');    // -2 × min(2.5,2) × 1.0 = -4
  });

  it('renders grace copy when in grace period', () => {
    const txt = microcopyForVote({
      lang: 'es',
      bucket: 1,
      multiplier: 1.0,
      expertiseLevel: null,
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: true,
      graceDaysLeft: 24,
    });
    expect(txt).toMatch(/aprendizaje/i);
    expect(txt).toContain('24');
    expect(txt).not.toMatch(/-/);  // no penalty mention in grace
  });

  it('exposes RARITY_BUCKETS as a stable array of 5', () => {
    expect(RARITY_BUCKETS).toHaveLength(5);
    expect(RARITY_BUCKETS[0].multiplier).toBe(1.0);
    expect(RARITY_BUCKETS[4].multiplier).toBe(5.0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
npx vitest run tests/unit/karma.test.ts
```
Expected: ALL tests fail with "Cannot find module '../../src/lib/karma'".

- [ ] **Step 3: Implement `src/lib/karma.ts`**

Create `src/lib/karma.ts`:

```ts
export type Bucket = 1 | 2 | 3 | 4 | 5;

export interface RarityBucket {
  bucket: Bucket;
  multiplier: number;
  label_en: string;
  label_es: string;
}

export const RARITY_BUCKETS: readonly RarityBucket[] = [
  { bucket: 1, multiplier: 1.0, label_en: 'common',     label_es: 'común' },
  { bucket: 2, multiplier: 1.5, label_en: 'frequent',   label_es: 'frecuente' },
  { bucket: 3, multiplier: 2.5, label_en: 'uncommon',   label_es: 'poco común' },
  { bucket: 4, multiplier: 4.0, label_en: 'rare',       label_es: 'raro' },
  { bucket: 5, multiplier: 5.0, label_en: 'ultra-rare', label_es: 'rarísimo' },
] as const;

export function rarityTier(bucket: Bucket): string {
  return '★'.repeat(bucket);
}

export function formatDelta(n: number): string {
  const r = Math.round(n);
  return r >= 0 ? `+${r}` : String(r);
}

export interface VoteMicrocopyInput {
  lang: 'en' | 'es';
  bucket: Bucket;
  multiplier: number;
  expertiseLevel: string | null;       // human-readable taxon name (e.g., "Plantae", "Quercus")
  expertiseWeight: number;             // 1.0 for non-expert, 3.0 for expert in matched lineage
  streakMultiplier: number;            // 1.0 / 1.2 / 1.5
  confidence: 0.5 | 0.7 | 0.9;
  inGrace: boolean;
  graceDaysLeft?: number;
}

export function microcopyForVote(i: VoteMicrocopyInput): string {
  const stars = rarityTier(i.bucket);
  const confFactor = i.confidence >= 0.85 ? 1.0 : i.confidence >= 0.65 ? 0.7 : 0.4;
  const win = 5 * i.multiplier * i.streakMultiplier * confFactor;
  const lossRarity = Math.min(i.multiplier, 2.0);
  const loss = -2 * lossRarity * confFactor;

  if (i.inGrace) {
    if (i.lang === 'es') {
      return `🎓 Estás en periodo de aprendizaje (${i.graceDaysLeft ?? '?'} días restantes) — votar no resta karma.`;
    }
    return `🎓 You're in your learning period (${i.graceDaysLeft ?? '?'} days left) — losses do not subtract karma.`;
  }

  const level = i.expertiseLevel ?? (i.lang === 'es' ? 'sin especialidad' : 'no expertise');
  if (i.lang === 'es') {
    return `Rareza ${stars} — tu voto pesa ${i.expertiseWeight.toFixed(1)}× en ${level} · acertar: ${formatDelta(win)} / fallar: ${formatDelta(loss)}.`;
  }
  return `Rarity ${stars} — your vote weighs ${i.expertiseWeight.toFixed(1)}× in ${level} · win: ${formatDelta(win)} / lose: ${formatDelta(loss)}.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run tests/unit/karma.test.ts
```
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/karma.ts tests/unit/karma.test.ts
git commit -m "feat(lib): karma helpers — rarityTier, formatDelta, microcopyForVote"
```

---

## Task 9 — Suggest modal pre-vote microcopy

**Files:**
- Modify: `src/components/SuggestIdModal.astro`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/en.json`, under the existing `validation` block, add:

```json
"karma_microcopy_loading": "Loading vote weight…",
"karma_microcopy_unavailable": "Vote weighting will be visible after first save."
```

In `src/i18n/es.json`, mirror:

```json
"karma_microcopy_loading": "Cargando peso de voto…",
"karma_microcopy_unavailable": "El peso de tu voto aparecerá tras tu primera guardada."
```

- [ ] **Step 2: Add the microcopy slot to the modal markup**

In `src/components/SuggestIdModal.astro`, locate the existing `<p id="suggest-id-target">` line (around line 44) and add directly below it:

```astro
<p id="suggest-id-microcopy" class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
  {v.karma_microcopy_loading}
</p>
```

- [ ] **Step 3: Hydrate microcopy in the modal's script block**

In the same file, inside the existing `<script>` block, add this NEW import + hydration logic just below the existing `import { getSupabase } from '../lib/supabase';` line:

```ts
import { microcopyForVote, type Bucket } from '../lib/karma';

const microcopyEl = document.getElementById('suggest-id-microcopy') as HTMLElement | null;
const isEs = document.documentElement.lang === 'es';

async function refreshMicrocopy(taxonId: string | null, confidence: 0.5 | 0.7 | 0.9) {
  if (!microcopyEl) return;
  if (!taxonId) {
    microcopyEl.textContent = isEs
      ? 'El peso de tu voto aparecerá cuando elijas una especie.'
      : 'Vote weight appears once you pick a species.';
    return;
  }
  try {
    const supabase = getSupabase();
    const [{ data: rarity }, { data: { user } }] = await Promise.all([
      supabase.from('taxon_rarity').select('bucket, multiplier').eq('taxon_id', taxonId).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    let inGrace = false;
    let graceDaysLeft: number | undefined;
    let expertiseLevel: string | null = null;
    let expertiseWeight = 1.0;
    let streakMultiplier = 1.0;
    if (user) {
      const { data: u } = await supabase
        .from('users')
        .select('grace_until, vote_count')
        .eq('id', user.id).maybeSingle();
      if (u?.grace_until && new Date(u.grace_until) > new Date() && (u.vote_count ?? 0) < 20) {
        inGrace = true;
        graceDaysLeft = Math.max(0, Math.ceil(
          (new Date(u.grace_until).getTime() - Date.now()) / 86400000));
      }
      const { data: streak } = await supabase
        .from('user_streaks').select('current_streak').eq('user_id', user.id).maybeSingle();
      const cs = streak?.current_streak ?? 0;
      streakMultiplier = cs >= 30 ? 1.5 : cs >= 7 ? 1.2 : 1.0;
      // expertise lookup is deferred — first version shows "no expertise yet"; in
      // a follow-up we wire ancestor_path lookup. Leaving expertiseLevel null for v1.
    }
    const bucket = (rarity?.bucket ?? 1) as Bucket;
    const multiplier = rarity?.multiplier ?? 1.0;
    microcopyEl.textContent = microcopyForVote({
      lang: isEs ? 'es' : 'en',
      bucket,
      multiplier,
      expertiseLevel,
      expertiseWeight,
      streakMultiplier,
      confidence,
      inGrace,
      graceDaysLeft,
    });
  } catch {
    microcopyEl.textContent = isEs
      ? 'No se pudo calcular el peso de voto — guardar igual funciona.'
      : 'Could not compute vote weight — saving still works.';
  }
}

// Re-render when species selection changes or confidence changes.
nameInput?.addEventListener('change', () => {
  const opt = datalist?.querySelector<HTMLOptionElement>(`option[value="${nameInput?.value}"]`);
  const taxonId = opt?.dataset.id ?? null;
  const confEl = form?.querySelector<HTMLInputElement>('input[name="confidence"]:checked');
  const conf = (Number(confEl?.value ?? 0.9)) as 0.5 | 0.7 | 0.9;
  void refreshMicrocopy(taxonId, conf);
});
form?.querySelectorAll<HTMLInputElement>('input[name="confidence"]').forEach((r) => {
  r.addEventListener('change', () => {
    const opt = datalist?.querySelector<HTMLOptionElement>(`option[value="${nameInput?.value}"]`);
    const taxonId = opt?.dataset.id ?? null;
    void refreshMicrocopy(taxonId, Number(r.value) as 0.5 | 0.7 | 0.9);
  });
});

// Initial render — empty state until user picks a species.
void refreshMicrocopy(null, 0.9);
```

(Place this block AFTER the existing `if (modal && form && submitBtn && submitLabel) { ... }` block, OUTSIDE that conditional so it runs even if the main modal logic was guarded — alternatively, move it inside near the top of that block. Inside is cleaner.)

- [ ] **Step 4: Build and typecheck**

Run:
```bash
npm run typecheck
npm run build
```
Expected: zero TS errors, build succeeds.

- [ ] **Step 5: Smoke-render the modal in dev**

Run:
```bash
make dev
```
Open http://localhost:4321/share/obs/?id=any-real-uuid in browser; click "Suggest identification" if visible; the microcopy should display the empty-state line. Picking a species should change the line. (If you're the observation owner, the suggest button is hidden by design — test with a different observation or a guest browser.)

- [ ] **Step 6: Commit**

```bash
git add src/components/SuggestIdModal.astro src/i18n/en.json src/i18n/es.json
git commit -m "feat(suggest-modal): pre-vote rarity + magnitudes microcopy"
```

---

## Task 10 — Profile karma section

**Files:**
- Modify: `src/components/ProfileView.astro`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/en.json`, append a new top-level block:

```json
"karma": {
  "section_title": "Karma & expertise",
  "total_label": "Total karma",
  "weekly_delta": "{n} this week",
  "next_threshold": "{n} to next milestone",
  "expertise_heading": "Top taxa",
  "expertise_empty": "No specialization yet — start observing to build it.",
  "verified_badge": "verified",
  "rank_in_region": "rank {n} in {region}"
}
```

Mirror in `src/i18n/es.json`:

```json
"karma": {
  "section_title": "Karma y especialidad",
  "total_label": "Karma total",
  "weekly_delta": "{n} esta semana",
  "next_threshold": "{n} para siguiente nivel",
  "expertise_heading": "Top taxones",
  "expertise_empty": "Aún sin especialidad — observa para construirla.",
  "verified_badge": "verificado",
  "rank_in_region": "ranking {n} en {region}"
}
```

- [ ] **Step 2: Add the section to `ProfileView.astro`**

Read the existing file to find a good insertion point (after the streak card, before the badges grid). Add this block:

```astro
<section id="karma-section" class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 space-y-3">
  <h2 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
    {tr.karma.section_title}
  </h2>
  <div class="flex items-baseline gap-3">
    <span id="karma-total" class="text-3xl font-bold text-emerald-700 dark:text-emerald-400">—</span>
    <span class="text-xs text-zinc-500 dark:text-zinc-400">{tr.karma.total_label}</span>
    <span id="karma-weekly" class="ml-auto text-xs font-medium text-emerald-700 dark:text-emerald-400"></span>
  </div>
  <div>
    <h3 class="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">{tr.karma.expertise_heading}</h3>
    <ul id="karma-expertise-list" class="space-y-1 text-sm">
      <li class="text-xs text-zinc-500 italic">{tr.karma.expertise_empty}</li>
    </ul>
  </div>
</section>
```

- [ ] **Step 3: Add the hydration script**

Append a new `<script>` block to `ProfileView.astro` (or extend the existing one):

```ts
import { getSupabase } from '../lib/supabase';
import { formatDelta } from '../lib/karma';

(async function hydrateKarma() {
  const totalEl   = document.getElementById('karma-total');
  const weeklyEl  = document.getElementById('karma-weekly');
  const listEl    = document.getElementById('karma-expertise-list') as HTMLUListElement | null;
  if (!totalEl || !listEl) return;

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const [{ data: u }, { data: events }, { data: expertise }] = await Promise.all([
    supabase.from('users').select('karma_total').eq('id', user.id).maybeSingle(),
    supabase.from('karma_events')
      .select('delta, created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    supabase.from('user_expertise')
      .select('taxon_id, score, verified_at, taxa(scientific_name)')
      .eq('user_id', user.id)
      .order('score', { ascending: false })
      .limit(5),
  ]);

  totalEl.textContent = String(Math.round(u?.karma_total ?? 0));
  const weekly = (events ?? []).reduce((acc, e) => acc + Number(e.delta), 0);
  if (weeklyEl) weeklyEl.textContent = weekly !== 0 ? formatDelta(weekly) : '';

  const rows = (expertise ?? []) as Array<{
    taxon_id: string; score: number; verified_at: string | null;
    taxa: { scientific_name: string } | { scientific_name: string }[] | null;
  }>;
  if (rows.length > 0) {
    listEl.innerHTML = rows.map((r) => {
      const tx = Array.isArray(r.taxa) ? r.taxa[0] : r.taxa;
      const name = tx?.scientific_name ?? '—';
      const ver = r.verified_at
        ? '<span class="ml-1 text-emerald-700 dark:text-emerald-400" title="verified">✓</span>'
        : '';
      return `<li class="flex items-center gap-2"><span class="italic">${name}</span>${ver}<span class="ml-auto font-mono text-xs">${Math.round(r.score)}</span></li>`;
    }).join('');
  }
})();
```

- [ ] **Step 4: Typecheck + build**

Run:
```bash
npm run typecheck
npm run build
```
Expected: zero errors.

- [ ] **Step 5: Visual smoke**

Run `make dev`, sign in, visit `/en/profile/`, confirm the karma section renders and (if the user has karma_events rows) shows a weekly delta. New users see karma_total = 0 with empty expertise list.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProfileView.astro src/i18n/en.json src/i18n/es.json
git commit -m "feat(profile): karma + top-5 expertise section"
```

---

## Task 11 — Pokédex page

**Files:**
- Create: `src/components/PokedexView.astro`
- Create: `src/pages/en/profile/dex/index.astro`
- Create: `src/pages/es/perfil/dex/index.astro`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/utils.ts`

- [ ] **Step 1: Add the dex route to `i18n/utils.ts`**

Locate the `routes` object in `src/i18n/utils.ts` and add:

```ts
dex: { en: '/profile/dex', es: '/perfil/dex' },
```

Add the corresponding `routeTree` entry if your file uses one (otherwise skip).

- [ ] **Step 2: Add i18n keys**

In `src/i18n/en.json`, append:

```json
"pokedex": {
  "title": "Your Pokédex",
  "subtitle": "Every species you've observed or correctly identified.",
  "empty": "No species yet — log your first observation to start the dex.",
  "rarity_label": "Rarity",
  "first_seen": "First seen",
  "count_one": "{n} observation",
  "count_other": "{n} observations"
}
```

In `src/i18n/es.json`:

```json
"pokedex": {
  "title": "Tu Pokédex",
  "subtitle": "Cada especie que has observado o identificado correctamente.",
  "empty": "Aún no hay especies — registra tu primera observación para abrir el dex.",
  "rarity_label": "Rareza",
  "first_seen": "Primera vez",
  "count_one": "{n} observación",
  "count_other": "{n} observaciones"
}
```

- [ ] **Step 3: Create `PokedexView.astro`**

Create `src/components/PokedexView.astro`:

```astro
---
import type { Locale } from '../i18n/utils';
import { t } from '../i18n/utils';

interface Props { lang: Locale }
const { lang } = Astro.props;
const tr = t(lang);
const px = (tr as unknown as { pokedex: Record<string, string> }).pokedex;
---

<section class="max-w-5xl mx-auto px-4 py-6">
  <header class="mb-5">
    <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
      {px.title}
    </h1>
    <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{px.subtitle}</p>
  </header>

  <p id="pokedex-loading" class="text-sm text-zinc-500 text-center py-8">…</p>
  <p id="pokedex-empty"   class="hidden text-sm text-zinc-500 text-center py-8 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">{px.empty}</p>

  <ul id="pokedex-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"></ul>
</section>

<script>
  import { getSupabase } from '../lib/supabase';
  import { rarityTier, type Bucket } from '../lib/karma';

  const grid    = document.getElementById('pokedex-grid');
  const loading = document.getElementById('pokedex-loading');
  const empty   = document.getElementById('pokedex-empty');
  const isEs    = document.documentElement.lang === 'es';

  (async function () {
    if (!grid) return;
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      loading?.classList.add('hidden');
      empty?.classList.remove('hidden');
      return;
    }
    const { data } = await supabase
      .from('observations')
      .select(`
        observed_at,
        identifications!inner(scientific_name, taxon_id, is_primary)
      `)
      .eq('observer_id', user.id)
      .eq('identifications.is_primary', true)
      .order('observed_at', { ascending: false });
    const rows = (data ?? []) as Array<{
      observed_at: string;
      identifications: { scientific_name: string; taxon_id: string; is_primary: boolean }[];
    }>;
    const byTaxon = new Map<string, { name: string; first: string; count: number }>();
    for (const r of rows) {
      for (const id of r.identifications) {
        const prev = byTaxon.get(id.taxon_id);
        if (prev) { prev.count++; if (r.observed_at < prev.first) prev.first = r.observed_at; }
        else byTaxon.set(id.taxon_id, { name: id.scientific_name, first: r.observed_at, count: 1 });
      }
    }
    if (byTaxon.size === 0) {
      loading?.classList.add('hidden');
      empty?.classList.remove('hidden');
      return;
    }
    const taxonIds = Array.from(byTaxon.keys());
    const { data: rarity } = await supabase
      .from('taxon_rarity').select('taxon_id, bucket').in('taxon_id', taxonIds);
    const rarityMap = new Map<string, Bucket>();
    for (const r of (rarity ?? []) as Array<{ taxon_id: string; bucket: number }>) {
      rarityMap.set(r.taxon_id, (r.bucket as Bucket) ?? 1);
    }
    grid.innerHTML = Array.from(byTaxon.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([taxonId, v]) => {
        const stars = rarityTier(rarityMap.get(taxonId) ?? 1);
        const date = new Date(v.first).toLocaleDateString();
        const countLabel = v.count === 1
          ? (isEs ? `${v.count} observación` : `${v.count} observation`)
          : (isEs ? `${v.count} observaciones` : `${v.count} observations`);
        return `<li class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-3 text-sm">
          <div class="font-medium italic text-emerald-700 dark:text-emerald-400">${v.name}</div>
          <div class="mt-1 text-xs text-zinc-500">${stars} · ${countLabel}</div>
          <div class="text-[11px] text-zinc-400 mt-0.5">${date}</div>
        </li>`;
      }).join('');
    loading?.classList.add('hidden');
  })();
</script>
```

- [ ] **Step 4: Create the locale-paired pages**

Create `src/pages/en/profile/dex/index.astro`:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
import PokedexView from '../../../../components/PokedexView.astro';
const lang = 'en' as const;
---
<BaseLayout title="Your Pokédex — Rastrum" description="Every species you've observed or identified." lang={lang}>
  <PokedexView lang={lang} />
</BaseLayout>
```

Create `src/pages/es/perfil/dex/index.astro`:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
import PokedexView from '../../../../components/PokedexView.astro';
const lang = 'es' as const;
---
<BaseLayout title="Tu Pokédex — Rastrum" description="Cada especie que has observado o identificado." lang={lang}>
  <PokedexView lang={lang} />
</BaseLayout>
```

- [ ] **Step 5: Build and verify both pages render**

Run:
```bash
npm run build
ls dist/en/profile/dex/index.html dist/es/perfil/dex/index.html
```
Expected: both files exist.

- [ ] **Step 6: Commit**

```bash
git add src/components/PokedexView.astro \
       src/pages/en/profile/dex/index.astro \
       src/pages/es/perfil/dex/index.astro \
       src/i18n/en.json src/i18n/es.json src/i18n/utils.ts
git commit -m "feat(profile): Pokédex page (locale-paired) — observed-species grid with rarity"
```

---

## Task 12 — Module 23 spec doc + roadmap

**Files:**
- Create: `docs/specs/modules/23-karma-expertise-rarity.md`
- Modify: `docs/specs/modules/00-index.md`
- Modify: `docs/specs/modules/22-community-validation.md`
- Modify: `docs/progress.json`
- Modify: `docs/tasks.json`

- [ ] **Step 1: Create the module 23 spec**

Create `docs/specs/modules/23-karma-expertise-rarity.md` with this content (a module-spec-flavored summary that points to the design doc):

```markdown
# Module 23 — Karma, Per-Taxon Expertise, and Rarity Multiplier

**Status:** Phase 1 implemented · Phases 2–3 deferred
**Implements:** the v1.2 future-work line in module 22 (weighted votes by reputation).

## Summary

A continuous reputation system layered on top of module 22's community
validation engine. Three signals:

1. **karma_total** — global score, gates platform privileges over time.
2. **user_expertise(user_id, taxon_id, score)** — per-taxon score that
   replaces the binary `users.is_expert + expert_taxa` weighting in
   `recompute_consensus`. Granularity is rank-aware (kingdom →
   species) via `taxa.ancestor_path` array overlap.
3. **taxon_rarity(bucket, multiplier)** — nightly-materialized
   percentile buckets that scale rewards (rarer = more karma).

## Reward formula

`win_delta  =  +5  ×  rarity_multiplier  ×  streak_multiplier  ×  expertise_multiplier  ×  confidence_factor`
`loss_delta =  −2  ×  min(rarity_multiplier, 2.0)  ×  confidence_factor`

Loss only fires when a deeper-expertise voter wins consensus.
Users in their first 30 days OR first 20 votes are penalty-immune
(grace period).

## Data model (additive)

- New tables: `user_expertise`, `taxon_rarity`, `karma_events`.
- New columns: `users.karma_total`, `users.karma_updated_at`,
  `users.grace_until`, `users.vote_count`, `taxa.ancestor_path uuid[]`.
- New functions: `compute_ancestor_path()`, `taxa_set_ancestor_path()`,
  `refresh_taxon_rarity()`, `award_karma()`. Replaced:
  `recompute_consensus()` (uses user_expertise instead of is_expert).
- New cron: `refresh-taxon-rarity-nightly` at 03:00 UTC.

## Backwards compatibility

`users.is_expert` and `users.expert_taxa` remain readable. A migration
shim hydrates `user_expertise` from these columns at apply time. The
columns will be dropped one release cycle after Phase 1 ships.

## Performance

Per consensus event: ~10–20 ms added (rarity lookup + ancestor_path
overlap + ledger insert + user/expertise update). Storage at 10k-user
scale: ~500 MB/year. No new Edge Functions in v1; weekly digest lands
in Phase 2.

## See also

- Full design rationale + UX decisions:
  `docs/superpowers/specs/2026-04-27-karma-expertise-rarity-design.md`
- Phase 1 implementation plan:
  `docs/superpowers/plans/2026-04-27-karma-expertise-rarity-phase-1.md`
- Module 22 (consensus engine, expertise weight integration point):
  `docs/specs/modules/22-community-validation.md`
```

- [ ] **Step 2: Register module 23 in the index**

In `docs/specs/modules/00-index.md`, locate the most recent entries and append a row referencing `23-karma-expertise-rarity.md`. Use the same formatting style as the existing rows (do not invent a new format).

- [ ] **Step 3: Update module 22 cross-link**

In `docs/specs/modules/22-community-validation.md`, find the line containing `v1.2: weighted votes by reputation score`. Replace it with:

```markdown
- v1.2: realized as Module 23 (karma + per-taxon expertise + rarity).
  See `23-karma-expertise-rarity.md`.
```

- [ ] **Step 4: Add roadmap entries**

In `docs/progress.json`, add three items (one per phase) with bilingual labels. Find the most recent phase block (`v1.x` or wherever community-validation entries live) and append:

```json
{
  "id": "karma-phase-1-foundation",
  "label": "Karma engine — schema, computation, basic UI (Phase 1)",
  "label_es": "Motor de karma — esquema, cómputo, UI base (Fase 1)",
  "status": "in_progress"
},
{
  "id": "karma-phase-2-engagement",
  "label": "Karma engagement layers — toast, digest, leaderboards (Phase 2)",
  "label_es": "Capas de engagement — notificaciones, resumen, leaderboards (Fase 2)",
  "status": "pending"
},
{
  "id": "karma-phase-3-conservation-bonuses",
  "label": "Karma conservation bonuses — IUCN/NOM-059 multipliers (Phase 3)",
  "label_es": "Karma — bonos de conservación IUCN/NOM-059 (Fase 3)",
  "status": "pending"
}
```

- [ ] **Step 5: Add subtasks for Phase 1**

In `docs/tasks.json`, locate the `karma-phase-1-foundation` entry (after step 4 above) and add a `subtasks` array reflecting tasks 1–11 of this plan. Use the same shape as existing entries in the file.

- [ ] **Step 6: Build (regenerates roadmap pages from JSON)**

Run:
```bash
npm run build
```
Expected: zero errors. The `/docs/roadmap/` and `/docs/tasks/` pages now include the new entries.

- [ ] **Step 7: Commit**

```bash
git add docs/specs/modules/23-karma-expertise-rarity.md \
       docs/specs/modules/00-index.md \
       docs/specs/modules/22-community-validation.md \
       docs/progress.json docs/tasks.json
git commit -m "docs(module 23): spec + index + module 22 cross-link + roadmap entries"
```

---

## Pre-PR checklist (run after Task 12)

- [ ] `npm run typecheck` passes
- [ ] `npm run test` (Vitest) passes — includes new `karma.test.ts`
- [ ] `npm run build` passes — both EN/ES pages for Pokédex render
- [ ] `make db-apply` is idempotent (run twice, second run is a no-op)
- [ ] `make db-verify` shows the new tables, columns, triggers
- [ ] `psql … -c "SELECT public.refresh_taxon_rarity();"` succeeds
- [ ] Manually visit `/en/profile/dex/` while signed in — page loads
- [ ] Manually open the suggest modal — microcopy shows the empty-state line, then a real magnitude line after picking a species

---

## Out of scope for Phase 1 (will get separate plans)

- Phase 2: win-toast confetti, weekly email digest, regional leaderboards, "First in Rastrum" badge, discovery-moment interstitials.
- Phase 3: populate `taxa.iucn_status`, `taxa.nom_059_status`, `taxa.endemic_to`; activate conservation bonuses; admin-editable `karma_config`; consensus-reversal handling.

If during Phase 1 you discover that an out-of-scope element is actually a hard prerequisite, STOP and amend this plan rather than silently expanding scope.
