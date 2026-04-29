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
  -- Adjectives (nature/character themed, Spanish — ASCII only, no accents)
  adjectives text[] := ARRAY[
    'valiente','curioso','brillante','veloz','silencioso','audaz','sereno',
    'agil','fiero','noble','alerta','sagaz','vibrante','tenaz','libre'
  ];
  -- Mexican/LATAM fauna & flora (ASCII only, no accents or hyphens)
  especies text[] := ARRAY[
    'quetzal','ajolote','teporingo','coati','cenzontle','ocelote','tapir',
    'jaguar','manati','vaquita','guacamaya','tlacuache','armadillo','tejon',
    'coyote','puma','venado','iguana','boa','tortuga','pelicano','fragata',
    'colibri','tucan','flamenco','axolotl','cacomixtle','tlalcoyote'
  ];
  gen_username text;
  attempts int := 0;
BEGIN
  -- Generate a unique <adjective>_<species>_<3digits> username
  -- Format matches users_username_check: ^[a-zA-Z0-9_]{3,30}$
  LOOP
    gen_username := (adjectives)[1 + floor(random() * array_length(adjectives, 1))::int]
                   || '_'
                   || (especies)[1 + floor(random() * array_length(especies, 1))::int]
                   || '_'
                   || floor(random() * 900 + 100)::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE username = gen_username);
    attempts := attempts + 1;
    IF attempts >= 10 THEN
      -- Fallback: timestamp suffix guarantees uniqueness
      gen_username := (adjectives)[1 + floor(random() * array_length(adjectives, 1))::int]
                     || '_'
                     || (especies)[1 + floor(random() * array_length(especies, 1))::int]
                     || '_'
                     || extract(epoch from now())::bigint % 1000000;
      EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.users (id, avatar_url, display_name, username)
  VALUES (NEW.id, picked_avatar, picked_name, gen_username)
  ON CONFLICT (id) DO UPDATE SET
    avatar_url   = COALESCE(public.users.avatar_url,   EXCLUDED.avatar_url),
    display_name = COALESCE(public.users.display_name, EXCLUDED.display_name),
    username     = COALESCE(public.users.username,     EXCLUDED.username);
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
-- RLS for `public.taxon_usage_history` is enabled below in the RLS
-- POLICIES section once `public.observations` exists (its read policy
-- references that table; defining it here would forward-reference).

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

-- Taxon usage history (taxonomy renames/synonyms bookkeeping). Read
-- gate matches the obs_public_read pattern via correlated EXISTS:
-- a row is readable iff its linked observation is publicly viewable.
-- No write policy → RLS default-deny blocks all client writes; rows
-- are populated by future server-side rename triggers / admin ops.
--
-- Surfaced by Supabase's `rls_disabled_in_public` lint on 2026-04-27;
-- the table predates the table-by-table RLS audit and was missed.
ALTER TABLE public.taxon_usage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taxon_usage_history_public_read ON public.taxon_usage_history;
CREATE POLICY taxon_usage_history_public_read ON public.taxon_usage_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
       WHERE o.id = taxon_usage_history.observation_id
         AND o.sync_status = 'synced'
         AND o.obscure_level <> 'full'
    )
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
-- regular users by design. The admin read policy lives in the admin-console
-- foundation block at the bottom of this file (after has_role() is defined).

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

-- ═════════════════════════════════════════════════════════════════════
-- ADMIN CONSOLE FOUNDATION (PR1)
-- See docs/superpowers/specs/2026-04-27-admin-console-design.md
-- ═════════════════════════════════════════════════════════════════════

-- 1. user_role enum
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('admin', 'moderator', 'expert', 'researcher');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. user_roles join table
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES public.users(id),
  revoked_at  timestamptz,
  notes       text,
  PRIMARY KEY (user_id, role)
);

-- Partial index restricted to permanently-active rows (NULL revoked_at). Future-dated revocations are rare; has_role() handles the > now() check at query time.
CREATE INDEX IF NOT EXISTS user_roles_active_idx
  ON public.user_roles (role)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role() helper, callable from RLS predicates
CREATE OR REPLACE FUNCTION public.has_role(uid uuid, r public.user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role = r
      AND (revoked_at IS NULL OR revoked_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.user_role) FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;

-- 4. audit_op enum
DO $$ BEGIN
  CREATE TYPE public.audit_op AS ENUM (
    'role_grant', 'role_revoke',
    'user_ban', 'user_unban', 'user_delete',
    'observation_hide', 'observation_unhide',
    'observation_obscure', 'observation_force_unobscure',
    'observation_license_override', 'observation_hard_delete',
    'comment_hide', 'comment_lock', 'comment_unlock',
    'badge_award_manual', 'badge_revoke',
    'token_force_revoke',
    'feature_flag_toggle',
    'cron_force_run',
    'precise_coords_read',
    'user_pii_read',
    'token_list_read',
    'user_audit_read'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. admin_audit table
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id          bigserial PRIMARY KEY,
  actor_id    uuid NOT NULL REFERENCES public.users(id),
  op          public.audit_op NOT NULL,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text NOT NULL,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON public.admin_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON public.admin_audit (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_op_idx ON public.admin_audit (op, created_at DESC);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- 6. Sync trigger keeps users.is_expert / .credentialed_researcher cached
CREATE OR REPLACE FUNCTION public.sync_user_role_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    UPDATE public.users
       SET is_expert = public.has_role(NEW.user_id, 'expert'),
           credentialed_researcher = public.has_role(NEW.user_id, 'researcher')
     WHERE id = NEW.user_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.users
       SET is_expert = public.has_role(OLD.user_id, 'expert'),
           credentialed_researcher = public.has_role(OLD.user_id, 'researcher')
     WHERE id = OLD.user_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The trigger fires on changes to revoked_at because that's the only
-- time the active-roles set changes for a given user. The PRIMARY KEY
-- (user_id, role) prevents direct role-column mutations. If the schema
-- ever adds an alternative deactivation column (e.g., is_active), this
-- trigger needs to expand the UPDATE OF list.
DROP TRIGGER IF EXISTS user_roles_sync_flags ON public.user_roles;
CREATE TRIGGER user_roles_sync_flags
AFTER INSERT OR UPDATE OF revoked_at OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_flags();

-- 7. RLS policies
DROP POLICY IF EXISTS user_roles_admin_or_self_read ON public.user_roles;
CREATE POLICY user_roles_admin_or_self_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_no_self_write ON public.user_roles;
CREATE POLICY user_roles_no_self_write ON public.user_roles
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_audit_admin_read ON public.admin_audit;
CREATE POLICY admin_audit_admin_read ON public.admin_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_audit_no_client_write ON public.admin_audit;
CREATE POLICY admin_audit_no_client_write ON public.admin_audit
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- 8. Refactor existing api_usage / sync_failures predicates from is_expert → admin role
--    Note: the original policies were named with a different convention; we drop
--    both the historical and the new name for idempotency.
DROP POLICY IF EXISTS "api_usage_read_admin"     ON public.api_usage;
DROP POLICY IF EXISTS api_usage_expert_read       ON public.api_usage;
DROP POLICY IF EXISTS api_usage_admin_read        ON public.api_usage;
CREATE POLICY api_usage_admin_read ON public.api_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "sync_failures_read_admin" ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_expert_read   ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_admin_read    ON public.sync_failures;
CREATE POLICY sync_failures_admin_read ON public.sync_failures
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 8b. expert_applications admin-read (PR #83)
-- Originally only had read_own RLS, so the admin overview's "pending expert
-- apps" KPI couldn't read from the client (the Experts queue tab worked
-- only because it queries via the service-role-bypassing AdminExpertsView).
-- Lives in this block (post-has_role()) to avoid the forward reference
-- bug that would happen if defined alongside the table at line ~1140.
DROP POLICY IF EXISTS "expert_apps_read_admin" ON public.expert_applications;
CREATE POLICY "expert_apps_read_admin" ON public.expert_applications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 8c. karma_events admin-read (PR #86 review)
-- Originally only had self_read RLS, so the admin karma view's
-- "last 50 events" panel filtered down to the admin's own events.
-- This policy lets admins see platform-wide karma activity.
-- Lives in this block (post-has_role()) to avoid the forward reference
-- bug that would happen if defined alongside the table at line ~1592.
DROP POLICY IF EXISTS "karma_events_admin_read" ON public.karma_events;
CREATE POLICY "karma_events_admin_read" ON public.karma_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 9. Grants
GRANT SELECT                          ON public.user_roles  TO authenticated;
GRANT SELECT                          ON public.admin_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.user_roles  TO service_role;
GRANT SELECT, INSERT                  ON public.admin_audit TO service_role;

GRANT EXECUTE ON FUNCTION public.refresh_taxon_rarity() TO service_role;

-- =====================================================================
-- Module 25 — Profile Privacy & Public Profile (v1.2.0)
-- See docs/specs/modules/25-profile-privacy.md
-- =====================================================================

-- 19-key privacy matrix on users. Backed by JSONB so new facets are
-- additive (a missing key falls back to 'public' in can_see_facet).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_privacy jsonb NOT NULL DEFAULT '{
    "profile":          "public",
    "real_name":        "signed_in",
    "bio":              "public",
    "location":         "signed_in",
    "stats_counts":     "public",
    "observation_map":  "public",
    "calendar_heatmap": "public",
    "taxonomic_donut":  "public",
    "top_species":      "public",
    "streak":           "signed_in",
    "badges":           "public",
    "activity_feed":    "signed_in",
    "validation_rep":   "public",
    "obs_list":         "public",
    "watchlist":        "private",
    "goals":            "private",
    "karma_total":      "public",
    "expertise":        "public",
    "pokedex":          "public"
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_privacy_intro_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_profile_privacy
  ON public.users USING gin (profile_privacy jsonb_path_ops);

-- One-shot backfill of profile facet from the legacy boolean. The
-- WHERE guard makes this idempotent — only rows whose facet still
-- disagrees with the boolean are touched.
UPDATE public.users
SET profile_privacy = jsonb_set(
  profile_privacy,
  '{profile}',
  CASE WHEN profile_public THEN '"public"'::jsonb ELSE '"signed_in"'::jsonb END
)
WHERE profile_privacy ->> 'profile' IS DISTINCT FROM
      CASE WHEN profile_public THEN 'public' ELSE 'signed_in' END;

-- Single source of truth for facet visibility. Owner always passes;
-- anyone else gets the matrix's per-facet level. Missing key →
-- 'signed_in' (forward-compat: new facets shipped before a migration
-- backfills the matrix default to opt-in privacy for anonymous viewers).
CREATE OR REPLACE FUNCTION public.can_see_facet(
  target uuid,
  facet  text,
  viewer uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT CASE
    WHEN viewer IS NOT NULL AND viewer = target THEN true
    ELSE (
      SELECT CASE COALESCE(profile_privacy ->> facet, 'signed_in')
        WHEN 'public'    THEN true
        WHEN 'signed_in' THEN viewer IS NOT NULL
        WHEN 'private'   THEN false
        ELSE false
      END
      FROM public.users
      WHERE id = target
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_see_facet(uuid, text, uuid)
  TO anon, authenticated;

-- Batched companion — one round-trip for all facets a page needs.
CREATE OR REPLACE FUNCTION public.can_see_facets(
  target uuid,
  facets text[],
  viewer uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_object_agg(f, public.can_see_facet(target, f, viewer))
  FROM unnest(facets) AS f;
$$;

GRANT EXECUTE ON FUNCTION public.can_see_facets(uuid, text[], uuid)
  TO anon, authenticated;

-- Owner-only updates of the matrix.
DROP POLICY IF EXISTS "users_update_self_privacy" ON public.users;
CREATE POLICY "users_update_self_privacy" ON public.users
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Column-level UPDATE grant for `authenticated`. RLS WITH CHECK can only
-- gate rows, not columns, so column-level GRANTs are the mechanism that
-- prevents a user from self-elevating `is_expert` /
-- `credentialed_researcher` / `karma_total` / streak counters etc. via a
-- handcrafted REST call. The ALL-TABLES grant earlier in this file
-- (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
-- TO authenticated`) covers everything else; here we narrow public.users
-- specifically.
--
-- **Inventory:** see `docs/specs/infra/users-column-grants.md` for the
-- full per-column writer table + the SECURITY DEFINER checklist for new
-- triggers. Adding a column to either side here MUST update that doc.
REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (
  username,
  display_name,
  bio,
  avatar_url,
  region_primary,
  preferred_lang,
  observer_license,
  profile_public,
  gamification_opt_in,
  streak_digest_opt_in,
  profile_privacy,
  dismissed_privacy_intro_at,
  expert_taxa
) ON public.users TO authenticated;

-- Observation pins for the public observation_map facet. Honours
-- obscure_level + location_obscured: sensitive species → coarsened to
-- ~11 km grid, 'private' obs filtered out entirely. Visibility gate
-- runs in the WHERE clause itself so client code never sees a row it
-- shouldn't.
CREATE OR REPLACE VIEW public.profile_observation_pins AS
SELECT
  o.observer_id,
  o.id AS observation_id,
  CASE
    WHEN o.location_obscured IS NOT NULL
      THEN o.location_obscured
    ELSE o.location
  END AS location,
  i.scientific_name,
  i.is_research_grade,
  o.observed_at
FROM public.observations o
LEFT JOIN public.identifications i
  ON i.observation_id = o.id AND i.is_primary = true
WHERE
  o.sync_status = 'synced'
  AND o.obscure_level <> 'full'
  AND public.can_see_facet(o.observer_id, 'observation_map', (SELECT auth.uid()));

GRANT SELECT ON public.profile_observation_pins TO anon, authenticated;

-- Aggregate counts gated by the stats_counts facet. The
-- kingdoms_validated count is the distinct-kingdom set across the
-- user's research-grade IDs; matches the "kingdoms" stat module 22
-- derives elsewhere.
CREATE OR REPLACE VIEW public.profile_stats_counts AS
SELECT
  u.id AS owner_id,
  COALESCE((
    SELECT count(*) FROM public.observations o
     WHERE o.observer_id = u.id
       AND o.sync_status = 'synced'
       AND o.obscure_level <> 'full'
  ), 0) AS total_observations,
  COALESCE((
    SELECT count(*) FROM public.observations o
     JOIN public.identifications i
       ON i.observation_id = o.id AND i.is_primary = true
     WHERE o.observer_id = u.id
       AND o.sync_status = 'synced'
       AND o.obscure_level <> 'full'
       AND i.is_research_grade = true
  ), 0) AS research_grade_count,
  COALESCE((
    SELECT count(DISTINCT t.kingdom) FROM public.observations o
     JOIN public.identifications i
       ON i.observation_id = o.id AND i.is_primary = true
     JOIN public.taxa t ON t.id = i.taxon_id
     WHERE o.observer_id = u.id
       AND o.sync_status = 'synced'
       AND o.obscure_level <> 'full'
       AND i.is_research_grade = true
       AND t.kingdom IS NOT NULL
  ), 0) AS kingdoms_validated
FROM public.users u
WHERE public.can_see_facet(u.id, 'stats_counts', (SELECT auth.uid()));

GRANT SELECT ON public.profile_stats_counts TO anon, authenticated;

-- Module 23 hand-off: replace the open user_expertise_public_read
-- policy with a facet-gated equivalent. The drop+create is idempotent;
-- re-running module 23's migration after this lands does not regress
-- the gate (its policy creation also DROPs first, but the name has
-- diverged — superseded by user_expertise_facet_read here).
DROP POLICY IF EXISTS user_expertise_public_read ON public.user_expertise;
DROP POLICY IF EXISTS user_expertise_facet_read  ON public.user_expertise;
CREATE POLICY user_expertise_facet_read ON public.user_expertise
  FOR SELECT USING (
    public.can_see_facet(user_id, 'expertise', (SELECT auth.uid()))
  );

-- Defence-in-depth: fold the privacy-matrix `profile` facet into the four
-- legacy public-read policies that still gate on `users.profile_public`.
-- The matrix and the boolean stay dual-written by PrivacyMatrix.astro and
-- StreakCard.astro during the deprecation window, so either side opening
-- the gate is enough — but if PrivacyMatrix forgets to flip the boolean,
-- can_see_facet still does the right thing.
DROP POLICY IF EXISTS user_badges_public_read ON public.user_badges;
CREATE POLICY user_badges_public_read ON public.user_badges FOR SELECT
  USING (
    revoked_at IS NULL
    AND user_id IN (
      SELECT id FROM public.users
      WHERE gamification_opt_in = true
        AND (
          profile_public = true
          OR public.can_see_facet(id, 'profile', (SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS streaks_public_read ON public.user_streaks;
CREATE POLICY streaks_public_read ON public.user_streaks FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users
      WHERE gamification_opt_in = true
        AND (
          profile_public = true
          OR public.can_see_facet(id, 'profile', (SELECT auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS follows_public_read ON public.follows;
CREATE POLICY follows_public_read ON public.follows FOR SELECT
  USING (
    follower_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true
         OR public.can_see_facet(id, 'profile', (SELECT auth.uid()))
    )
    OR followee_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true
         OR public.can_see_facet(id, 'profile', (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS activity_public_read ON public.activity_events;
CREATE POLICY activity_public_read ON public.activity_events FOR SELECT
  USING (
    visibility = 'public'
    AND actor_id IN (
      SELECT id FROM public.users
      WHERE profile_public = true
         OR public.can_see_facet(id, 'profile', (SELECT auth.uid()))
    )
  );
-- ============ Module 25 v1.2.1 — richer profile views ============
-- Depends on v1.2.0 (sister PR): users.profile_privacy, can_see_facet(),
-- can_see_facets(), profile_observation_pins, profile_stats_counts,
-- users_update_self_privacy policy, user_expertise_facet_read policy.
-- This block is append-only; v1.2.0 lands its block before this one.

-- Calendar heatmap — daily bucket of synced observations, last 365 days.
CREATE OR REPLACE VIEW public.profile_calendar_buckets AS
SELECT
  o.observer_id          AS user_id,
  (o.observed_at AT TIME ZONE 'UTC')::date AS bucket_date,
  COUNT(*)::int          AS daily_count
FROM public.observations o
WHERE
  o.sync_status = 'synced'
  AND o.observed_at >= (now() - interval '365 days')
  AND public.can_see_facet(o.observer_id, 'calendar_heatmap', (SELECT auth.uid()))
GROUP BY o.observer_id, (o.observed_at AT TIME ZONE 'UTC')::date;

GRANT SELECT ON public.profile_calendar_buckets TO anon, authenticated;

-- Taxonomic donut — kingdom-level breakdown of synced obs.
CREATE OR REPLACE VIEW public.profile_taxonomic_donut AS
SELECT
  o.observer_id   AS user_id,
  COALESCE(t.kingdom, 'Unknown') AS kingdom,
  COUNT(*)::int   AS obs_count,
  COUNT(DISTINCT i.taxon_id)::int AS species_count
FROM public.observations o
JOIN public.identifications i
  ON i.observation_id = o.id AND i.is_primary = true
LEFT JOIN public.taxa t ON t.id = i.taxon_id
WHERE
  o.sync_status = 'synced'
  AND public.can_see_facet(o.observer_id, 'taxonomic_donut', (SELECT auth.uid()))
GROUP BY o.observer_id, COALESCE(t.kingdom, 'Unknown');

GRANT SELECT ON public.profile_taxonomic_donut TO anon, authenticated;

-- Top species — top 12 species per user, with thumbnail from primary photo.
CREATE OR REPLACE VIEW public.profile_top_species AS
WITH counted AS (
  SELECT
    o.observer_id AS user_id,
    i.taxon_id,
    i.scientific_name,
    COUNT(*)::int AS obs_count,
    -- Postgres has no min(uuid); cast through text. Surgical fix; semantic
    -- (smallest uuid lexicographically) is unchanged from the prior code.
    MIN(o.id::text)::uuid AS sample_obs_id
  FROM public.observations o
  JOIN public.identifications i
    ON i.observation_id = o.id AND i.is_primary = true
  WHERE
    o.sync_status = 'synced'
    AND o.obscure_level <> 'full'
    AND public.can_see_facet(o.observer_id, 'top_species', (SELECT auth.uid()))
  GROUP BY o.observer_id, i.taxon_id, i.scientific_name
),
ranked AS (
  SELECT *,
         row_number() OVER (PARTITION BY user_id ORDER BY obs_count DESC, scientific_name ASC) AS rnk
  FROM counted
)
SELECT
  r.user_id,
  r.taxon_id,
  r.scientific_name,
  r.obs_count,
  m.url AS thumbnail_url
FROM ranked r
LEFT JOIN LATERAL (
  SELECT mf.url FROM public.media_files mf
  WHERE mf.observation_id = r.sample_obs_id
  ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at ASC
  LIMIT 1
) m ON true
WHERE r.rnk <= 12;

GRANT SELECT ON public.profile_top_species TO anon, authenticated;

-- Validation reputation — counts of identifications submitted as voter and
-- those that promoted to research-grade.
CREATE OR REPLACE VIEW public.profile_validation_reputation AS
SELECT
  i.validated_by AS user_id,
  COUNT(*)::int  AS identifications_submitted,
  COUNT(*) FILTER (WHERE i.is_research_grade = true)::int AS promoted_research_grade,
  COUNT(*) FILTER (WHERE i.is_primary = true)::int AS accepted_as_primary
FROM public.identifications i
WHERE
  i.validated_by IS NOT NULL
  AND public.can_see_facet(i.validated_by, 'validation_rep', (SELECT auth.uid()))
GROUP BY i.validated_by;

GRANT SELECT ON public.profile_validation_reputation TO anon, authenticated;

-- Badges visible — list of unlocked badges per user.
CREATE OR REPLACE VIEW public.profile_badges_visible AS
SELECT
  ub.user_id,
  ub.badge_key,
  b.tier,
  b.category,
  b.name_en,
  b.name_es,
  b.description_en,
  b.description_es,
  ub.awarded_at
FROM public.user_badges ub
JOIN public.badges b ON b.key = ub.badge_key
WHERE
  ub.revoked_at IS NULL
  AND public.can_see_facet(ub.user_id, 'badges', (SELECT auth.uid()));

GRANT SELECT ON public.profile_badges_visible TO anon, authenticated;

-- Activity feed — recent activity_events filtered by the activity_feed facet.
CREATE OR REPLACE VIEW public.profile_activity_feed AS
SELECT
  ae.actor_id     AS user_id,
  ae.id           AS event_id,
  ae.kind         AS event_kind,
  ae.subject_id,
  ae.payload,
  ae.created_at
FROM public.activity_events ae
WHERE public.can_see_facet(ae.actor_id, 'activity_feed', (SELECT auth.uid()));

GRANT SELECT ON public.profile_activity_feed TO anon, authenticated;

-- Karma + top expertise — gated by karma_total facet. When karma_total is
-- hidden, no row is emitted; when it's visible but expertise is hidden, the
-- top_expertise aggregate is returned as an empty array.
CREATE OR REPLACE VIEW public.profile_karma AS
SELECT
  u.id               AS user_id,
  u.username,
  u.karma_total,
  u.karma_updated_at,
  CASE
    WHEN public.can_see_facet(u.id, 'expertise', (SELECT auth.uid()))
      THEN (
        SELECT jsonb_agg(jsonb_build_object(
                 'taxon_id',        e.taxon_id,
                 'scientific_name', t.scientific_name,
                 'score',           e.score
               ) ORDER BY e.score DESC)
        FROM (
          SELECT * FROM public.user_expertise
          WHERE user_id = u.id
          ORDER BY score DESC
          LIMIT 5
        ) e
        JOIN public.taxa t ON t.id = e.taxon_id
      )
    ELSE '[]'::jsonb
  END AS top_expertise
FROM public.users u
WHERE public.can_see_facet(u.id, 'karma_total', (SELECT auth.uid()));

GRANT SELECT ON public.profile_karma TO anon, authenticated;

-- Pokédex — every taxon the user has observed, joined to taxon_rarity.
CREATE OR REPLACE VIEW public.profile_pokedex AS
SELECT
  o.observer_id   AS user_id,
  i.taxon_id,
  t.scientific_name,
  t.kingdom,
  tr.bucket       AS rarity_bucket,
  MIN(o.observed_at) AS first_observed_at,
  COUNT(*)::int   AS obs_count
FROM public.observations o
JOIN public.identifications i
  ON i.observation_id = o.id AND i.is_primary = true
JOIN public.taxa t                ON t.id = i.taxon_id
LEFT JOIN public.taxon_rarity tr  ON tr.taxon_id = i.taxon_id
WHERE
  o.sync_status = 'synced'
  AND o.obscure_level <> 'private'
  AND public.can_see_facet(o.observer_id, 'pokedex', (SELECT auth.uid()))
GROUP BY o.observer_id, i.taxon_id, t.scientific_name, t.kingdom, tr.bucket;

GRANT SELECT ON public.profile_pokedex TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- Module 27 — Establishment Means (organism origin)
-- Requested by Eugenio Padilla, 2026-04-28.
-- Darwin Core: establishmentMeans / occurrenceStatus field.
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS establishment_means text NOT NULL DEFAULT 'wild'
    CHECK (establishment_means IN ('wild','cultivated','captive','uncertain'));

COMMENT ON COLUMN public.observations.establishment_means IS
  'Darwin Core establishmentMeans. wild=native wild individual; '
  'cultivated=planted/cultivated plant or managed population; '
  'captive=domestic animal, zoo, aquarium; uncertain=observer not sure.';

-- Backfill existing rows (all pre-existing observations assumed wild —
-- the only reasonable default for a biodiversity app in the field).
UPDATE public.observations SET establishment_means = 'wild'
  WHERE establishment_means IS DISTINCT FROM 'wild';

-- Index for diversity queries filtering by establishment_means = 'wild'.
CREATE INDEX IF NOT EXISTS idx_obs_establishment_means
  ON public.observations(establishment_means);

-- =====================================================================
-- Module 26 — social graph + reactions (2026-04-28)
-- =====================================================================

-- 1) follows
-- Note: public.follows was first defined in v1.0 (module 08, line ~792)
-- with only (follower_id, followee_id, created_at). Module 26 extends it
-- with tier/status/requested_at/accepted_at + CHECK constraints. We use
-- ALTER TABLE ADD COLUMN IF NOT EXISTS so existing prod DBs (where the
-- v1.0 definition already created the table) get the new columns rather
-- than silently no-op'ing on CREATE TABLE IF NOT EXISTS.
ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS tier         text        NOT NULL DEFAULT 'follower',
  ADD COLUMN IF NOT EXISTS status       text        NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS accepted_at  timestamptz;

DO $$ BEGIN
  ALTER TABLE public.follows ADD CONSTRAINT follows_tier_check   CHECK (tier IN ('follower', 'collaborator'));
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.follows ADD CONSTRAINT follows_status_check CHECK (status IN ('pending', 'accepted'));
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.follows ADD CONSTRAINT follows_no_self      CHECK (follower_id <> followee_id);
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_follows_followee_status
  ON public.follows(followee_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_follower_status
  ON public.follows(follower_id, status);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follows_read ON public.follows;
CREATE POLICY follows_read ON public.follows FOR SELECT USING (
  -- Owners always see their edges; everyone else sees only accepted edges
  follower_id = auth.uid()
  OR followee_id = auth.uid()
  OR status = 'accepted'
);

DROP POLICY IF EXISTS follows_owner_write ON public.follows;
CREATE POLICY follows_owner_write ON public.follows FOR INSERT
  WITH CHECK (follower_id = auth.uid());

DROP POLICY IF EXISTS follows_followee_update ON public.follows;
CREATE POLICY follows_followee_update ON public.follows FOR UPDATE
  USING (followee_id = auth.uid())
  WITH CHECK (followee_id = auth.uid());

DROP POLICY IF EXISTS follows_owner_delete ON public.follows;
CREATE POLICY follows_owner_delete ON public.follows FOR DELETE
  USING (follower_id = auth.uid() OR followee_id = auth.uid());

-- 2) Counters on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS follower_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count  integer NOT NULL DEFAULT 0;

-- 3) Counter trigger.
-- SECURITY DEFINER is REQUIRED because the function UPDATEs
-- public.users.{follower_count, following_count}, which the column-level
-- REVOKE/GRANT pattern (`grants_locked_columns` block above) does NOT
-- expose to invoker roles. Without this, the trigger fails with
-- "permission denied for table users" and the parent INSERT into
-- follows is rolled back — surfaces as a 400 from the follow Edge
-- Function.
CREATE OR REPLACE FUNCTION public.tg_follows_counter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.status = 'accepted' THEN
      UPDATE public.users SET follower_count  = follower_count  + 1 WHERE id = NEW.followee_id;
      UPDATE public.users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.status <> 'accepted' AND NEW.status = 'accepted' THEN
      UPDATE public.users SET follower_count  = follower_count  + 1 WHERE id = NEW.followee_id;
      UPDATE public.users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSIF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
      UPDATE public.users SET follower_count  = GREATEST(follower_count  - 1, 0) WHERE id = NEW.followee_id;
      UPDATE public.users SET following_count = GREATEST(following_count - 1, 0) WHERE id = NEW.follower_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.status = 'accepted' THEN
      UPDATE public.users SET follower_count  = GREATEST(follower_count  - 1, 0) WHERE id = OLD.followee_id;
      UPDATE public.users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS follows_counter_trigger ON public.follows;
CREATE TRIGGER follows_counter_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.tg_follows_counter();

-- 4) Backfill counters (idempotent)
UPDATE public.users u SET
  follower_count  = (SELECT count(*) FROM public.follows WHERE followee_id = u.id AND status = 'accepted'),
  following_count = (SELECT count(*) FROM public.follows WHERE follower_id = u.id AND status = 'accepted');

-- 5) Social privacy helpers
CREATE OR REPLACE FUNCTION public.social_visible_to(viewer uuid, owner uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    viewer IS NOT NULL AND (
      viewer = owner
      OR EXISTS (
        SELECT 1 FROM public.follows f
         WHERE f.follower_id = viewer
           AND f.followee_id = owner
           AND f.status      = 'accepted'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_collaborator_of(viewer uuid, owner uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.follows f
     WHERE f.follower_id = viewer
       AND f.followee_id = owner
       AND f.tier        = 'collaborator'
       AND f.status      = 'accepted'
  );
$$;

GRANT EXECUTE ON FUNCTION public.social_visible_to(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_collaborator_of(uuid, uuid) TO anon, authenticated;

-- 6) Collaborators inherit credentialed-researcher coord-precision unlock
DROP POLICY IF EXISTS obs_collaborator_read ON public.observations;
CREATE POLICY obs_collaborator_read ON public.observations FOR SELECT
  USING (
    obscure_level <> 'full'
    AND public.is_collaborator_of(auth.uid(), observer_id)
  );

-- 7-pre) blocks (must exist before any reaction policy that references it)
-- Originally defined as section 10 below — moved up because the reaction
-- policies in sections 7/8/9 subquery public.blocks. Keeping CREATE TABLE
-- here and policies further down would also work, but co-locating keeps
-- the section coherent.
CREATE TABLE IF NOT EXISTS public.blocks (
  blocker_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blocks_owner_read ON public.blocks;
CREATE POLICY blocks_owner_read ON public.blocks FOR SELECT
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocks_owner_write ON public.blocks;
CREATE POLICY blocks_owner_write ON public.blocks FOR INSERT
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocks_owner_delete ON public.blocks;
CREATE POLICY blocks_owner_delete ON public.blocks FOR DELETE
  USING (blocker_id = auth.uid());

-- 7) observation_reactions
CREATE TABLE IF NOT EXISTS public.observation_reactions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id)        ON DELETE CASCADE,
  observation_id uuid        NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  kind           text        NOT NULL
                             CHECK (kind IN ('fave','agree_id','needs_id','confirm_id','helpful')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, observation_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_obsreact_obs_kind
  ON public.observation_reactions(observation_id, kind);
CREATE INDEX IF NOT EXISTS idx_obsreact_user
  ON public.observation_reactions(user_id, created_at DESC);

ALTER TABLE public.observation_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obsreact_read ON public.observation_reactions;
CREATE POLICY obsreact_read ON public.observation_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
       WHERE o.id = observation_reactions.observation_id
         AND (
           o.observer_id = auth.uid()
           OR (
             o.obscure_level <> 'full'
             AND public.can_see_facet(o.observer_id, 'observations', auth.uid())
           )
           OR public.is_collaborator_of(auth.uid(), o.observer_id)
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
       WHERE (b.blocker_id = auth.uid() AND b.blocked_id = observation_reactions.user_id)
          OR (b.blocked_id = auth.uid() AND b.blocker_id = observation_reactions.user_id)
    )
  );

DROP POLICY IF EXISTS obsreact_write ON public.observation_reactions;
CREATE POLICY obsreact_write ON public.observation_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS obsreact_delete ON public.observation_reactions;
CREATE POLICY obsreact_delete ON public.observation_reactions FOR DELETE
  USING (user_id = auth.uid());

-- 8) photo_reactions (against media_files)
CREATE TABLE IF NOT EXISTS public.photo_reactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.users(id)       ON DELETE CASCADE,
  media_file_id   uuid        NOT NULL REFERENCES public.media_files(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('fave','helpful')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, media_file_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_photoreact_media_kind
  ON public.photo_reactions(media_file_id, kind);

ALTER TABLE public.photo_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photoreact_read ON public.photo_reactions;
CREATE POLICY photoreact_read ON public.photo_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.media_files m
        JOIN public.observations o ON o.id = m.observation_id
       WHERE m.id = photo_reactions.media_file_id
         AND (
           o.observer_id = auth.uid()
           OR (
             o.obscure_level <> 'full'
             AND public.can_see_facet(o.observer_id, 'observations', auth.uid())
           )
           OR public.is_collaborator_of(auth.uid(), o.observer_id)
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
       WHERE (b.blocker_id = auth.uid() AND b.blocked_id = photo_reactions.user_id)
          OR (b.blocked_id = auth.uid() AND b.blocker_id = photo_reactions.user_id)
    )
  );

DROP POLICY IF EXISTS photoreact_write ON public.photo_reactions;
CREATE POLICY photoreact_write ON public.photo_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS photoreact_delete ON public.photo_reactions;
CREATE POLICY photoreact_delete ON public.photo_reactions FOR DELETE
  USING (user_id = auth.uid());

-- 9) identification_reactions
CREATE TABLE IF NOT EXISTS public.identification_reactions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES public.users(id)           ON DELETE CASCADE,
  identification_id uuid        NOT NULL REFERENCES public.identifications(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('agree_id','disagree_id','helpful')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, identification_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_idreact_id_kind
  ON public.identification_reactions(identification_id, kind);

ALTER TABLE public.identification_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idreact_read ON public.identification_reactions;
CREATE POLICY idreact_read ON public.identification_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.identifications i
        JOIN public.observations o ON o.id = i.observation_id
       WHERE i.id = identification_reactions.identification_id
         AND (
           o.observer_id = auth.uid()
           OR (
             o.obscure_level <> 'full'
             AND public.can_see_facet(o.observer_id, 'observations', auth.uid())
           )
           OR public.is_collaborator_of(auth.uid(), o.observer_id)
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
       WHERE (b.blocker_id = auth.uid() AND b.blocked_id = identification_reactions.user_id)
          OR (b.blocked_id = auth.uid() AND b.blocker_id = identification_reactions.user_id)
    )
  );

DROP POLICY IF EXISTS idreact_write ON public.identification_reactions;
CREATE POLICY idreact_write ON public.identification_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS idreact_delete ON public.identification_reactions;
CREATE POLICY idreact_delete ON public.identification_reactions FOR DELETE
  USING (user_id = auth.uid());

-- 10) blocks — moved up to "7-pre" so reactions policies (sections 7/8/9)
-- can reference public.blocks before it's referenced. Section number kept
-- as a marker for the original module-26 ordering.

-- 11) reports
CREATE TABLE IF NOT EXISTS public.reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid                 REFERENCES public.users(id) ON DELETE SET NULL,
  target_type  text        NOT NULL
                           CHECK (target_type IN ('user','observation','photo','identification','comment')),
  target_id    uuid        NOT NULL,
  reason       text        NOT NULL
                           CHECK (reason IN ('spam','harassment','wrong_id','privacy_violation','copyright','other')),
  note         text,
  status       text        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','triaged','resolved','dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON public.reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter
  ON public.reports(reporter_id, created_at DESC);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Reporters can see their own reports; nobody else (operators read via service role).
DROP POLICY IF EXISTS reports_owner_read ON public.reports;
CREATE POLICY reports_owner_read ON public.reports FOR SELECT
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS reports_owner_write ON public.reports;
CREATE POLICY reports_owner_write ON public.reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

-- 12) notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text        NOT NULL
                          CHECK (kind IN ('follow','follow_accepted','reaction','comment','mention',
                                          'identification','badge','digest')),
  payload     jsonb       NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_owner_read ON public.notifications;
CREATE POLICY notif_owner_read ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notif_owner_update ON public.notifications;
CREATE POLICY notif_owner_update ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notif_owner_delete ON public.notifications;
CREATE POLICY notif_owner_delete ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- Server-side inserts (Edge Functions) use service role and bypass RLS;
-- explicitly forbid client-side inserts.
DROP POLICY IF EXISTS notif_no_client_insert ON public.notifications;
CREATE POLICY notif_no_client_insert ON public.notifications FOR INSERT
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.prune_old_notifications()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.notifications
   WHERE read_at IS NOT NULL
     AND read_at < now() - interval '90 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 13) Fan-out: follow → notification
CREATE OR REPLACE FUNCTION public.tg_follow_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Skip if recipient has blocked the actor.
  IF EXISTS (SELECT 1 FROM public.blocks
              WHERE blocker_id = NEW.followee_id AND blocked_id = NEW.follower_id) THEN
    RETURN NEW;
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.status = 'pending') THEN
    INSERT INTO public.notifications(user_id, kind, payload)
    VALUES (NEW.followee_id, 'follow',
            jsonb_build_object('actor_id', NEW.follower_id, 'tier', NEW.tier, 'status', 'pending'));
  ELSIF (TG_OP = 'INSERT' AND NEW.status = 'accepted') THEN
    INSERT INTO public.notifications(user_id, kind, payload)
    VALUES (NEW.followee_id, 'follow',
            jsonb_build_object('actor_id', NEW.follower_id, 'tier', NEW.tier, 'status', 'accepted'));
  ELSIF (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted') THEN
    INSERT INTO public.notifications(user_id, kind, payload)
    VALUES (NEW.follower_id, 'follow_accepted',
            jsonb_build_object('actor_id', NEW.followee_id, 'tier', NEW.tier));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follows_notify_trigger ON public.follows;
CREATE TRIGGER follows_notify_trigger
  AFTER INSERT OR UPDATE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.tg_follow_notify();

-- 14) Fan-out: observation_reactions → notification
CREATE OR REPLACE FUNCTION public.tg_obsreact_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT observer_id INTO v_owner FROM public.observations
   WHERE id = NEW.observation_id;
  IF v_owner IS NULL OR v_owner = NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.blocks
              WHERE blocker_id = v_owner AND blocked_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.notifications(user_id, kind, payload)
  VALUES (v_owner, 'reaction',
          jsonb_build_object(
            'actor_id', NEW.user_id,
            'target_type', 'observation',
            'target_id', NEW.observation_id,
            'kind', NEW.kind
          ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS obsreact_notify_trigger ON public.observation_reactions;
CREATE TRIGGER obsreact_notify_trigger
  AFTER INSERT ON public.observation_reactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_obsreact_notify();

-- 15) Audit columns. The column-level GRANT on `public.users`
-- intentionally does NOT include `updated_at` (it's an audit column
-- — clients shouldn't dictate it). Without this BEFORE UPDATE trigger
-- the column would silently rot. The trigger sets NEW.updated_at on
-- every row update so the DB owns the timestamp.
--
-- See docs/specs/infra/users-column-grants.md for the column inventory.
CREATE OR REPLACE FUNCTION public.tg_users_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_touch_updated_at ON public.users;
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_users_touch_updated_at();

-- ═════════════════════════════════════════════════════════════════════
-- Module 27 — Expertise Legends (regional rankings)
-- Issue #47 — "Top identificador de Fabaceae en Oaxaca"
-- ═════════════════════════════════════════════════════════════════════

-- View: user_expertise_regional
-- Computes per-user, per-taxon, per-region score and rank.
-- Region = state_province of the observations the user has made for that taxon.
-- Only covers users with profile_public=true AND gamification_opt_in=true.
CREATE OR REPLACE VIEW public.user_expertise_regional AS
SELECT
  ue.user_id,
  ue.taxon_id,
  t.scientific_name                              AS taxon_name,
  COALESCE(t.family, t.scientific_name)          AS taxon_family,
  t.taxon_rank,
  COALESCE(o.state_province, 'México')           AS region,
  ue.score,
  rank() OVER (
    PARTITION BY ue.taxon_id, COALESCE(o.state_province, 'México')
    ORDER BY ue.score DESC
  )                                              AS region_rank,
  rank() OVER (
    PARTITION BY ue.taxon_id
    ORDER BY ue.score DESC
  )                                              AS national_rank
FROM public.user_expertise ue
JOIN public.taxa t ON t.id = ue.taxon_id
LEFT JOIN LATERAL (
  SELECT state_province
  FROM public.observations
  WHERE observer_id = ue.user_id
    AND primary_taxon_id = ue.taxon_id
    AND state_province IS NOT NULL
  GROUP BY state_province
  ORDER BY COUNT(*) DESC
  LIMIT 1
) o ON true
JOIN public.users u ON u.id = ue.user_id
WHERE u.profile_public = true
  AND u.gamification_opt_in = true
  AND ue.score > 0;

GRANT SELECT ON public.user_expertise_regional TO anon, authenticated;

-- Function: top_expertise_legend(user_id)
-- Returns the single highest-ranked legend for a user (for badge display).
CREATE OR REPLACE FUNCTION public.top_expertise_legend(p_user_id uuid)
RETURNS TABLE (
  taxon_name   text,
  taxon_family text,
  taxon_rank   text,
  region       text,
  score        numeric,
  region_rank  bigint,
  tier         text   -- 'legend' | 'expert' | 'reference' | 'active'
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    taxon_name,
    taxon_family,
    taxon_rank,
    region,
    score,
    region_rank,
    CASE
      WHEN region_rank = 1  THEN 'legend'
      WHEN region_rank <= 3 THEN 'expert'
      WHEN region_rank <= 10 THEN 'reference'
      ELSE 'active'
    END AS tier
  FROM public.user_expertise_regional
  WHERE user_id = p_user_id
  ORDER BY region_rank ASC, score DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.top_expertise_legend(uuid) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- Backfill: assign default usernames to existing users without one
-- Run once after deploying handle_new_user() update.
-- ═════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  adjectives text[] := ARRAY[
    'valiente','curioso','brillante','veloz','silencioso','audaz','sereno',
    'agil','fiero','noble','alerta','sagaz','vibrante','tenaz','libre'
  ];
  especies text[] := ARRAY[
    'quetzal','ajolote','teporingo','coati','cenzontle','ocelote','tapir',
    'jaguar','manati','vaquita','guacamaya','tlacuache','armadillo','tejon',
    'coyote','puma','venado','iguana','boa','tortuga','pelicano','fragata',
    'colibri','tucan','flamenco','axolotl','cacomixtle','tlalcoyote'
  ];
  rec RECORD;
  gen_username text;
  attempts int;
BEGIN
  FOR rec IN SELECT id FROM public.users WHERE username IS NULL OR username = '' LOOP
    attempts := 0;
    LOOP
      gen_username := (adjectives)[1 + floor(random() * array_length(adjectives, 1))::int]
                     || '_'
                     || (especies)[1 + floor(random() * array_length(especies, 1))::int]
                     || '_'
                     || floor(random() * 900 + 100)::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE username = gen_username);
      attempts := attempts + 1;
      IF attempts >= 10 THEN
        gen_username := (adjectives)[1 + floor(random() * array_length(adjectives, 1))::int]
                       || '_'
                       || (especies)[1 + floor(random() * array_length(especies, 1))::int]
                       || '_'
                       || extract(epoch from now())::bigint % 1000000;
        EXIT;
      END IF;
    END LOOP;
    UPDATE public.users SET username = gen_username WHERE id = rec.id;
  END LOOP;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- ADMIN CONSOLE PR3 — read-only ops views (cron status)
-- ═════════════════════════════════════════════════════════════════════

-- Cron runs view — exposes pg_cron's job_run_details to admins via a
-- SECURITY DEFINER function. Filtered to rastrum-relevant jobnames so
-- the operator sees only their jobs, not Supabase internals.
CREATE OR REPLACE FUNCTION public.list_admin_cron_runs(p_limit int DEFAULT 50)
RETURNS TABLE (
  jobname          text,
  schedule         text,
  last_run_at      timestamptz,
  last_status      text,
  last_duration_ms int,
  return_message   text,
  runs_today       int,
  success_rate_24h numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, cron
AS $$
  WITH relevant_jobs AS (
    SELECT j.jobid, j.jobname, j.schedule
    FROM cron.job j
    WHERE j.jobname ~ '^(streak-|badges-|enrich-|plantnet-|recompute-|refresh-|nightly-)'
  ),
  last_runs AS (
    SELECT DISTINCT ON (r.jobid)
      r.jobid, r.status, r.start_time, r.end_time, r.return_message,
      EXTRACT(EPOCH FROM (r.end_time - r.start_time)) * 1000 AS duration_ms
    FROM cron.job_run_details r
    WHERE r.jobid IN (SELECT jobid FROM relevant_jobs)
    ORDER BY r.jobid, r.start_time DESC
  ),
  today_stats AS (
    SELECT
      r.jobid,
      COUNT(*)::int AS runs_today,
      (COUNT(*) FILTER (WHERE r.status = 'succeeded'))::numeric
        / NULLIF(COUNT(*), 0) AS success_rate_24h
    FROM cron.job_run_details r
    WHERE r.jobid IN (SELECT jobid FROM relevant_jobs)
      AND r.start_time > now() - interval '24 hours'
    GROUP BY r.jobid
  )
  SELECT
    j.jobname,
    j.schedule,
    l.start_time      AS last_run_at,
    l.status::text    AS last_status,
    l.duration_ms::int,
    l.return_message,
    COALESCE(t.runs_today, 0)       AS runs_today,
    COALESCE(t.success_rate_24h, 0) AS success_rate_24h
  FROM relevant_jobs j
  LEFT JOIN last_runs l    ON l.jobid = j.jobid
  LEFT JOIN today_stats t  ON t.jobid = j.jobid
  ORDER BY j.jobname
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.list_admin_cron_runs(int) FROM public;
-- Intentionally NOT granted to authenticated — only the _guarded wrapper below
-- should be callable by end users. Granting authenticated on the inner function
-- would let any logged-in user bypass the has_role check entirely.
GRANT EXECUTE ON FUNCTION public.list_admin_cron_runs(int) TO service_role;

-- Why STABLE on list_admin_cron_runs_guarded:
--   auth.uid() reads a session GUC (request.jwt.claims) that is set once
--   per PostgREST request and does not change within a single query
--   execution. STABLE is therefore correct — the function returns the same
--   result for the same p_limit within one statement.
--
--   VOLATILE would be wrong: it suppresses inlining and forces a
--   materialisation barrier, degrading query optimization for no benefit.
--
--   The has_role check runs once per call (not per row) because it lives in
--   the BEGIN block before the RETURN QUERY — any admin check failure raises
--   immediately, before any rows from the inner function are fetched.
--
--   The inner list_admin_cron_runs (unguarded) is SECURITY DEFINER so it
--   can read the cron schema; it must NOT be granted to authenticated
--   directly — only service_role. All authenticated callers must go through
--   this _guarded wrapper.
CREATE OR REPLACE FUNCTION public.list_admin_cron_runs_guarded(p_limit int DEFAULT 50)
RETURNS TABLE (
  jobname          text,
  schedule         text,
  last_run_at      timestamptz,
  last_status      text,
  last_duration_ms int,
  return_message   text,
  runs_today       int,
  success_rate_24h numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'requires admin role';
  END IF;
  RETURN QUERY SELECT * FROM public.list_admin_cron_runs(p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.list_admin_cron_runs_guarded(int) FROM public;
GRANT EXECUTE ON FUNCTION public.list_admin_cron_runs_guarded(int) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- ADMIN CONSOLE PR4 — observations admin actions (hide/obscure/license)
-- ═════════════════════════════════════════════════════════════════════

-- Admin moderation columns (additive, idempotent).
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS hidden        boolean    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS hidden_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by     uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_observations_hidden
  ON public.observations(hidden, sync_status)
  WHERE hidden = true;

-- Public-read gate: extend obs_public_read so hidden observations are
-- excluded from anon/authenticated feeds. Owner can still see their own.
DROP POLICY IF EXISTS "obs_public_read" ON public.observations;
CREATE POLICY "obs_public_read" ON public.observations
  FOR SELECT
  TO anon, authenticated
  USING (
    sync_status = 'synced'
    AND hidden = false
    AND (
      obscure_level = 'none'
      OR location_obscured IS NOT NULL
    )
  );

-- Owner can read all of their own observations regardless of hidden state.
-- The existing obs_owner policy covers FOR ALL (SELECT + write), but we
-- add this explicit SELECT policy so the hidden gate above doesn't
-- accidentally block the owner's own read when obs_owner's USING clause
-- is evaluated under the default-deny model with multiple policies.
-- (Postgres ORs policies of the same permissive type, so the owner's
-- ALL policy already allows reads; this is belt-and-suspenders clarity.)

-- Admin can SELECT everything (including hidden) for the moderation tab.
DROP POLICY IF EXISTS "obs_admin_full_read" ON public.observations;
CREATE POLICY "obs_admin_full_read" ON public.observations
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ═════════════════════════════════════════════════════════════════════
-- ADMIN CONSOLE PR5 — moderator surface (reports / comments / bans)
-- ═════════════════════════════════════════════════════════════════════

-- Extend audit_op for new moderator actions.
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'report_triaged';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'report_resolved';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'report_dismissed';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'comment_unhide';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- locked column on comments for mod use (enforcement-on-insert is a v1.1 follow-up).
ALTER TABLE public.observation_comments ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

-- Soft-ban table — rows are never deleted on unban; revoked_at marks the lift.
CREATE TABLE IF NOT EXISTS public.user_bans (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  banned_by     uuid        REFERENCES public.users(id),
  reason        text        NOT NULL,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid        REFERENCES public.users(id),
  revoke_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_bans_user_active
  ON public.user_bans(user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_bans ENABLE ROW LEVEL SECURITY;

-- Moderators and admins can read all bans. Banned users can read their own row.
DROP POLICY IF EXISTS user_bans_mod_read ON public.user_bans;
CREATE POLICY user_bans_mod_read ON public.user_bans
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'moderator')
    OR public.has_role(auth.uid(), 'admin')
    OR user_id = auth.uid()
  );

-- No client-side writes — service role only via Edge Function.
-- Three separate per-command policies replace the previous FOR ALL form for
-- clarity; Postgres processes them independently per statement type.
DROP POLICY IF EXISTS user_bans_no_client_write ON public.user_bans;
DROP POLICY IF EXISTS user_bans_no_client_insert ON public.user_bans;
DROP POLICY IF EXISTS user_bans_no_client_update ON public.user_bans;
DROP POLICY IF EXISTS user_bans_no_client_delete ON public.user_bans;
CREATE POLICY user_bans_no_client_insert ON public.user_bans FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY user_bans_no_client_update ON public.user_bans FOR UPDATE TO authenticated USING (false);
CREATE POLICY user_bans_no_client_delete ON public.user_bans FOR DELETE TO authenticated USING (false);

GRANT SELECT ON public.user_bans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bans TO service_role;

-- is_user_banned(uid) — SECURITY DEFINER so RLS predicates can call it
-- without exposing user_bans rows directly.
CREATE OR REPLACE FUNCTION public.is_user_banned(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_bans
    WHERE user_id = uid
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.is_user_banned(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_user_banned(uuid) TO authenticated, service_role;

-- Moderator read access for reports (previously service_role only).
DROP POLICY IF EXISTS reports_mod_read ON public.reports;
CREATE POLICY reports_mod_read ON public.reports
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'moderator')
    OR public.has_role(auth.uid(), 'admin')
    OR reporter_id = auth.uid()
  );

-- Moderator read access for observation_comments (full view, including deleted).
DROP POLICY IF EXISTS comments_mod_read ON public.observation_comments;
CREATE POLICY comments_mod_read ON public.observation_comments
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'moderator')
    OR public.has_role(auth.uid(), 'admin')
    OR author_id = auth.uid()
    OR (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.observations o WHERE o.id = observation_id AND o.hidden = false))
  );
-- ============================================================
-- Module 27 — AI Sponsorships
-- See docs/specs/modules/27-ai-sponsorships.md and
-- docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md
-- ============================================================

-- Vault prerequisite. Available on Supabase Cloud; vanilla Postgres (CI
-- validate gate, local dev) doesn't ship the vault extension binary.
-- We skip silently in those environments — the helper functions below
-- reference vault.* via dynamic SQL (EXECUTE), so they compile even when
-- the schema is missing. Decryption only fires in production via the
-- Edge Function which runs against Supabase Cloud.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vault') THEN
    CREATE EXTENSION IF NOT EXISTS vault;
  ELSE
    RAISE NOTICE 'vault extension not available — skipping (expected in CI / vanilla Postgres)';
  END IF;
END $$;

-- 1. Enums (idempotent via DO blocks)
DO $$ BEGIN CREATE TYPE public.ai_provider AS ENUM ('anthropic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.ai_credential_kind AS ENUM ('api_key', 'oauth_token');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.ai_sponsorship_status AS ENUM ('active', 'paused', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. sponsor_credentials — credencial reusable. El secret real vive en
--    Supabase Vault; aquí solo guardamos metadata + vault_secret_id.
CREATE TABLE IF NOT EXISTS public.sponsor_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider        public.ai_provider NOT NULL,
  kind            public.ai_credential_kind NOT NULL,
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  vault_secret_id uuid NOT NULL,
  validated_at    timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);
CREATE INDEX IF NOT EXISTS sponsor_credentials_user_active_idx
  ON public.sponsor_credentials (user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.sponsor_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsor_credentials_owner_read ON public.sponsor_credentials;
CREATE POLICY sponsor_credentials_owner_read ON public.sponsor_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. sponsorships — relación sponsor→beneficiary→credential. Self-sponsoring
--    está permitido (no CHECK sponsor_id <> beneficiary_id) para que el sponsor
--    use la misma UI para su propio uso. Karma triggers protegen contra
--    recompensar self-flow.
CREATE TABLE IF NOT EXISTS public.sponsorships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  beneficiary_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id      uuid NOT NULL REFERENCES public.sponsor_credentials(id) ON DELETE RESTRICT,
  provider           public.ai_provider NOT NULL,
  monthly_call_cap   integer NOT NULL CHECK (monthly_call_cap BETWEEN 1 AND 10000),
  priority           smallint NOT NULL DEFAULT 100,
  status             public.ai_sponsorship_status NOT NULL DEFAULT 'active',
  paused_reason      text,
  paused_at          timestamptz,
  beneficiary_public boolean NOT NULL DEFAULT false,
  sponsor_public     boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, beneficiary_id, provider)
);
CREATE INDEX IF NOT EXISTS sponsorships_beneficiary_active_idx
  ON public.sponsorships (beneficiary_id, provider, priority) WHERE status = 'active';
ALTER TABLE public.sponsorships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsorships_party_read ON public.sponsorships;
CREATE POLICY sponsorships_party_read ON public.sponsorships
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid() OR beneficiary_id = auth.uid());
DROP POLICY IF EXISTS sponsorships_public_read ON public.sponsorships;
CREATE POLICY sponsorships_public_read ON public.sponsorships
  FOR SELECT TO anon, authenticated
  USING (status = 'active' AND sponsor_public AND beneficiary_public);

-- 4. ai_usage — append-only ledger. Source of truth para cap enforcement,
--    karma, analytics. No UPDATE/DELETE policies → effectively immutable.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  sponsor_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       public.ai_provider NOT NULL,
  tokens_in      integer,
  tokens_out     integer,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_sponsorship_month_idx
  ON public.ai_usage (sponsorship_id, occurred_at);
CREATE INDEX IF NOT EXISTS ai_usage_sponsor_month_idx
  ON public.ai_usage (sponsor_id, occurred_at);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_party_read ON public.ai_usage;
CREATE POLICY ai_usage_party_read ON public.ai_usage
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid() OR beneficiary_id = auth.uid());

-- Defense-in-depth: explicitly deny INSERT/UPDATE/DELETE from authenticated
-- and anon clients via RESTRICTIVE policies. Without these, RLS already
-- denies (no permissive policy = denied), but explicit RESTRICTIVE policies
-- guarantee a future "auto-expose new tables" misconfig or an accidental
-- permissive write policy can't open a write path. Service role bypasses
-- RLS entirely, so the Edge Function continues to write normally.
DROP POLICY IF EXISTS ai_usage_no_client_insert ON public.ai_usage;
CREATE POLICY ai_usage_no_client_insert ON public.ai_usage
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS ai_usage_no_client_update ON public.ai_usage;
CREATE POLICY ai_usage_no_client_update ON public.ai_usage
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS ai_usage_no_client_delete ON public.ai_usage;
CREATE POLICY ai_usage_no_client_delete ON public.ai_usage
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- 5. ai_rate_limits — sliding-window por buckets de 1min para detectar
--    >30 calls / 10min. Cleanup diario.
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  beneficiary_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       public.ai_provider NOT NULL,
  bucket         timestamptz NOT NULL,
  count          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (beneficiary_id, provider, bucket)
);
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
-- Service-role only.
DROP POLICY IF EXISTS ai_rate_limits_no_client_insert ON public.ai_rate_limits;
CREATE POLICY ai_rate_limits_no_client_insert ON public.ai_rate_limits
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS ai_rate_limits_no_client_update ON public.ai_rate_limits;
CREATE POLICY ai_rate_limits_no_client_update ON public.ai_rate_limits
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS ai_rate_limits_no_client_delete ON public.ai_rate_limits;
CREATE POLICY ai_rate_limits_no_client_delete ON public.ai_rate_limits
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- 6. ai_usage_monthly — denormalized rollup para queries de analytics rápidas.
CREATE TABLE IF NOT EXISTS public.ai_usage_monthly (
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  year_month     date NOT NULL,
  calls          integer NOT NULL,
  tokens_in      bigint,
  tokens_out     bigint,
  PRIMARY KEY (sponsorship_id, year_month)
);
ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_monthly_party_read ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_party_read ON public.ai_usage_monthly
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsorships s
    WHERE s.id = ai_usage_monthly.sponsorship_id
      AND (s.sponsor_id = auth.uid() OR s.beneficiary_id = auth.uid())
  ));
DROP POLICY IF EXISTS ai_usage_monthly_no_client_insert ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_no_client_insert ON public.ai_usage_monthly
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS ai_usage_monthly_no_client_update ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_no_client_update ON public.ai_usage_monthly
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS ai_usage_monthly_no_client_delete ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_no_client_delete ON public.ai_usage_monthly
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- 7. ai_errors_log — transient log para errores transitorios. Retención 30 días.
CREATE TABLE IF NOT EXISTS public.ai_errors_log (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sponsorship_id  uuid REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  beneficiary_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provider        public.ai_provider NOT NULL,
  http_status     integer NOT NULL,
  error_code      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_errors_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_errors_log_party_read ON public.ai_errors_log;
CREATE POLICY ai_errors_log_party_read ON public.ai_errors_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsorships s
    WHERE s.id = ai_errors_log.sponsorship_id
      AND (s.sponsor_id = auth.uid() OR s.beneficiary_id = auth.uid())
  ));

-- 8. notifications_sent — idempotencia para emails de threshold (80%/100%).
CREATE TABLE IF NOT EXISTS public.notifications_sent (
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  threshold      smallint NOT NULL CHECK (threshold IN (80, 100)),
  year_month     date NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sponsorship_id, threshold, year_month)
);
ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;
-- Service-role only.
DROP POLICY IF EXISTS notifications_sent_no_client_insert ON public.notifications_sent;
CREATE POLICY notifications_sent_no_client_insert ON public.notifications_sent
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS notifications_sent_no_client_update ON public.notifications_sent;
CREATE POLICY notifications_sent_no_client_update ON public.notifications_sent
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS notifications_sent_no_client_delete ON public.notifications_sent;
CREATE POLICY notifications_sent_no_client_delete ON public.notifications_sent
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- 9. resolve_sponsorship — devuelve la mejor credencial activa con cuota.
CREATE OR REPLACE FUNCTION public.resolve_sponsorship(
  p_beneficiary uuid, p_provider public.ai_provider
) RETURNS TABLE (
  sponsorship_id uuid, sponsor_id uuid, credential_id uuid, vault_secret_id uuid,
  kind public.ai_credential_kind, used_this_month integer, monthly_call_cap integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH active AS (
    SELECT s.id, s.sponsor_id, s.credential_id, s.monthly_call_cap, s.priority, s.created_at
    FROM   public.sponsorships s
    JOIN   public.sponsor_credentials c ON c.id = s.credential_id
    WHERE  s.beneficiary_id = p_beneficiary AND s.provider = p_provider
      AND  s.status = 'active' AND c.revoked_at IS NULL
    ORDER  BY s.priority ASC, s.created_at ASC
  ),
  with_usage AS (
    SELECT a.*, (SELECT count(*)::int FROM public.ai_usage u
                 WHERE u.sponsorship_id = a.id
                   AND u.occurred_at >= date_trunc('month', now())) AS used
    FROM active a
  )
  SELECT w.id, w.sponsor_id, w.credential_id, c.vault_secret_id, c.kind, w.used, w.monthly_call_cap
  FROM   with_usage w JOIN public.sponsor_credentials c ON c.id = w.credential_id
  WHERE  w.used < w.monthly_call_cap
  ORDER  BY w.priority ASC, w.created_at ASC
  LIMIT  1;
$$;
REVOKE ALL ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) TO service_role;

-- 10. Extend karma_events.reason CHECK to include sponsorship reasons.
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call'
  ));

-- 11. add_karma_simple — generic karma helper.
CREATE OR REPLACE FUNCTION public.add_karma_simple(
  p_user_id uuid, p_delta numeric, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.karma_events (user_id, delta, reason) VALUES (p_user_id, p_delta, p_reason);
  UPDATE public.users
     SET karma_total = karma_total + p_delta, karma_updated_at = now()
   WHERE id = p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.add_karma_simple(uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.add_karma_simple(uuid, numeric, text) TO service_role;

-- 12. award_sponsor_karma — +1 per call mientras under cap; sin karma para
--     self-sponsoring; sin karma si beneficiary <10 karma propio.
CREATE OR REPLACE FUNCTION public.award_sponsor_karma() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cap int; used int; beneficiary_karma numeric;
BEGIN
  IF NEW.sponsor_id = NEW.beneficiary_id THEN RETURN NEW; END IF;
  SELECT karma_total INTO beneficiary_karma FROM public.users WHERE id = NEW.beneficiary_id;
  IF COALESCE(beneficiary_karma, 0) < 10 THEN RETURN NEW; END IF;
  SELECT monthly_call_cap INTO cap FROM public.sponsorships WHERE id = NEW.sponsorship_id;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE sponsorship_id = NEW.sponsorship_id
      AND occurred_at >= date_trunc('month', NEW.occurred_at);
  IF used <= cap THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id, 1, 'ai_sponsor_call');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_usage_award_karma ON public.ai_usage;
CREATE TRIGGER ai_usage_award_karma AFTER INSERT ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.award_sponsor_karma();

-- 13. award_sponsorship_base_karma — +20 al activar, -20 al revocar/pausar.
CREATE OR REPLACE FUNCTION public.award_sponsorship_base_karma() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sponsor_id = NEW.beneficiary_id THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.status = 'active') OR
     (TG_OP = 'UPDATE' AND OLD.status <> 'active' AND NEW.status = 'active') THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id,  20, 'ai_sponsorship_active');
  ELSIF (TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active') THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id, -20, 'ai_sponsorship_revoked');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sponsorships_award_base_karma ON public.sponsorships;
CREATE TRIGGER sponsorships_award_base_karma AFTER INSERT OR UPDATE OF status ON public.sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.award_sponsorship_base_karma();

-- 14. Extender audit_op para operaciones del módulo 20.
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_create';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_revoke';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_rotate';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_create';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_pause';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_unpause';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_revoke';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_quota_hit';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'vault_failure';

-- 15. Helper para increment atómico del bucket de rate limit.
CREATE OR REPLACE FUNCTION public.increment_rate_limit_bucket(
  p_beneficiary uuid, p_provider public.ai_provider, p_bucket timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ai_rate_limits (beneficiary_id, provider, bucket, count)
    VALUES (p_beneficiary, p_provider, p_bucket, 1)
  ON CONFLICT (beneficiary_id, provider, bucket)
    DO UPDATE SET count = ai_rate_limits.count + 1;
END $$;
REVOKE ALL ON FUNCTION public.increment_rate_limit_bucket(uuid, public.ai_provider, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit_bucket(uuid, public.ai_provider, timestamptz) TO service_role;

-- 16. Vault helpers. Function bodies use EXECUTE so the vault.* references
--     are resolved at runtime, not at function-creation time. This lets
--     the schema apply cleanly in CI / vanilla Postgres where the vault
--     extension is absent. At runtime in production these only fire from
--     the Edge Function (Supabase Cloud) where vault is always present.
CREATE OR REPLACE FUNCTION public.create_vault_secret(p_secret text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  EXECUTE 'SELECT vault.create_secret($1, $2)' INTO v_id USING p_secret, p_name;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_vault_secret(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_vault_secret(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_vault_secret(p_secret_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  EXECUTE 'DELETE FROM vault.secrets WHERE id = $1' USING p_secret_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_vault_secret(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_vault_secret(uuid) TO service_role;

-- 17. upsert_vault_secret_by_name — used by CI to sync the cron token to
--     Vault on every db-apply. We can't use psql's `:'var'` substitution
--     inside dollar-quoted DO blocks (psql skips substitution there),
--     so the workflow calls this function with a regular bind variable.
--     EXECUTE keeps the body resolvable in CI Postgres without vault.
CREATE OR REPLACE FUNCTION public.upsert_vault_secret_by_name(p_name text, p_secret text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_id uuid; v_id uuid;
BEGIN
  EXECUTE 'SELECT id FROM vault.secrets WHERE name = $1' INTO existing_id USING p_name;
  IF existing_id IS NOT NULL THEN
    EXECUTE 'SELECT vault.update_secret($1, $2, $3)' USING existing_id, p_secret, p_name;
    RETURN existing_id;
  ELSE
    EXECUTE 'SELECT vault.create_secret($1, $2)' INTO v_id USING p_secret, p_name;
    RETURN v_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.upsert_vault_secret_by_name(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_vault_secret_by_name(text, text) TO service_role;

-- =====================================================================
-- Module 28 — community discovery (2026-04-29)
--
-- Schema deltas + dual views for the /community/observers/ page. See
-- docs/specs/modules/28-community-discovery.md and
-- docs/superpowers/specs/2026-04-29-community-discovery-design.md.
--
-- Counter columns are read-only from app code; the recompute-user-stats
-- Edge Function (PR2) populates them nightly. country_code is the only
-- column users can write directly (via Profile → Edit, PR4).
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

-- 2) Partial indexes — every list query operates on an already-filtered
-- set, so opted-out / private users add zero cost to anyone's query plan.
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

-- 3) ISO-3166 alpha-2 reference table — seeded once, never written from app code.
CREATE TABLE IF NOT EXISTS public.iso_countries (
  code    text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name_en text NOT NULL,
  name_es text NOT NULL
);

ALTER TABLE public.iso_countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS iso_countries_read ON public.iso_countries;
CREATE POLICY iso_countries_read ON public.iso_countries
  FOR SELECT TO PUBLIC USING (true);

GRANT SELECT ON public.iso_countries TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_iso_countries_name_en_trgm
  ON public.iso_countries USING GIN (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_iso_countries_name_es_trgm
  ON public.iso_countries USING GIN (name_es gin_trgm_ops);

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
  ('JM', 'Jamaica',              'Jamaica'),
  ('MX', 'Mexico',               'México'),
  ('NI', 'Nicaragua',            'Nicaragua'),
  ('PA', 'Panama',                'Panamá'),
  ('PY', 'Paraguay',              'Paraguay'),
  ('PE', 'Peru',                  'Perú'),
  ('PR', 'Puerto Rico',           'Puerto Rico'),
  ('TT', 'Trinidad and Tobago',   'Trinidad y Tobago'),
  ('US', 'United States',         'Estados Unidos'),
  ('UY', 'Uruguay',               'Uruguay'),
  ('VE', 'Venezuela',             'Venezuela'),
  ('ES', 'Spain',                 'España'),
  ('PT', 'Portugal',              'Portugal'),
  ('FR', 'France',                'Francia'),
  ('DE', 'Germany',               'Alemania'),
  ('IT', 'Italy',                 'Italia'),
  ('GB', 'United Kingdom',        'Reino Unido')
ON CONFLICT (code) DO UPDATE
  SET name_en = EXCLUDED.name_en,
      name_es = EXCLUDED.name_es;

-- 5) Country-code normalizer. Case-insensitive exact match against
-- name_en/name_es/code first; falls back to pg_trgm similarity > 0.6.
-- Returns NULL on miss. The Edge Function (PR2) calls this only when
-- country_code IS NULL, so user-set values are never overwritten.
CREATE OR REPLACE FUNCTION public.normalize_country_code(p_input text)
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH input AS (SELECT lower(trim(coalesce(p_input, ''))) AS q)
  SELECT code FROM (
    SELECT code, 0 AS rank
      FROM public.iso_countries, input
     WHERE input.q <> ''
       AND (lower(name_en) = input.q OR lower(name_es) = input.q OR lower(code) = input.q)
    UNION ALL
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

-- 6) Anon-safe view — discovery-safe columns only, NO centroid.
-- The eligibility predicate lives in exactly one place per view; both
-- views read profile_public live (no caching), so toggling private
-- drops a user from the list on the next request.
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

-- 7) Authenticated-only view — adds centroid_geog for the Nearby
-- feature. Anon callers cannot read centroid via any path; the lack of
-- a GRANT to anon is the security gate (mirrored in UI by the sign-in
-- requirement).
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
-- Explicitly NO grant to anon. Lack of grant is the security gate.

-- =====================================================================
-- Module 26 v1.1 — observation_reaction_summary (2026-04-29)
--
-- Aggregate reaction counts per observation/kind, used by feed cards
-- (ExploreRecent + MyObservations) to render a small "❤ N" chip without
-- an N+1. Rows surface only when the underlying observation_reactions
-- row is readable by the caller — `security_invoker = true` forces the
-- view to evaluate RLS as the caller, not the view owner.
-- =====================================================================
CREATE OR REPLACE VIEW public.observation_reaction_summary
  WITH (security_invoker = true) AS
SELECT observation_id, kind, COUNT(*)::int AS count
  FROM public.observation_reactions
 GROUP BY observation_id, kind;

GRANT SELECT ON public.observation_reaction_summary TO anon, authenticated;

-- 8) recompute_user_stats() — called by the nightly Edge Function.
-- supabase-js cannot execute multi-statement CTE+UPDATE, so the aggregate
-- lives in a SECURITY DEFINER function. Restricted to service_role to keep
-- it off the public surface; the cron-only Edge Function uses the
-- auto-injected SUPABASE_SERVICE_ROLE_KEY to invoke it via db.rpc(...).
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

-- ============================================================
-- Observation detail redesign — material edit tracking + soft-delete
-- (2026-04-29) — see docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md
-- ============================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS last_material_edit_at timestamptz;

ALTER TABLE public.media_files
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_media_files_active
  ON public.media_files (observation_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.observations.last_material_edit_at IS
  'Set by observations_material_edit_check_trg when the owner makes a material edit (location > 1 km, observed_at > 24 h, primary_taxon_id change, or photo soft-delete). NULL means no material edits since creation.';

COMMENT ON COLUMN public.media_files.deleted_at IS
  'Soft-delete sentinel. Non-NULL means the owner removed this photo via the obs detail Photos tab. R2 blob is NOT removed in v1; gc-orphan-media cron is a v1.1 follow-up.';

CREATE OR REPLACE FUNCTION public.observations_material_edit_check()
RETURNS trigger AS $$
DECLARE
  is_material boolean := false;
BEGIN
  -- Location moved more than 1 km
  IF NEW.location IS DISTINCT FROM OLD.location AND OLD.location IS NOT NULL THEN
    IF ST_Distance(NEW.location, OLD.location) > 1000 THEN
      is_material := true;
    END IF;
  END IF;

  -- observed_at moved more than 24 hours
  IF NEW.observed_at IS DISTINCT FROM OLD.observed_at AND OLD.observed_at IS NOT NULL THEN
    IF abs(extract(epoch FROM (NEW.observed_at - OLD.observed_at))) > 86400 THEN
      is_material := true;
    END IF;
  END IF;

  -- primary taxon changed (denormalized from identifications by sync_primary_id_trigger)
  IF NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id THEN
    is_material := true;
  END IF;

  IF is_material THEN
    NEW.last_material_edit_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS observations_material_edit_check_trg ON public.observations;
CREATE TRIGGER observations_material_edit_check_trg
  BEFORE UPDATE ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.observations_material_edit_check();

NOTIFY pgrst, 'reload schema';
-- ============================================================
-- Module 27 — Sponsorship requests (beneficiary-initiated discovery)
-- See docs/specs/modules/27-ai-sponsorships.md
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsorship_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_sponsor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message           text CHECK (message IS NULL OR length(message) <= 280),
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','withdrawn')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  CHECK (requester_id <> target_sponsor_id),
  UNIQUE (requester_id, target_sponsor_id)
);

CREATE INDEX IF NOT EXISTS sponsorship_requests_target_pending_idx
  ON public.sponsorship_requests (target_sponsor_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS sponsorship_requests_requester_idx
  ON public.sponsorship_requests (requester_id, created_at DESC);

ALTER TABLE public.sponsorship_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsorship_requests_party_read ON public.sponsorship_requests;
CREATE POLICY sponsorship_requests_party_read ON public.sponsorship_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR target_sponsor_id = auth.uid());

-- Defense-in-depth: explicit RESTRICTIVE deny for client writes (writes go via Edge Function).
DROP POLICY IF EXISTS sponsorship_requests_no_client_insert ON public.sponsorship_requests;
CREATE POLICY sponsorship_requests_no_client_insert ON public.sponsorship_requests
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS sponsorship_requests_no_client_update ON public.sponsorship_requests;
CREATE POLICY sponsorship_requests_no_client_update ON public.sponsorship_requests
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS sponsorship_requests_no_client_delete ON public.sponsorship_requests;
CREATE POLICY sponsorship_requests_no_client_delete ON public.sponsorship_requests
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- Extend audit_op enum
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'sponsorship_request_create';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'sponsorship_request_approve';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'sponsorship_request_reject';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'sponsorship_request_withdraw';
-- ════════════════════════════════════════════════════════════════════════════
-- PR8 — admin console hardening
-- ════════════════════════════════════════════════════════════════════════════

-- 1. app_feature_flags — DB-backed feature flags (kills TS/SQL duplication).
--    Runtime source of truth replaces compile-time src/lib/feature-flags.ts
--    which now serves only as seed data.

CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  value       boolean NOT NULL DEFAULT false,
  category    text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.users(id)
);

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_public_read ON public.app_feature_flags;
CREATE POLICY feature_flags_public_read ON public.app_feature_flags
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS feature_flags_no_client_write ON public.app_feature_flags;
CREATE POLICY feature_flags_no_client_write ON public.app_feature_flags
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS feature_flags_no_client_update ON public.app_feature_flags;
CREATE POLICY feature_flags_no_client_update ON public.app_feature_flags
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS feature_flags_no_client_delete ON public.app_feature_flags;
CREATE POLICY feature_flags_no_client_delete ON public.app_feature_flags
  FOR DELETE TO authenticated USING (false);

GRANT SELECT ON public.app_feature_flags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_feature_flags TO service_role;

-- Seed from src/lib/feature-flags.ts (preserves value on replay).
INSERT INTO public.app_feature_flags (key, name, description, value, category)
VALUES
  ('parallelCascade',        'Parallel cascade ID',                   'Run identifier plugins concurrently rather than sequentially. Reduces median latency at the cost of slightly higher API spend.',                                          true,  'identification'),
  ('megadetectorPreflight',  'MegaDetector preflight',                'Run MegaDetector before PlantNet / iNaturalist to skip photos with no detectable animal or plant. Reduces wasted API calls on blank or human-only photos.',              false, 'identification'),
  ('pushNotifications',      'Push notifications',                    'Web Push (VAPID) for follows, badge awards, and validation outcomes. Requires a service-worker registration and user permission grant.',                                   false, 'pwa'),
  ('localAiIdentification',  'Local AI identification (WebLLM)',      'On-device Phi-3.5-vision identification via WebLLM. Downloads a ~2 GB model on first use. Off by default — gated on explicit user opt-in.',                            false, 'identification'),
  ('darwinCoreExport',       'Darwin Core Archive export',            'Allow authenticated users to download their observations as a DwC-A ZIP via the export-dwca Edge Function.',                                                            true,  'admin'),
  ('socialGraph',            'Social graph (follows / reactions)',    'Module 26 social surfaces: follow/unfollow, notification bell, reactions strip on observation cards.',                                                                     true,  'social'),
  ('bioblitzEvents',         'Bioblitz events UI',                    'Public listing and participation UI for bioblitz events. Ships when the first organizer requests an event.',                                                              false, 'admin')
ON CONFLICT (key) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      category    = EXCLUDED.category;
  -- value is intentionally NOT updated on conflict — preserves runtime toggles.

-- 2. karma_config — DB-backed karma reason deltas (kills TS/SQL duplication).
--    Display source for the admin console. The award_karma() SQL function
--    remains the runtime write source; a future PR can migrate it to read
--    from this table. For now this is the display source.

CREATE TABLE IF NOT EXISTS public.karma_config (
  reason         text PRIMARY KEY,
  delta          numeric,
  description_en text,
  description_es text,
  label_en       text,
  label_es       text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.users(id)
);

ALTER TABLE public.karma_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karma_config_public_read ON public.karma_config;
CREATE POLICY karma_config_public_read ON public.karma_config FOR SELECT USING (true);

GRANT SELECT ON public.karma_config TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.karma_config TO service_role;

-- Seed from src/lib/karma-config.ts (preserves delta on replay).
INSERT INTO public.karma_config (reason, delta, label_en, label_es, description_en, description_es)
VALUES
  ('observation_synced', 1,    'Observation synced',    'Observación sincronizada',  'Awarded when a user syncs a new observation to the platform.',                     'Otorgado cuando el usuario sincroniza una observación nueva.'),
  ('consensus_win',      5,    'Consensus win',         'Consenso ganador',          'Base delta before rarity/streak/expertise/confidence multipliers.',                'Delta base antes de multiplicadores.'),
  ('consensus_loss',     -2,   'Consensus loss',        'Consenso perdido',          'Base penalty before rarity/confidence multipliers (capped at 2×).',               'Penalización base antes de multiplicadores (máx 2×).'),
  ('first_in_rastrum',   10,   'First in Rastrum',      'Primero en Rastrum',        'Awarded for the first observation of a taxon ever recorded on the platform.',     'Otorgado por la primera observación de un taxón registrada en la plataforma.'),
  ('comment_reaction',   0.5,  'Comment reaction',      'Reacción en comentario',    'Awarded when another user reacts positively to a comment.',                       'Otorgado cuando otro usuario reacciona positivamente a un comentario.'),
  ('manual_adjust',      NULL, 'Manual adjustment',     'Ajuste manual',             'Admin-issued karma adjustment. Delta varies per case.',                           'Ajuste de karma emitido por un administrador. El delta varía por caso.')
ON CONFLICT (reason) DO UPDATE
  SET label_en       = EXCLUDED.label_en,
      label_es       = EXCLUDED.label_es,
      description_en = EXCLUDED.description_en,
      description_es = EXCLUDED.description_es;
  -- delta is intentionally NOT updated on conflict — preserves any future runtime edits.

-- 3. karma_rarity_multipliers — DB-backed rarity multipliers.

CREATE TABLE IF NOT EXISTS public.karma_rarity_multipliers (
  bucket        text PRIMARY KEY,
  multiplier    numeric NOT NULL,
  label_en      text,
  label_es      text,
  display_order int NOT NULL DEFAULT 0
);

ALTER TABLE public.karma_rarity_multipliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karma_rarity_multipliers_public_read ON public.karma_rarity_multipliers;
CREATE POLICY karma_rarity_multipliers_public_read ON public.karma_rarity_multipliers FOR SELECT USING (true);

GRANT SELECT ON public.karma_rarity_multipliers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.karma_rarity_multipliers TO service_role;

-- Seed from src/lib/karma-config.ts RARITY_MULTIPLIERS.
INSERT INTO public.karma_rarity_multipliers (bucket, multiplier, label_en, label_es, display_order)
VALUES
  ('1', 1.0, 'Very common (top 10%)',      'Muy común (top 10%)',          1),
  ('2', 1.5, 'Common (50–90th pctile)',    'Común (percentil 50–90)',      2),
  ('3', 2.5, 'Uncommon (10–50th pctile)',  'Poco común (percentil 10–50)', 3),
  ('4', 4.0, 'Rare (bottom 10%)',          'Raro (10% inferior)',          4),
  ('5', 5.0, 'Very rare (<5 obs)',         'Muy raro (<5 obs)',            5)
ON CONFLICT (bucket) DO UPDATE
  SET label_en = EXCLUDED.label_en,
      label_es = EXCLUDED.label_es;
  -- multiplier is intentionally NOT updated on conflict.

-- 4. Extend audit_op for taxon conservation actions if not already present.
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'taxon_conservation_set';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
