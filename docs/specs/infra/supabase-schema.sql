-- Rastrum v0.1 Supabase Schema
-- Apply with: `make db-apply` (or `psql "$SUPABASE_DB" -f <this-file>`)
-- Region: us-east-1 (dev) — consider sa-east-1 / mx-central-1 for LGPDPPSO later.
--
-- Scope: v0.1 ships a plain (non-partitioned) observations table. Partitioning
-- is deferred until the table exceeds ~1M rows — see docs/specs/infra/future-migrations.md
-- pgvector is also deferred; enabled at v0.5 when Scout/RAG lands.
--
-- Idempotency: this file is safe to replay. Tables use IF NOT EXISTS, policies
-- and triggers drop-before-create. Data is never touched.

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
-- Deferred: pg_partman (v0.8+, when observations table crosses ~1M rows)
-- Deferred: pgvector (v0.5+, when Scout AI RAG lands)

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username          text UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  display_name      text CHECK (length(display_name) <= 80),
  bio               text CHECK (length(bio) <= 500),
  avatar_url        text,
  preferred_lang    text NOT NULL DEFAULT 'es'
                    CHECK (preferred_lang IN ('es','en','zap','mix','nah','myn','tzo','tze')),
  is_expert         boolean NOT NULL DEFAULT false,
  expert_taxa       text[],                       -- e.g. ARRAY['Aves','Plantae']
  observer_license  text NOT NULL DEFAULT 'CC BY 4.0'
                    CHECK (observer_license IN ('CC BY 4.0','CC BY-NC 4.0','CC0')),
  observation_count integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Profile / gamification additive columns (module 08 v0.1 slice).
-- See docs/specs/modules/08-profile-activity-gamification.md.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_public        boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gamification_opt_in   boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS streak_digest_opt_in  boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region_primary        text,
  ADD COLUMN IF NOT EXISTS joined_at             timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_observation_at   timestamptz,
  ADD COLUMN IF NOT EXISTS stats_cached_at       timestamptz,
  ADD COLUMN IF NOT EXISTS stats_json            jsonb,
  -- v1.0: credentialed researcher tier — when true, RLS gates open up to
  -- precise coordinates of NOM-059/CITES species (still subject to BC/TK
  -- notices). Set by an admin after ID verification (no self-serve).
  ADD COLUMN IF NOT EXISTS credentialed_researcher boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credentialed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS credentialed_by       uuid REFERENCES public.users(id);

-- Auto-create user profile on sign-up. Pulls avatar + display name from
-- the OAuth provider's metadata when present:
--   Google → user_metadata.picture (preferred) or .avatar_url
--   GitHub → user_metadata.avatar_url
--   Magic link / OTP → no metadata, falls through to NULL (UI shows initials)
-- ON CONFLICT updates only fields that are still NULL, so a user who later
-- uploaded their own avatar isn't overwritten on next OAuth re-link.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  picked_avatar text := COALESCE(
    meta->>'avatar_url',
    meta->>'picture'
  );
  picked_name text := COALESCE(
    meta->>'full_name',
    meta->>'name',
    meta->>'user_name',
    NULLIF(split_part(NEW.email, '@', 1), '')
  );
BEGIN
  INSERT INTO public.users (id, avatar_url, display_name)
  VALUES (NEW.id, picked_avatar, picked_name)
  ON CONFLICT (id) DO UPDATE SET
    avatar_url   = COALESCE(public.users.avatar_url,   EXCLUDED.avatar_url),
    display_name = COALESCE(public.users.display_name, EXCLUDED.display_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also fire on raw_user_meta_data updates so existing users who re-auth
-- pick up an avatar they didn't have before. Same COALESCE guard so the
-- user's own custom avatar wins.
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- One-shot backfill for users who signed up before this trigger existed:
-- copy any avatar / name in auth.users.raw_user_meta_data into
-- public.users where the public row's value is still NULL.
UPDATE public.users u
SET avatar_url = COALESCE(
      au.raw_user_meta_data->>'avatar_url',
      au.raw_user_meta_data->>'picture'
    ),
    display_name = COALESCE(
      u.display_name,
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'user_name',
      NULLIF(split_part(au.email, '@', 1), '')
    )
FROM auth.users au
WHERE au.id = u.id
  AND (u.avatar_url IS NULL OR u.display_name IS NULL);

-- ============================================================
-- TAXA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.taxa (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gbif_taxon_key        integer UNIQUE,
  scientific_name       text NOT NULL,
  scientific_name_with_author text,
  canonical_name        text,
  taxon_rank            text NOT NULL DEFAULT 'species',  -- species|genus|family|order|class|phylum|kingdom
  kingdom               text,
  phylum                text,
  class                 text,
  "order"               text,
  family                text,
  genus                 text,
  specific_epithet      text,
  infraspecific_epithet text,
  common_name_es        text,
  common_name_en        text,
  nom059_status         text CHECK (nom059_status IN ('E','P','A','Pr')),  -- NOM-059 categories
  cites_appendix        text CHECK (cites_appendix IN ('I','II','III')),
  iucn_category         text CHECK (iucn_category IN ('EX','EW','CR','EN','VU','NT','LC','DD','NE')),
  is_endemic_mexico     boolean DEFAULT false,
  description_es        text,
  description_en        text,
  -- Obscuration flags (derived from status)
  obscure_level         text NOT NULL DEFAULT 'none'
                        CHECK (obscure_level IN ('none','0.1deg','0.2deg','5km','full')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taxa_scientific_name ON taxa(scientific_name);
CREATE INDEX IF NOT EXISTS idx_taxa_gbif ON taxa(gbif_taxon_key);
CREATE INDEX IF NOT EXISTS idx_taxa_family ON taxa(family);

-- Taxon usage history (never rewrite historical IDs)
CREATE TABLE IF NOT EXISTS public.taxon_usage_history (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observation_id      uuid NOT NULL,
  original_name       text NOT NULL,
  original_taxon_id   uuid,
  current_accepted_id uuid REFERENCES taxa(id),
  synonym_since       date,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- OBSERVATIONS (plain table; partition later if >1M rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.observations (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observer_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  observed_at           timestamptz NOT NULL DEFAULT now(),

  -- Location (PostGIS geography for spherical accuracy)
  location              geography(Point, 4326),
  location_obscured     geography(Point, 4326),   -- NULL if not sensitive
  accuracy_m            numeric,
  altitude_m            numeric,
  location_source       text DEFAULT 'gps'
                        CHECK (location_source IN ('gps','exif','manual')),
  state_province        text,
  municipality          text,
  locality              text,

  -- Primary taxon denormalized from identifications (for RLS + fast read paths).
  -- Updated by trigger when the primary identification changes.
  primary_taxon_id      uuid REFERENCES public.taxa(id),
  obscure_level         text NOT NULL DEFAULT 'none'
                        CHECK (obscure_level IN ('none','0.1deg','0.2deg','5km','full')),

  -- Field context
  habitat               text,
  weather               text,
  notes                 text CHECK (length(notes) <= 2000),
  individual_count      integer CHECK (individual_count > 0),

  -- Evidence type (v0.5+)
  evidence_type         text DEFAULT 'direct_sighting'
                        CHECK (evidence_type IN
                          ('direct_sighting','track','scat','burrow','nest','feather','bone','sound','camera_trap')),

  -- Environmental enrichment (auto-filled)
  moon_phase            text,
  moon_illumination     numeric CHECK (moon_illumination BETWEEN 0 AND 1),
  photoperiod_hours     numeric,
  temp_celsius          numeric,
  precipitation_24h_mm  numeric,
  precipitation_7d_mm   numeric,
  days_since_rain       integer,
  post_rain_flag        boolean DEFAULT false,
  weather_tag           text,
  ndvi_value            numeric,
  phenological_season   text,
  fire_proximity_km     numeric,

  -- EXIF metadata
  captured_at           timestamptz,
  device_make           text,
  device_model          text,
  gps_direction_deg     numeric,
  media_quality_score   numeric,

  -- Sync
  sync_status           text NOT NULL DEFAULT 'pending'
                        CHECK (sync_status IN ('pending','synced','error')),
  app_version           text,
  device_os             text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_obs_observer ON observations(observer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_location ON observations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_obs_location_obs ON observations USING GIST(location_obscured);
CREATE INDEX IF NOT EXISTS idx_obs_sync ON observations(sync_status) WHERE sync_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_obs_primary_taxon ON observations(primary_taxon_id);
CREATE INDEX IF NOT EXISTS idx_obs_public ON observations(sync_status, obscure_level)
  WHERE sync_status = 'synced';

-- ============================================================
-- IDENTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.identifications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observation_id  uuid NOT NULL,
  taxon_id        uuid REFERENCES taxa(id),
  scientific_name text,                    -- denormalized, stored at ID time
  confidence      numeric CHECK (confidence BETWEEN 0 AND 1),
  source          text NOT NULL
                  CHECK (source IN ('plantnet','claude_haiku','claude_sonnet','onnx_offline','human')),
  raw_response    jsonb,                   -- full API response
  is_primary      boolean NOT NULL DEFAULT true,
  is_research_grade boolean DEFAULT false,
  validated_by    uuid REFERENCES users(id),
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_id_observation ON identifications(observation_id);
CREATE INDEX IF NOT EXISTS idx_id_taxon ON identifications(taxon_id);

-- FK from identifications.observation_id → observations.id. Without
-- this, PostgREST's nested-select introspection refuses to embed
-- identifications in observations queries, breaking every observation
-- list page with "Could not find a relationship between
-- 'observations' and 'identifications' in the schema cache".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'identifications_observation_id_fkey'
      AND conrelid = 'public.identifications'::regclass
  ) THEN
    ALTER TABLE public.identifications
      ADD CONSTRAINT identifications_observation_id_fkey
      FOREIGN KEY (observation_id)
      REFERENCES public.observations(id) ON DELETE CASCADE;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- MEDIA FILES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.media_files (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observation_id      uuid NOT NULL,
  media_type          text NOT NULL CHECK (media_type IN ('photo','audio','video')),
  url                 text NOT NULL,         -- Cloudflare R2 URL
  thumbnail_url       text,
  original_filename   text,
  mime_type           text,
  file_size_bytes     bigint,
  duration_s          numeric,               -- audio/video
  sample_rate_hz      integer,               -- audio
  resolution_px       integer,               -- megapixels
  -- EXIF
  exif_data           jsonb,
  gps_lat             numeric,
  gps_lng             numeric,
  gps_alt             numeric,
  captured_at         timestamptz,
  device_make         text,
  device_model        text,
  gps_direction_deg   numeric,
  metadata_redacted   boolean DEFAULT false,
  -- Order
  sort_order          integer NOT NULL DEFAULT 0,
  is_primary          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_observation ON media_files(observation_id);

-- Same FK story as identifications above — needed so PostgREST can
-- embed media_files in observations queries.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'media_files_observation_id_fkey'
      AND conrelid = 'public.media_files'::regclass
  ) THEN
    ALTER TABLE public.media_files
      ADD CONSTRAINT media_files_observation_id_fkey
      FOREIGN KEY (observation_id)
      REFERENCES public.observations(id) ON DELETE CASCADE;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxa ENABLE ROW LEVEL SECURITY;

-- Users: public read, self-update
DROP POLICY IF EXISTS "users_public_read" ON public.users;
CREATE POLICY "users_public_read" ON public.users FOR SELECT USING (true);
DROP POLICY IF EXISTS "users_self_update" ON public.users;
CREATE POLICY "users_self_update" ON public.users FOR UPDATE
  USING ((SELECT auth.uid()) = id);

-- Taxa: public read
DROP POLICY IF EXISTS "taxa_public_read" ON public.taxa;
CREATE POLICY "taxa_public_read" ON public.taxa FOR SELECT USING (true);

-- Observations: owner full access, public read for synced non-sensitive rows.
-- obscure_level is denormalized onto observations (see trigger below) so the
-- policy can stay single-table and inexpensive.
DROP POLICY IF EXISTS "obs_owner" ON public.observations;
CREATE POLICY "obs_owner" ON public.observations FOR ALL
  USING ((SELECT auth.uid()) = observer_id);

DROP POLICY IF EXISTS "obs_public_read" ON public.observations;
CREATE POLICY "obs_public_read" ON public.observations FOR SELECT
  USING (
    sync_status = 'synced'
    AND (
      obscure_level = 'none'
      OR location_obscured IS NOT NULL   -- sensitive, but coarsened coords available
    )
  );

-- Credentialed researchers get precise coords on sensitive observations.
-- Same dataset shape, just no obscuration. Admin sets credentialed_researcher
-- after ID verification (no self-serve toggle).
DROP POLICY IF EXISTS "obs_credentialed_read" ON public.observations;
CREATE POLICY "obs_credentialed_read" ON public.observations FOR SELECT
  USING (
    sync_status = 'synced'
    AND (SELECT credentialed_researcher FROM public.users WHERE id = auth.uid()) = true
  );

-- Identifications: tied to observation access
DROP POLICY IF EXISTS "id_owner" ON public.identifications;
CREATE POLICY "id_owner" ON public.identifications FOR ALL
  USING (
    observation_id IN (
      SELECT id FROM observations WHERE (SELECT auth.uid()) = observer_id
    )
  );

DROP POLICY IF EXISTS "id_public_read" ON public.identifications;
CREATE POLICY "id_public_read" ON public.identifications FOR SELECT
  USING (
    observation_id IN (SELECT id FROM observations WHERE sync_status = 'synced')
  );

-- Media: same as observations
DROP POLICY IF EXISTS "media_owner" ON public.media_files;
CREATE POLICY "media_owner" ON public.media_files FOR ALL
  USING (
    observation_id IN (
      SELECT id FROM observations WHERE (SELECT auth.uid()) = observer_id
    )
  );

DROP POLICY IF EXISTS "media_public_read" ON public.media_files;
CREATE POLICY "media_public_read" ON public.media_files FOR SELECT
  USING (
    observation_id IN (SELECT id FROM observations WHERE sync_status = 'synced')
    AND metadata_redacted = false
  );

-- ============================================================
-- ROLE-LEVEL GRANTS
-- ============================================================
-- Required because we deliberately turned OFF "Automatically expose new
-- tables and functions" when we created the project. PostgREST won't grant
-- anything by default, so anon/authenticated requests get 403 even though
-- RLS is configured correctly. RLS still does the row-level gating; these
-- GRANTs only expose the tables to the API.

-- Schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Anonymous: read-only — RLS will gate which rows are actually returned.
GRANT SELECT ON ALL TABLES    IN SCHEMA public TO anon;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Authenticated: full CRUD — RLS gates rows. Functions need EXECUTE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT USAGE,  SELECT                  ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE                         ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Future tables/sequences/functions inherit the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Defensive: revoke privileges that Supabase's legacy project init may have
-- granted to anon. None are reachable via PostgREST today, but minimal
-- privilege is a basic hygiene principle.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE          ON ALL TABLES IN SCHEMA public FROM anon;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Obscure a point to a grid cell
CREATE OR REPLACE FUNCTION public.obscure_point(
  pt geometry,
  cell_size_deg numeric DEFAULT 0.2
)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ST_SetSRID(
    ST_MakePoint(
      round(ST_X(pt) / cell_size_deg) * cell_size_deg,
      round(ST_Y(pt) / cell_size_deg) * cell_size_deg
    ),
    4326
  );
$$;

-- Update observation count on user
CREATE OR REPLACE FUNCTION public.update_user_obs_count()
RETURNS trigger AS $$
BEGIN
  UPDATE public.users
  SET observation_count = (
    SELECT COUNT(*) FROM public.observations
    WHERE observer_id = NEW.observer_id AND sync_status = 'synced'
  ),
  updated_at = now()
  WHERE id = NEW.observer_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS update_obs_count_trigger ON public.observations;
CREATE TRIGGER update_obs_count_trigger
  AFTER INSERT OR UPDATE OF sync_status ON public.observations
  FOR EACH ROW
  WHEN (NEW.sync_status = 'synced')
  EXECUTE FUNCTION public.update_user_obs_count();

-- Keep observations.primary_taxon_id / obscure_level / location_obscured
-- in sync with the primary identification. Runs whenever an identification
-- row is flagged is_primary = true.
CREATE OR REPLACE FUNCTION public.sync_primary_identification()
RETURNS trigger AS $$
DECLARE
  v_obscure_level text;
  v_raw_loc       geography(Point, 4326);
BEGIN
  IF NOT NEW.is_primary THEN
    RETURN NEW;
  END IF;

  SELECT obscure_level INTO v_obscure_level
  FROM public.taxa WHERE id = NEW.taxon_id;

  SELECT location INTO v_raw_loc
  FROM public.observations WHERE id = NEW.observation_id;

  UPDATE public.observations
  SET primary_taxon_id = NEW.taxon_id,
      obscure_level    = COALESCE(v_obscure_level, 'none'),
      location_obscured = CASE
        WHEN v_obscure_level IS NULL OR v_obscure_level = 'none' THEN NULL
        WHEN v_obscure_level = '0.1deg' THEN public.obscure_point(v_raw_loc::geometry, 0.1)::geography
        WHEN v_obscure_level = '0.2deg' THEN public.obscure_point(v_raw_loc::geometry, 0.2)::geography
        WHEN v_obscure_level = '5km'    THEN public.obscure_point(v_raw_loc::geometry, 5.0/111.0)::geography
        WHEN v_obscure_level = 'full'   THEN NULL  -- withhold entirely from public
      END,
      updated_at = now()
  WHERE id = NEW.observation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_primary_id_trigger ON public.identifications;
CREATE TRIGGER sync_primary_id_trigger
  AFTER INSERT OR UPDATE OF is_primary, taxon_id ON public.identifications
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_primary_identification();

-- Only one primary identification per observation.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_primary_id_per_obs
  ON public.identifications(observation_id)
  WHERE is_primary = true;

-- ============================================================
-- BADGES + USER_BADGES (v0.5 — module 08)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.badges (
  key            text PRIMARY KEY,
  name_es        text NOT NULL,
  name_en        text NOT NULL,
  description_es text NOT NULL,
  description_en text NOT NULL,
  category       text NOT NULL CHECK (category IN
                 ('discovery','mastery','contribution','community','governance')),
  tier           text NOT NULL DEFAULT 'bronze'
                 CHECK (tier IN ('bronze','silver','gold','platinum')),
  art_url        text,
  rule_json      jsonb NOT NULL,
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_badges (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_key      text NOT NULL REFERENCES public.badges(key),
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  trigger_obs_id uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  revoked_at     timestamptz,
  revoke_reason  text,
  CONSTRAINT uniq_user_badge UNIQUE (user_id, badge_key)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id, awarded_at DESC);

ALTER TABLE public.badges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS badges_public_read ON public.badges;
CREATE POLICY badges_public_read ON public.badges FOR SELECT USING (true);

DROP POLICY IF EXISTS user_badges_self_read ON public.user_badges;
CREATE POLICY user_badges_self_read ON public.user_badges FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS user_badges_public_read ON public.user_badges;
CREATE POLICY user_badges_public_read ON public.user_badges FOR SELECT
  USING (
    revoked_at IS NULL
    AND user_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true AND gamification_opt_in = true
    )
  );

-- Anti-sybil: a user cannot validate their own observation's identification.
-- Implemented as a BEFORE INSERT/UPDATE trigger because CHECK constraints
-- can't reference other tables.
CREATE OR REPLACE FUNCTION public.prevent_self_validation()
RETURNS trigger AS $$
DECLARE
  observer_id uuid;
BEGIN
  IF NEW.validated_by IS NULL THEN RETURN NEW; END IF;
  SELECT o.observer_id INTO observer_id FROM public.observations o WHERE o.id = NEW.observation_id;
  IF observer_id = NEW.validated_by THEN
    RAISE EXCEPTION 'A user cannot validate their own observation (anti-sybil rule)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_self_validation_trigger ON public.identifications;
CREATE TRIGGER prevent_self_validation_trigger
  BEFORE INSERT OR UPDATE OF validated_by ON public.identifications
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_validation();

-- Quality gate: observations with confidence < 0.4 cannot be marked
-- research-grade. Enforced at the identification level.
CREATE OR REPLACE FUNCTION public.enforce_research_grade_quality()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_research_grade = true AND COALESCE(NEW.confidence, 0) < 0.4 THEN
    RAISE EXCEPTION 'Cannot mark research-grade with confidence < 0.4';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_rg_quality_trigger ON public.identifications;
CREATE TRIGGER enforce_rg_quality_trigger
  BEFORE INSERT OR UPDATE OF is_research_grade ON public.identifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_research_grade_quality();

-- ============================================================
-- STREAKS (v1.0 — module 08)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_streaks (
  user_id             uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_days        integer NOT NULL DEFAULT 0,
  longest_days        integer NOT NULL DEFAULT 0,
  last_qualifying_day date,
  grace_used_at       timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS streaks_self_read ON public.user_streaks;
CREATE POLICY streaks_self_read ON public.user_streaks FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS streaks_public_read ON public.user_streaks;
CREATE POLICY streaks_public_read ON public.user_streaks FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true AND gamification_opt_in = true
    )
  );

-- Recompute streak for one user. Called by the nightly Edge Function.
-- A "qualifying day" = at least one synced observation whose primary
-- identification has confidence >= 0.4 and is not flagged needs_review.
CREATE OR REPLACE FUNCTION public.recompute_streak(p_user_id uuid)
RETURNS void AS $$
DECLARE
  qualifying_days date[];
  cur integer := 0;
  longest integer := 0;
  prev date;
  d date;
  last_q date;
  uses_grace boolean := false;
BEGIN
  SELECT array_agg(DISTINCT (observed_at AT TIME ZONE 'UTC')::date ORDER BY (observed_at AT TIME ZONE 'UTC')::date DESC)
  INTO qualifying_days
  FROM public.observations o
  JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND COALESCE(i.confidence, 0) >= 0.4;

  IF qualifying_days IS NULL THEN
    INSERT INTO public.user_streaks (user_id, current_days, longest_days, updated_at)
    VALUES (p_user_id, 0, 0, now())
    ON CONFLICT (user_id) DO UPDATE SET current_days = 0, updated_at = now();
    RETURN;
  END IF;

  last_q := qualifying_days[1];
  prev := last_q;
  cur := 1;
  longest := 1;
  -- iterate desc-sorted days, allowing one grace miss in any 30-day window
  FOR i IN 2..array_length(qualifying_days, 1) LOOP
    d := qualifying_days[i];
    IF prev - d = 1 THEN
      cur := cur + 1;
    ELSIF prev - d = 2 AND NOT uses_grace AND (CURRENT_DATE - prev) <= 30 THEN
      cur := cur + 1;
      uses_grace := true;
    ELSE
      EXIT;
    END IF;
    IF cur > longest THEN longest := cur; END IF;
    prev := d;
  END LOOP;

  -- If today's not in the list and yesterday was the most recent, streak is still alive
  IF (CURRENT_DATE - last_q) > 1 THEN
    cur := 0;
  END IF;

  INSERT INTO public.user_streaks (user_id, current_days, longest_days, last_qualifying_day, grace_used_at, updated_at)
  VALUES (p_user_id, cur, GREATEST(longest, cur), last_q, CASE WHEN uses_grace THEN now() END, now())
  ON CONFLICT (user_id) DO UPDATE
    SET current_days = EXCLUDED.current_days,
        longest_days = GREATEST(public.user_streaks.longest_days, EXCLUDED.current_days, EXCLUDED.longest_days),
        last_qualifying_day = EXCLUDED.last_qualifying_day,
        grace_used_at = EXCLUDED.grace_used_at,
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BIOBLITZ EVENTS (v1.0 — module 08)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  description_md  text,
  organiser_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  region_geojson  geography(Polygon, 4326) NOT NULL,
  kind            text NOT NULL DEFAULT 'bioblitz'
                  CHECK (kind IN ('bioblitz','survey','challenge')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_time   ON events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_events_region ON events USING GIST(region_geojson);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_public_read ON public.events;
CREATE POLICY events_public_read ON public.events FOR SELECT USING (true);

-- ============================================================
-- SOCIAL: follows + comments + watchlists (v1.0 — module 08)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followee_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follows_self_manage ON public.follows;
CREATE POLICY follows_self_manage ON public.follows FOR ALL
  USING ((SELECT auth.uid()) = follower_id);

DROP POLICY IF EXISTS follows_public_read ON public.follows;
CREATE POLICY follows_public_read ON public.follows FOR SELECT
  USING (
    follower_id IN (SELECT id FROM public.users WHERE profile_public = true)
    OR followee_id IN (SELECT id FROM public.users WHERE profile_public = true)
  );

CREATE TABLE IF NOT EXISTS public.observation_comments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observation_id  uuid NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  helpful_count   integer NOT NULL DEFAULT 0,
  parent_id       uuid REFERENCES public.observation_comments(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_comments_obs ON observation_comments(observation_id, created_at);

ALTER TABLE public.observation_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comments_authenticated_insert ON public.observation_comments;
CREATE POLICY comments_authenticated_insert ON public.observation_comments FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = author_id);

DROP POLICY IF EXISTS comments_self_update ON public.observation_comments;
CREATE POLICY comments_self_update ON public.observation_comments FOR UPDATE
  USING ((SELECT auth.uid()) = author_id);

DROP POLICY IF EXISTS comments_public_read ON public.observation_comments;
CREATE POLICY comments_public_read ON public.observation_comments FOR SELECT
  USING (
    deleted_at IS NULL
    AND observation_id IN (SELECT id FROM public.observations WHERE sync_status = 'synced')
  );

CREATE TABLE IF NOT EXISTS public.watchlists (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  taxon_id      uuid REFERENCES public.taxa(id) ON DELETE CASCADE,
  scientific_name text,                       -- denorm fallback when taxon not linked
  radius_km     integer DEFAULT 50 CHECK (radius_km BETWEEN 1 AND 500),
  digest_only   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (taxon_id IS NOT NULL OR scientific_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id);

ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlists_self ON public.watchlists;
CREATE POLICY watchlists_self ON public.watchlists FOR ALL
  USING ((SELECT auth.uid()) = user_id);

-- ============================================================
-- BADGE PREDICATES (v0.5 — called from award-badges Edge Function)
-- ============================================================
CREATE OR REPLACE FUNCTION public.badge_eligible_kingdom_first(p_kingdom text)
RETURNS SETOF uuid AS $$
  SELECT DISTINCT o.observer_id
  FROM public.observations o
  JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
  JOIN public.taxa t ON t.id = i.taxon_id
  WHERE o.sync_status = 'synced' AND t.kingdom = p_kingdom;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.badge_eligible_rg_count(
  p_kingdom text DEFAULT NULL, p_class text DEFAULT NULL, p_threshold integer DEFAULT 10
)
RETURNS SETOF uuid AS $$
  SELECT o.observer_id
  FROM public.observations o
  JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary AND i.is_research_grade
  JOIN public.taxa t ON t.id = i.taxon_id
  WHERE o.sync_status = 'synced'
    AND (p_kingdom IS NULL OR t.kingdom = p_kingdom)
    AND (p_class   IS NULL OR t.class   = p_class)
  GROUP BY o.observer_id
  HAVING count(*) >= p_threshold;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.badge_eligible_species_count(p_threshold integer)
RETURNS SETOF uuid AS $$
  SELECT o.observer_id
  FROM public.observations o
  JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
  WHERE o.sync_status = 'synced' AND i.taxon_id IS NOT NULL
  GROUP BY o.observer_id
  HAVING count(DISTINCT i.taxon_id) >= p_threshold;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.badge_eligible_kingdom_diversity(p_min integer)
RETURNS SETOF uuid AS $$
  WITH per_kingdom AS (
    SELECT o.observer_id, t.kingdom, count(*) AS n
    FROM public.observations o
    JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
    JOIN public.taxa t ON t.id = i.taxon_id
    WHERE o.sync_status = 'synced' AND t.kingdom IN ('Plantae','Animalia','Fungi')
    GROUP BY o.observer_id, t.kingdom
  )
  SELECT observer_id
  FROM per_kingdom
  WHERE n >= p_min
  GROUP BY observer_id
  HAVING count(DISTINCT kingdom) >= 3;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Permission for the service role to invoke
GRANT EXECUTE ON FUNCTION public.badge_eligible_kingdom_first(text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.badge_eligible_rg_count(text,text,integer)    TO service_role;
GRANT EXECUTE ON FUNCTION public.badge_eligible_species_count(integer)         TO service_role;
GRANT EXECUTE ON FUNCTION public.badge_eligible_kingdom_diversity(integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_streak(uuid)                        TO service_role;

-- ============================================================
-- EXPERT-WEIGHTED CONSENSUS (v0.5/v1.0 — module 08)
-- ============================================================
-- A community validation contributes 1.0; an expert validation in the
-- relevant kingdom contributes 3.0. Research-grade fires when the
-- weighted score for the leading taxon ≥ 2.0 AND ≥ 2 distinct validators.
CREATE OR REPLACE FUNCTION public.recompute_consensus(p_observation_id uuid)
RETURNS void AS $$
DECLARE
  winning_taxon uuid;
  winning_score numeric;
  validator_count integer;
BEGIN
  WITH weighted AS (
    SELECT i.taxon_id,
           SUM(CASE WHEN u.is_expert AND t.kingdom = ANY(u.expert_taxa) THEN 3.0 ELSE 1.0 END) AS score,
           count(DISTINCT i.validated_by) AS validators
    FROM public.identifications i
    JOIN public.taxa t ON t.id = i.taxon_id
    LEFT JOIN public.users u ON u.id = i.validated_by
    WHERE i.observation_id = p_observation_id
      AND i.taxon_id IS NOT NULL
      AND i.validated_by IS NOT NULL
    GROUP BY i.taxon_id
  )
  SELECT taxon_id, score, validators
  INTO winning_taxon, winning_score, validator_count
  FROM weighted
  ORDER BY score DESC
  LIMIT 1;

  IF winning_taxon IS NULL THEN RETURN; END IF;

  IF winning_score >= 2.0 AND validator_count >= 2 THEN
    UPDATE public.identifications
       SET is_research_grade = true
     WHERE observation_id = p_observation_id AND taxon_id = winning_taxon AND is_primary;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recompute_consensus(uuid) TO service_role;

-- ============================================================
-- ACTIVITY FEED (v0.3 — module 08)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.activity_events (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id uuid,
  kind       text NOT NULL CHECK (kind IN (
    'observation_created','observation_id_accepted','observation_id_changed',
    'observation_research_grade','badge_earned','streak_milestone',
    'first_of_species_in_region','first_observation_of_day',
    'comment_received','validation_given','validation_received',
    'follow_received'
  )),
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  visibility text NOT NULL DEFAULT 'self'
             CHECK (visibility IN ('self','followers','public'))
);

CREATE INDEX IF NOT EXISTS idx_activity_actor       ON activity_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_unread      ON activity_events(actor_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_public_feed ON activity_events(created_at DESC) WHERE visibility = 'public';

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_self_read ON public.activity_events;
CREATE POLICY activity_self_read ON public.activity_events FOR SELECT
  USING ((SELECT auth.uid()) = actor_id);

DROP POLICY IF EXISTS activity_self_update ON public.activity_events;
CREATE POLICY activity_self_update ON public.activity_events FOR UPDATE
  USING ((SELECT auth.uid()) = actor_id);

DROP POLICY IF EXISTS activity_public_read ON public.activity_events;
CREATE POLICY activity_public_read ON public.activity_events FOR SELECT
  USING (
    visibility = 'public'
    AND actor_id IN (SELECT id FROM public.users WHERE profile_public = true)
  );

-- Auto-fire activity_events from observation insert.
CREATE OR REPLACE FUNCTION public.fire_observation_created()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.activity_events (actor_id, subject_id, kind, payload, visibility)
  VALUES (
    NEW.observer_id,
    NEW.id,
    'observation_created',
    jsonb_build_object(
      'state_province', NEW.state_province,
      'habitat', NEW.habitat
    ),
    'self'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS fire_observation_created_trigger ON public.observations;
CREATE TRIGGER fire_observation_created_trigger
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_observation_created();

-- Promote to public visibility once the observation reaches research-grade.
CREATE OR REPLACE FUNCTION public.fire_research_grade()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_research_grade IS DISTINCT FROM OLD.is_research_grade
     AND NEW.is_research_grade = true THEN
    INSERT INTO public.activity_events (actor_id, subject_id, kind, payload, visibility)
    SELECT o.observer_id,
           o.id,
           'observation_research_grade',
           jsonb_build_object('scientific_name', NEW.scientific_name),
           'public'
    FROM public.observations o WHERE o.id = NEW.observation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS fire_research_grade_trigger ON public.identifications;
CREATE TRIGGER fire_research_grade_trigger
  AFTER UPDATE OF is_research_grade ON public.identifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_research_grade();

-- ============================================================
-- STORAGE BUCKET + POLICIES (v0.1: Supabase Storage; v0.3 migrates to R2)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, 20 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav'])
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload to their own folder: observations/<obs-id>/<blob-id>
-- Object `name` starts with 'observations/<uuid>/...' — we let any authenticated
-- user upload and rely on the observations FK + RLS to bound writes.
DROP POLICY IF EXISTS "media_insert_authenticated" ON storage.objects;
CREATE POLICY "media_insert_authenticated" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

DROP POLICY IF EXISTS "media_update_authenticated" ON storage.objects;
CREATE POLICY "media_update_authenticated" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS "media_public_read" ON storage.objects;
CREATE POLICY "media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'media');

-- ============================================================
-- MODULE 14 — USER API TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_api_tokens (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'API Token',
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{observe,identify,export}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz DEFAULT now(),
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tokens_user ON public.user_api_tokens(user_id)
  WHERE revoked_at IS NULL;
-- Note: idx_tokens_hash not needed — token_hash UNIQUE constraint creates its own index.

ALTER TABLE public.user_api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tokens_select_own" ON public.user_api_tokens;
CREATE POLICY "tokens_select_own" ON public.user_api_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tokens_delete_own" ON public.user_api_tokens;
CREATE POLICY "tokens_delete_own" ON public.user_api_tokens
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- Expert applications (module 08 — credentialed-tier review queue)
-- Users submit one application per request. Admins review out-of-band
-- (no admin UI yet) and on approval flip users.is_expert + expert_taxa.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expert_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  taxa          text[] NOT NULL,                    -- ['Aves','Mammalia',…]
  credentials   text   NOT NULL,                    -- free-text bio / cv blurb
  institution   text,
  orcid         text,                               -- 0000-0000-0000-0000
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewer_note text,                               -- admin-set on transition
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_expert_apps_user
  ON public.expert_applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_expert_apps_pending
  ON public.expert_applications(created_at)
  WHERE status = 'pending';

ALTER TABLE public.expert_applications ENABLE ROW LEVEL SECURITY;

-- A user reads & inserts their own applications. UPDATE is admin-only
-- (we let the user 'withdraw' by inserting a fresh row with status set,
-- which keeps the audit trail intact).
DROP POLICY IF EXISTS "expert_apps_read_own" ON public.expert_applications;
CREATE POLICY "expert_apps_read_own" ON public.expert_applications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "expert_apps_insert_own" ON public.expert_applications;
CREATE POLICY "expert_apps_insert_own" ON public.expert_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Service-role bypasses RLS for admin ops; no UPDATE/DELETE policy for
-- regular users by design.

GRANT SELECT, INSERT ON public.expert_applications TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- API usage log (v1.0.x — `plantnet-quota-monitor`)
-- One row per (date, provider). The `plantnet-monitor` Edge Function
-- upserts the daily probe; admins read for dashboards. anon never reads.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_usage (
  date       date NOT NULL,
  provider   text NOT NULL,                    -- 'plantnet' (more later)
  used       integer NOT NULL DEFAULT 0,
  quota      integer NOT NULL DEFAULT 0,
  remaining  integer NOT NULL DEFAULT 0,
  raw        jsonb,                            -- verbatim provider response
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, provider)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_provider_date
  ON public.api_usage(provider, date DESC);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- Read policy: admins (proxied today by users.is_expert) can read; service
-- role bypasses RLS for the EF write path. anon never reads. When the
-- proper users.is_admin column lands (see expert-app-admin-ui notes), swap
-- the predicate.
DROP POLICY IF EXISTS "api_usage_read_admin" ON public.api_usage;
CREATE POLICY "api_usage_read_admin" ON public.api_usage
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM public.users WHERE is_expert = true
    )
  );

GRANT SELECT ON public.api_usage TO authenticated;
-- service_role retains the implicit bypass — no INSERT grant for anon/auth.

-- ─────────────────────────────────────────────────────────────────────
-- Push subscriptions (v1.1 — `ux-streak-push`)
-- One row per (user, endpoint). The PWA upserts on opt-in; the
-- `streak-push` Edge Function reads to fan out at 19:55 local time.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,                  -- unique per browser/device
  p256dh      text NOT NULL,                  -- public key for the subscription
  auth        text NOT NULL,                  -- shared secret
  user_agent  text,
  -- IANA tz; defaults to America/Mexico_City for v1.0.x scope. The EF
  -- batches subscribers by tz so 8 PM local fires once per zone.
  tz          text NOT NULL DEFAULT 'America/Mexico_City',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_tz
  ON public.push_subscriptions(tz);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_select_own" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_insert_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_insert_own" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_delete_own" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Sync failures (post-launch #2 — runbook docs/runbooks/post-launch-improvements.md)
-- Aggregated per (user, error_hash, day) so a single retry storm collapses
-- into one row. Service role only — written by the sync-error Edge Function.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_failures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  error_hash     text NOT NULL,
  error_message  text NOT NULL,
  blob_count     int  NOT NULL DEFAULT 0,
  sync_attempts  int  NOT NULL DEFAULT 1,
  app_version    text,
  failure_day    date NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  hit_count      int NOT NULL DEFAULT 1,
  UNIQUE (user_id, error_hash, failure_day)
);

CREATE INDEX IF NOT EXISTS idx_sync_failures_day
  ON public.sync_failures(failure_day DESC);
CREATE INDEX IF NOT EXISTS idx_sync_failures_user
  ON public.sync_failures(user_id, failure_day DESC);

-- On conflict, bump hit_count + refresh last_seen_at instead of duplicating.
CREATE OR REPLACE FUNCTION public.tg_sync_failures_upsert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Triggered by a no-op upsert; we let the Edge Function call upsert with
  -- onConflict — this trigger fires on UPDATE of the same key to bump the
  -- counter. Without it, a retry storm would only show as one row regardless
  -- of how loud the error was.
  IF TG_OP = 'UPDATE' THEN
    NEW.hit_count := COALESCE(OLD.hit_count, 0) + 1;
    NEW.last_seen_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_failures_upsert_trigger ON public.sync_failures;
CREATE TRIGGER sync_failures_upsert_trigger
  BEFORE UPDATE ON public.sync_failures
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_failures_upsert();

ALTER TABLE public.sync_failures ENABLE ROW LEVEL SECURITY;

-- Read: experts only (operators triaging incidents).
DROP POLICY IF EXISTS "sync_failures_read_admin" ON public.sync_failures;
CREATE POLICY "sync_failures_read_admin" ON public.sync_failures
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (SELECT id FROM public.users WHERE is_expert = true)
  );

-- Write: service_role only (the Edge Function bypasses RLS via service key).
GRANT SELECT ON public.sync_failures TO authenticated;
-- No INSERT/UPDATE grant for anon/authenticated.


-- ─────────────────────────────────────────────────────────────────────
-- Module 22 — Community validation (expert ID queue)
-- See docs/specs/modules/22-community-validation.md
--
-- This migration is INTENTIONALLY MINIMAL. It reuses these existing
-- pieces (do NOT redefine them):
--   • prevent_self_validation() / prevent_self_validation_trigger     (line ~599)
--   • enforce_research_grade_quality() / enforce_rg_quality_trigger   (line ~621)
--   • fire_research_grade() / fire_research_grade_trigger             (line ~998)
--   • recompute_consensus(uuid)                                       (line ~893)
--
-- Adds (all idempotent):
--   • validation_queue VIEW              — server-side eligibility
--   • id_validator_insert/update/delete  — RLS policies for the
--                                          community-vote write path
--   • partial UNIQUE index on (observation_id, validated_by)
--   • tie-handling guard inside recompute_consensus() (in-place
--     CREATE OR REPLACE — single source of truth)
--
-- ─────────────────────────────────────────────────────────────────────

-- Eligibility view used by ValidationQueueView. RLS on the underlying
-- observations table (obs_public_read) gates visibility — private obs
-- never appear. Predicate: an observation is in the queue when it's
-- synced + not fully redacted AND
--   (no primary identification) OR
--   (primary ID is not research-grade AND its confidence is < 0.5)
-- The two-clause "needs help" test avoids re-queueing already-promoted
-- rows whose confidence happens to sit between 0.4 and 0.5.
CREATE OR REPLACE VIEW public.validation_queue AS
SELECT
  o.id                               AS observation_id,
  o.observer_id,
  o.observed_at,
  o.state_province,
  o.habitat,
  o.obscure_level,
  i.id                               AS primary_id_id,
  i.scientific_name                  AS current_scientific_name,
  i.confidence                       AS current_confidence,
  COALESCE(i.is_research_grade, false) AS is_research_grade,
  (SELECT count(*)
     FROM public.identifications x
    WHERE x.observation_id = o.id
      AND x.validated_by IS NOT NULL)         AS suggestion_count,
  (SELECT count(DISTINCT x.validated_by)
     FROM public.identifications x
    WHERE x.observation_id = o.id
      AND x.validated_by IS NOT NULL)         AS distinct_voter_count
FROM public.observations o
LEFT JOIN public.identifications i
       ON i.observation_id = o.id AND i.is_primary = true
WHERE o.sync_status = 'synced'
  AND o.obscure_level IN ('none','0.1deg','0.2deg','5km')
  AND COALESCE(i.is_research_grade, false) = false
  AND (
       i.id IS NULL
    OR COALESCE(i.confidence, 0) < 0.5
  );

GRANT SELECT ON public.validation_queue TO authenticated, anon;

-- Validator INSERT path. Signed-in users can suggest a non-primary
-- identification on observations that
--   (a) they don't own,
--   (b) are publicly readable (synced + not fully redacted) — without
--       this clause, a UUID-guessing attacker could vote on any
--       observation, including drafts, outside the queue.
DROP POLICY IF EXISTS "id_validator_insert" ON public.identifications;
CREATE POLICY "id_validator_insert" ON public.identifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = validated_by
    AND validated_by IS NOT NULL
    AND is_primary = false
    AND EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.observer_id <> validated_by
        AND o.sync_status = 'synced'
        AND o.obscure_level IN ('none','0.1deg','0.2deg','5km')
    )
  );

-- Validator UPDATE: own-row only.
DROP POLICY IF EXISTS "id_validator_update" ON public.identifications;
CREATE POLICY "id_validator_update" ON public.identifications
  FOR UPDATE TO authenticated
  USING (
    validated_by IS NOT NULL
    AND (SELECT auth.uid()) = validated_by
  )
  WITH CHECK (
    (SELECT auth.uid()) = validated_by
  );

-- Validator DELETE: vote retraction.
DROP POLICY IF EXISTS "id_validator_delete" ON public.identifications;
CREATE POLICY "id_validator_delete" ON public.identifications
  FOR DELETE TO authenticated
  USING (
    validated_by IS NOT NULL
    AND (SELECT auth.uid()) = validated_by
  );

-- One suggestion per (user, observation). UPDATE the existing row to
-- change a vote.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_id_obs_validator
  ON public.identifications(observation_id, validated_by)
  WHERE validated_by IS NOT NULL;

-- recompute_consensus() — IN-PLACE CREATE OR REPLACE. Adds a tie-
-- handling guard: if multiple taxa share the winning weighted score,
-- promotion is skipped and the queue waits for a tiebreaker. The rest
-- of the function body is identical to the earlier definition.
CREATE OR REPLACE FUNCTION public.recompute_consensus(p_observation_id uuid)
RETURNS void AS $$
DECLARE
  winning_taxon uuid;
  winning_score numeric;
  validator_count integer;
  tied_count integer;
BEGIN
  WITH weighted AS (
    SELECT i.taxon_id,
           SUM(CASE WHEN u.is_expert AND t.kingdom = ANY(u.expert_taxa) THEN 3.0 ELSE 1.0 END) AS score,
           count(DISTINCT i.validated_by) AS validators
    FROM public.identifications i
    JOIN public.taxa t ON t.id = i.taxon_id
    LEFT JOIN public.users u ON u.id = i.validated_by
    WHERE i.observation_id = p_observation_id
      AND i.taxon_id IS NOT NULL
      AND i.validated_by IS NOT NULL
    GROUP BY i.taxon_id
  )
  SELECT taxon_id, score, validators
  INTO winning_taxon, winning_score, validator_count
  FROM weighted
  ORDER BY score DESC
  LIMIT 1;

  IF winning_taxon IS NULL THEN RETURN; END IF;

  -- Tie guard: refuse promotion when multiple taxa share the winning
  -- score. Without this, the LIMIT 1 above would promote one row
  -- non-deterministically.
  SELECT count(*) INTO tied_count
  FROM (
    SELECT i.taxon_id,
           SUM(CASE WHEN u.is_expert AND t.kingdom = ANY(u.expert_taxa) THEN 3.0 ELSE 1.0 END) AS score
    FROM public.identifications i
    JOIN public.taxa t ON t.id = i.taxon_id
    LEFT JOIN public.users u ON u.id = i.validated_by
    WHERE i.observation_id = p_observation_id
      AND i.taxon_id IS NOT NULL
      AND i.validated_by IS NOT NULL
    GROUP BY i.taxon_id
  ) w
  WHERE score = winning_score;
  IF tied_count > 1 THEN RETURN; END IF;

  IF winning_score >= 2.0 AND validator_count >= 2 THEN
    UPDATE public.identifications
       SET is_research_grade = true
     WHERE observation_id = p_observation_id AND taxon_id = winning_taxon AND is_primary;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow signed-in users to call recompute_consensus from PostgREST RPC
-- after submitting a suggestion. SECURITY DEFINER means the caller
-- doesn't need elevated permissions on identifications/taxa.
GRANT EXECUTE ON FUNCTION public.recompute_consensus(uuid) TO authenticated;

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

DROP POLICY IF EXISTS user_expertise_self_read   ON public.user_expertise;
DROP POLICY IF EXISTS user_expertise_public_read ON public.user_expertise;

-- Self-read: a user always sees their own expertise rows.
CREATE POLICY user_expertise_self_read ON public.user_expertise FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- Public read: only when the user has opted into both a public profile
-- AND gamification surfaces (mirrors user_badges_public_read at L587 and
-- streaks_public_read at L656).
CREATE POLICY user_expertise_public_read ON public.user_expertise FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true AND gamification_opt_in = true
    )
  );

-- INSERT/UPDATE/DELETE are intentionally NOT exposed to clients —
-- user_expertise rows are written by the in-database award_karma()
-- helper running under SECURITY DEFINER (added in a later task).

-- 2. taxa.parent_id + ancestor_path: graph + precomputed walk.
-- parent_id is a self-FK that lets us walk the lineage. Existing taxa
-- rows store the lineage as denormalized text columns (kingdom, phylum,
-- class, "order", family, genus) — we backfill parent_id by joining
-- each row to the next-shallower-rank row that exists in the table.
ALTER TABLE public.taxa
  ADD COLUMN IF NOT EXISTS parent_id     uuid REFERENCES public.taxa(id),
  ADD COLUMN IF NOT EXISTS ancestor_path uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_taxa_parent_id
  ON public.taxa(parent_id);
CREATE INDEX IF NOT EXISTS idx_taxa_ancestor_path
  ON public.taxa USING GIN (ancestor_path);

-- One-shot parent_id backfill: for each non-kingdom row, find the row
-- whose taxon_rank is the immediate parent rank and whose
-- scientific_name matches the parent's name in the denormalized
-- columns. Rows without a matching parent in the table keep parent_id
-- NULL — that's fine, ancestor_path will be '{}' and the consensus
-- engine falls back to 1× weight, which is correct.
UPDATE public.taxa t
   SET parent_id = (
     SELECT a.id FROM public.taxa a
     WHERE a.taxon_rank = (
       CASE t.taxon_rank
         WHEN 'species' THEN 'genus'
         WHEN 'genus'   THEN 'family'
         WHEN 'family'  THEN 'order'
         WHEN 'order'   THEN 'class'
         WHEN 'class'   THEN 'phylum'
         WHEN 'phylum'  THEN 'kingdom'
       END
     )
       AND a.scientific_name = (
         CASE t.taxon_rank
           WHEN 'species' THEN t.genus
           WHEN 'genus'   THEN t.family
           WHEN 'family'  THEN t."order"
           WHEN 'order'   THEN t.class
           WHEN 'class'   THEN t.phylum
           WHEN 'phylum'  THEN t.kingdom
         END
       )
     LIMIT 1
   )
 WHERE t.parent_id IS NULL
   AND t.taxon_rank IS NOT NULL
   AND t.taxon_rank <> 'kingdom';

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

-- INSERT into karma_events is restricted to service_role / SECURITY DEFINER
-- functions (award_karma). The append-only ledger has no client-write policy.

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

-- ============================================================
-- ancestor_path computation: walk parent_id chain on INSERT/UPDATE.
-- ============================================================
-- compute_ancestor_path: given a taxon's IMMEDIATE PARENT id, walk the
-- parent_id chain upward and return the array of ancestor ids
-- (most-specific first → root last). Designed to be safe inside a
-- BEFORE-trigger where NEW.id may not exist in the table yet.
-- Pass NULL to get '{}' (used for kingdom rows).
CREATE OR REPLACE FUNCTION public.compute_ancestor_path(p_parent_id uuid)
RETURNS uuid[] AS $$
DECLARE
  result uuid[] := '{}';
  current_id uuid := p_parent_id;
  pid uuid;
  guard int := 0;
BEGIN
  WHILE current_id IS NOT NULL LOOP
    result := array_append(result, current_id);
    SELECT t.parent_id INTO pid FROM public.taxa t WHERE t.id = current_id;
    current_id := pid;
    guard := guard + 1;
    IF guard > 30 THEN
      RAISE EXCEPTION 'compute_ancestor_path: cycle or runaway from parent %', p_parent_id;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.taxa_set_ancestor_path()
RETURNS trigger AS $$
BEGIN
  NEW.ancestor_path := public.compute_ancestor_path(NEW.parent_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_taxa_ancestor_path ON public.taxa;
CREATE TRIGGER trg_taxa_ancestor_path
  BEFORE INSERT OR UPDATE OF parent_id ON public.taxa
  FOR EACH ROW EXECUTE FUNCTION public.taxa_set_ancestor_path();

-- One-shot backfill of every existing taxa row.
UPDATE public.taxa SET ancestor_path = public.compute_ancestor_path(parent_id);

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
       AND t.taxon_rank = 'kingdom'
WHERE  u.is_expert = true
  AND  u.expert_taxa IS NOT NULL
ON CONFLICT (user_id, taxon_id) DO NOTHING;

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

  -- Observation taxon's lineage = self || ancestors.
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

      IF v_winner_rank IS NOT NULL
         AND (v_voter_rank IS NULL OR v_winner_rank < v_voter_rank) THEN
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

GRANT EXECUTE ON FUNCTION public.refresh_taxon_rarity() TO service_role;
