# Future Migrations

Schema changes that are **intentionally deferred** past v0.1. Each section lists
the trigger condition for pulling it forward, the migration path, and the preflight
steps required in Supabase.

---

## 1. Monthly partitioning of `observations` (v0.8+)

**Trigger condition:** `SELECT count(*) FROM observations > 1_000_000` **or**
`pg_total_relation_size('observations') > 20 GB`, whichever comes first.

**Why deferred from v0.1:**
- At <10K rows partitioning gives zero query benefit but adds real cost:
  every primary key must include `observed_at`, cross-partition queries
  slow down, and `pg_partman` retention jobs add operational surface.
- `partman.create_parent()` signature drifted between v4 and v5 and is
  Supabase-version-sensitive — running it on a fresh project is brittle.

**Preflight (before running this migration):**
```sql
-- 1. Confirm pg_partman is available in this Supabase project
SELECT * FROM pg_available_extensions WHERE name = 'pg_partman';

-- 2. Pin a known-good version
CREATE EXTENSION pg_partman WITH VERSION '5.1.0';

-- 3. Verify partman schema + role exist
SELECT has_schema_privilege('postgres','partman','USAGE');
```

**Migration sketch:**
```sql
BEGIN;

-- 1. Rename old table
ALTER TABLE public.observations RENAME TO observations_legacy;

-- 2. Create partitioned parent with composite PK
CREATE TABLE public.observations (
  LIKE public.observations_legacy INCLUDING ALL
) PARTITION BY RANGE (observed_at);

ALTER TABLE public.observations DROP CONSTRAINT observations_pkey;
ALTER TABLE public.observations ADD PRIMARY KEY (id, observed_at);

-- 3. Hand over to partman (monthly native partitions, 3 premade)
SELECT partman.create_parent(
  p_parent_table => 'public.observations',
  p_control      => 'observed_at',
  p_type         => 'native',
  p_interval     => 'monthly',
  p_premake      => 3
);

-- 4. Copy data (run in chunks if >1M rows)
INSERT INTO public.observations SELECT * FROM public.observations_legacy;

-- 5. Drop legacy after verification
-- DROP TABLE public.observations_legacy;

COMMIT;
```

**Retention policy:** none. Biodiversity observations are permanent records —
we never drop partitions, only detach and archive to cold storage if needed.

---

## 2. pgvector + Scout AI RAG (v0.5+)

**Trigger condition:** Rastrum Scout v0 ships (conversational field AI with
regional retrieval).

**Preflight:**
```sql
CREATE EXTENSION IF NOT EXISTS vector WITH VERSION '0.7.0';
```

**New tables (sketch):**
```sql
CREATE TABLE public.taxon_embeddings (
  taxon_id    uuid PRIMARY KEY REFERENCES taxa(id) ON DELETE CASCADE,
  embedding   vector(1024),              -- Voyage or Cohere embedding dim
  model       text NOT NULL,             -- 'voyage-3', 'cohere-embed-v4'
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX ON taxon_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 3. Research-grade consensus workflow (v0.5+)

Adds a `consensus_status` column and a `community_identifications` audit table.
See module `07-consensus.md` (planned) for detail.

---

## 4. Local Contexts BC Notices (v0.5+)

Adds `bc_notice_ids text[]` on `observations` plus a `notices` lookup table
mirroring [Local Contexts](https://localcontexts.org/) Biocultural labels.
Governance process (community consent) must land before schema.

---

## 5. Profile / gamification tables (v0.1 → v1.0, staged)

See [`modules/08-profile-activity-gamification.md`](../modules/08-profile-activity-gamification.md)
for design. Schema rollout is phased to match the feature rollout.

### 5a. v0.1 — profile additive columns on `public.users`

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_public       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gamification_opt_in  boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS streak_digest_opt_in boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region_primary       text,
  ADD COLUMN IF NOT EXISTS joined_at            timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_observation_at  timestamptz,
  ADD COLUMN IF NOT EXISTS stats_cached_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stats_json           jsonb;
```

Additive, non-breaking. Existing rows remain valid (all defaults are
either `false`, `NULL`, or `now()`). Folded into `supabase-schema.sql`
as soon as v0.1 profile UI lands.

### 5b. v0.3 — `activity_events`

```sql
CREATE TABLE IF NOT EXISTS public.activity_events (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id uuid,
  kind       text NOT NULL CHECK (kind IN (
    'observation_created','observation_id_accepted','observation_id_changed',
    'observation_research_grade','badge_earned','streak_milestone',
    'first_of_species_in_region','first_observation_of_day',
    'comment_received','validation_given','validation_received'
  )),
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'self'
             CHECK (visibility IN ('self','followers','public'))
);

CREATE INDEX IF NOT EXISTS idx_activity_actor       ON activity_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_public_feed ON activity_events(created_at DESC) WHERE visibility = 'public';

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_self_read ON public.activity_events;
CREATE POLICY activity_self_read ON public.activity_events FOR SELECT
  USING ((SELECT auth.uid()) = actor_id);

DROP POLICY IF EXISTS activity_public_read ON public.activity_events;
CREATE POLICY activity_public_read ON public.activity_events FOR SELECT
  USING (
    visibility = 'public'
    AND actor_id IN (SELECT id FROM public.users WHERE profile_public = true)
  );
```

Writes go through server-side triggers on `observations` / `identifications`
(Edge Function with service_role, or `SECURITY DEFINER` plpgsql). The PWA
has no direct INSERT path.

### 5c. v0.5 — `badges` + `user_badges`

```sql
CREATE TABLE IF NOT EXISTS public.badges (
  key            text PRIMARY KEY,
  name_es        text NOT NULL,
  name_en        text NOT NULL,
  description_es text NOT NULL,
  description_en text NOT NULL,
  category       text NOT NULL CHECK (category IN
                 ('discovery','mastery','contribution','community','governance')),
  tier           text NOT NULL CHECK (tier IN ('bronze','silver','gold','platinum')),
  art_url        text NOT NULL,
  rule_json      jsonb NOT NULL,
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_key      text NOT NULL REFERENCES public.badges(key),
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  trigger_obs_id uuid REFERENCES public.observations(id),
  revoked_at     timestamptz,
  revoke_reason  text,
  UNIQUE (user_id, badge_key)
);

ALTER TABLE public.badges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS badges_public_read ON public.badges;
CREATE POLICY badges_public_read ON public.badges FOR SELECT USING (true);

DROP POLICY IF EXISTS user_badges_public_read ON public.user_badges;
CREATE POLICY user_badges_public_read ON public.user_badges FOR SELECT
  USING (
    revoked_at IS NULL
    AND user_id IN (SELECT id FROM public.users WHERE profile_public = true AND gamification_opt_in = true)
  );

DROP POLICY IF EXISTS user_badges_self_read ON public.user_badges;
CREATE POLICY user_badges_self_read ON public.user_badges FOR SELECT
  USING ((SELECT auth.uid()) = user_id);
```

Writes restricted to service_role. The nightly badge evaluator runs as an
Edge Function with the service key, computes deltas, and INSERTs into
`user_badges`.

### 5d. v1.0 — `user_streaks`, `events`

```sql
CREATE TABLE IF NOT EXISTS public.user_streaks (
  user_id             uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_days        integer NOT NULL DEFAULT 0,
  longest_days        integer NOT NULL DEFAULT 0,
  last_qualifying_day date,
  grace_used_at       timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.events (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug           text UNIQUE NOT NULL,
  name           text NOT NULL,
  description_md text,
  organiser_id   uuid REFERENCES public.users(id),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  region_geojson geography(Polygon, 4326) NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('bioblitz','survey','challenge')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_time   ON events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_events_region ON events USING GIST(region_geojson);
```

### 5e. Anti-sybil CHECK (v0.5, on `identifications`)

Prevents self-validation from flipping `is_research_grade`:

```sql
ALTER TABLE public.identifications
  ADD CONSTRAINT ck_no_self_validation
  CHECK (validated_by IS NULL OR validated_by <> (
    SELECT observer_id FROM public.observations WHERE id = observation_id
  ));
```

Note: subquery in CHECK requires validation at trigger level in Postgres.
Implemented as a `BEFORE INSERT OR UPDATE` trigger instead — see the v0.5
migration when identification consensus ships.
