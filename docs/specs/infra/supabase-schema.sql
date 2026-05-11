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

-- The `extensions` schema holds relocated extensions (pg_trgm — see the
-- "Security Advisor remediation" block at the end of this file). We create
-- it here, and pre-add it to the session search_path, so that any DDL
-- referencing pg_trgm operators / opclasses resolves whether or not the
-- extension has already been moved on this database. Idempotent.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
SET search_path TO public, extensions, pg_temp;

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
  ADD COLUMN IF NOT EXISTS profile_public        boolean  NOT NULL DEFAULT true,
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
  ADD COLUMN IF NOT EXISTS credentialed_by       uuid REFERENCES public.users(id),
  -- v1.1: granular notification preferences. Per-toggle key/value JSON
  -- (push_after_rain, push_migration_window, email_weekly_digest, …).
  -- Read/written only by the row owner — gated by users_self_read /
  -- users_self_update policies, never exposed via users_public_read.
  ADD COLUMN IF NOT EXISTS notification_prefs    jsonb NOT NULL DEFAULT '{}'::jsonb;

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

  -- Content sensitivity (v1.1+): blur/gate graphic photos (dead animals, predation, wounds)
  content_sensitive  boolean NOT NULL DEFAULT false,

  -- Per-observation license override (v1.0.x). NULL = use observer's default.
  license               text CHECK (license IN ('CC BY 4.0','CC BY-NC 4.0','CC0')),

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

-- Idempotent column add for existing databases (v1.1+)
ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS content_sensitive boolean NOT NULL DEFAULT false;

-- Idempotent column add for existing databases (v1.0.x)
ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS license text CHECK (license IN ('CC BY 4.0','CC BY-NC 4.0','CC0'));

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
                  CHECK (source IN (
                    -- Server-side cascade
                    'plantnet','claude_haiku','claude_sonnet','onnx_offline','human',
                    -- Client-side identifiers
                    'birdnet_lite','onnx_efficientnet_lite0','camera_trap_megadetector','phi_vision',
                    -- M32 multi-provider vision (each provider tags its result with its kind)
                    'bedrock','openai','azure_openai','gemini','vertex_ai'
                  )),
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
  -- Source photo tracking (M03 v1.1): when a media_file is a crop or
  -- derivative of another photo (e.g., MegaDetector bbox crop), this
  -- points to the original. NULL for original uploads.
  source_photo_id     uuid REFERENCES public.media_files(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_observation ON media_files(observation_id);

-- Idempotent column add for existing databases (M03 v1.1)
ALTER TABLE public.media_files ADD COLUMN IF NOT EXISTS source_photo_id uuid REFERENCES public.media_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_media_source_photo ON media_files(source_photo_id) WHERE source_photo_id IS NOT NULL;

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
  USING    ((SELECT auth.uid()) = observer_id)
  -- Explicit WITH CHECK prevents Postgres from falling back to the USING clause
  -- on INSERT/UPDATE, which in complex policy environments can trigger 42P17
  -- infinite recursion when other permissive policies subquery this table.
  WITH CHECK ((SELECT auth.uid()) = observer_id);

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
-- Fixed 2026-04-30: replaced correlated subquery with EXISTS (42P17 prevention)
CREATE POLICY "obs_credentialed_read" ON public.observations FOR SELECT
  USING (
    sync_status = 'synced'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND credentialed_researcher = true
    )
  );

-- Identifications: tied to observation access
DROP POLICY IF EXISTS "id_owner" ON public.identifications;
-- Fixed 2026-04-30: IN (SELECT id FROM observations ...) → EXISTS to prevent 42P17
-- recursion. The IN subquery re-evaluates RLS on observations during INSERT,
-- causing infinite recursion (42P17). EXISTS breaks the cycle.
CREATE POLICY "id_owner" ON public.identifications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (SELECT auth.uid()) = o.observer_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (SELECT auth.uid()) = o.observer_id
    )
  );

DROP POLICY IF EXISTS "id_public_read" ON public.identifications;
-- Fixed 2026-04-30: IN (SELECT) → EXISTS to prevent 42P17 chain
CREATE POLICY "id_public_read" ON public.identifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.sync_status = 'synced'
    )
  );

-- Media: same as observations
DROP POLICY IF EXISTS "media_owner" ON public.media_files;
-- Fixed 2026-04-30: same EXISTS fix as id_owner (42P17 recursion prevention)
CREATE POLICY "media_owner" ON public.media_files FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (SELECT auth.uid()) = o.observer_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND (SELECT auth.uid()) = o.observer_id
    )
  );

DROP POLICY IF EXISTS "media_public_read" ON public.media_files;
-- Fixed 2026-04-30: IN (SELECT) → EXISTS to prevent 42P17 chain
CREATE POLICY "media_public_read" ON public.media_files FOR SELECT
  USING (
    metadata_redacted = false
    AND EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.sync_status = 'synced'
    )
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

-- Auto-resolve taxon_id from scientific_name when an identification is
-- inserted without an explicit taxon_id. This ensures the profile_pokedex
-- view (which JOINs on taxa) can find the row.
CREATE OR REPLACE FUNCTION public.resolve_identification_taxon()
RETURNS trigger AS $$
BEGIN
  IF NEW.taxon_id IS NULL AND NEW.scientific_name IS NOT NULL THEN
    SELECT id INTO NEW.taxon_id
    FROM public.taxa
    WHERE scientific_name = NEW.scientific_name
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS resolve_id_taxon_trigger ON public.identifications;
CREATE TRIGGER resolve_id_taxon_trigger
  BEFORE INSERT OR UPDATE OF scientific_name ON public.identifications
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_identification_taxon();

-- Backfill: resolve taxon_id for existing identifications that were inserted
-- before the resolve_id_taxon_trigger existed.
UPDATE public.identifications i
SET taxon_id = t.id
FROM public.taxa t
WHERE i.taxon_id IS NULL
  AND i.scientific_name IS NOT NULL
  AND t.scientific_name = i.scientific_name;

-- Keep observations.primary_taxon_id / obscure_level / location_obscured
-- in sync with the primary identification. Runs whenever an identification
-- row is flagged is_primary = true.
CREATE OR REPLACE FUNCTION public.sync_primary_identification()
RETURNS trigger AS $$
DECLARE
  v_taxon_id      uuid;
  v_obscure_level text;
  v_raw_loc       geography(Point, 4326);
BEGIN
  IF NOT NEW.is_primary THEN
    RETURN NEW;
  END IF;

  -- Resolve taxon_id: use the explicit value if present, otherwise look up
  -- by scientific_name. This handles Edge Function / client inserts that
  -- supply scientific_name but not taxon_id (identify EF, sync.ts client).
  -- Without this fallback, observations.primary_taxon_id stays NULL and
  -- the /explore/species/ grid shows no species. See issue #475.
  v_taxon_id := NEW.taxon_id;
  IF v_taxon_id IS NULL AND NEW.scientific_name IS NOT NULL THEN
    SELECT id INTO v_taxon_id
    FROM public.taxa
    WHERE scientific_name = NEW.scientific_name
    LIMIT 1;
  END IF;

  SELECT obscure_level INTO v_obscure_level
  FROM public.taxa WHERE id = v_taxon_id;

  SELECT location INTO v_raw_loc
  FROM public.observations WHERE id = NEW.observation_id;

  UPDATE public.observations
  SET primary_taxon_id = v_taxon_id,
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

  -- Also patch the identification row so taxon_id is persisted for future
  -- trigger runs (e.g. if is_primary flips again on the same row).
  IF v_taxon_id IS NOT NULL AND NEW.taxon_id IS NULL THEN
    UPDATE public.identifications
    SET taxon_id = v_taxon_id
    WHERE id = NEW.id;
  END IF;

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
-- Fixed 2026-04-30: IN (SELECT) → EXISTS to prevent 42P17 chain
CREATE POLICY comments_public_read ON public.observation_comments FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.sync_status = 'synced'
    )
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

-- ─────────────────────────────────────────────────────────────────────
-- Streak / diversity / easter-egg predicates (#701)
-- ─────────────────────────────────────────────────────────────────────
-- All return SETOF uuid — list of users currently eligible. The award-badges
-- Edge Function diffs against user_badges and inserts new rows.
CREATE OR REPLACE FUNCTION public.badge_eligible_streak(p_min integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT s.user_id
      FROM public.user_streaks s
     WHERE s.current_days >= p_min;
END
$$;

CREATE OR REPLACE FUNCTION public.badge_eligible_state_diversity(p_min integer)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT o.observer_id
      FROM public.observations o
     WHERE o.sync_status = 'synced'
       AND o.state_province IS NOT NULL
       AND length(btrim(o.state_province)) > 0
     GROUP BY o.observer_id
    HAVING count(DISTINCT btrim(o.state_province)) >= p_min;
END
$$;

CREATE OR REPLACE FUNCTION public.badge_eligible_midnight_observation(p_user_id uuid DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Midnight is evaluated in the observer's timezone (falls back to UTC when
  -- users.timezone is NULL). Mirrors the pattern in detect_admin_anomalies()
  -- so a user observing at 1am their local time qualifies regardless of UTC.
  RETURN QUERY
    SELECT DISTINCT o.observer_id
      FROM public.observations o
      LEFT JOIN public.users u ON u.id = o.observer_id
     WHERE o.sync_status = 'synced'
       AND EXTRACT(HOUR FROM o.observed_at AT TIME ZONE COALESCE(u.timezone, 'UTC')) BETWEEN 0 AND 4
       AND (p_user_id IS NULL OR o.observer_id = p_user_id);
END
$$;

REVOKE EXECUTE ON FUNCTION public.badge_eligible_streak(integer)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.badge_eligible_state_diversity(integer)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.badge_eligible_midnight_observation(uuid)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.badge_eligible_streak(integer)                TO service_role;
GRANT EXECUTE ON FUNCTION public.badge_eligible_state_diversity(integer)       TO service_role;
GRANT EXECUTE ON FUNCTION public.badge_eligible_midnight_observation(uuid)     TO service_role;

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

-- #830 — Restrict anonymous LIST on media bucket.
-- Individual object reads stay public (required for CDN / direct <img> URLs);
-- listing (bulk enumeration) is restricted to authenticated users to prevent
-- unauthenticated harvesting of all uploaded observation photos.
-- See docs/runbooks/storage-security.md for verification steps.
DROP POLICY IF EXISTS "media_authenticated_list" ON storage.objects;
CREATE POLICY "media_authenticated_list" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] != '.keep'
  );

-- #831 — Leaked Password Protection (HIBP) is enabled via the Supabase
-- Dashboard (Auth → Settings → Security → Enable Leaked Password Protection).
-- It uses k-anonymity prefix queries against the Have I Been Pwned API;
-- the full password hash never leaves Supabase infrastructure.
-- See docs/runbooks/leaked-password-protection.md for the enable procedure
-- and verification steps.
-- NOTE: This is a project-level configuration toggle, not a SQL setting.

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

-- Edge Function uses service_role key; authenticated needs SELECT for the
-- RLS policies to fire (read own tokens list in the UI via direct client).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_api_tokens TO service_role;
GRANT SELECT, UPDATE                 ON public.user_api_tokens TO authenticated;

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
--
-- DROP VIEW first because the column shape evolved (PR #258 reordered
-- columns to add `current_taxon_id` before `current_scientific_name`)
-- and Postgres CREATE OR REPLACE VIEW does not permit column renames /
-- reordering. Without this DROP, db-apply.yml fails on existing DBs
-- with "cannot change name of view column …". Idempotent: IF EXISTS
-- makes the DROP safe on first apply.
DROP VIEW IF EXISTS public.validation_queue CASCADE;
CREATE OR REPLACE VIEW public.validation_queue AS
SELECT
  o.id                               AS observation_id,
  o.observer_id,
  o.observed_at,
  o.state_province,
  o.habitat,
  o.obscure_level,
  i.id                               AS primary_id_id,
  i.taxon_id                         AS current_taxon_id,
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

-- karma_events realtime publication membership.
-- Required so signed-in users can subscribe to their own INSERTs via
-- supabase-js Realtime (see src/lib/karma-toast.ts subscribeToKarmaEvents).
-- The `karma_events_self_read` RLS policy above + server-side filter
-- `user_id=eq.<auth.uid()>` on the channel together gate access; the
-- publication just makes the WAL stream available to the broker.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'karma_events'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.karma_events';
  END IF;
END $$;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

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
-- M28 columns (country_code, country_code_source, hide_from_leaderboards)
-- are GRANTed separately in the M28 block far below, after their ALTER
-- TABLE … ADD COLUMN runs. Don't list them here — would forward-reference
-- columns that don't exist yet on a fresh apply.

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

-- M34 dependency — forward-declare taxa.slug before profile_pokedex / taxa_thumbnails
-- reference it. The canonical ALTER lives later in the file (idempotent), but
-- db-validate's top-to-bottom replay needs the column to exist here.
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS slug text;

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
    OR t.nom059_status IN ('E', 'A', 'Pr')
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

-- Admins and moderators can read all reports (powers the /consola/banderas/ view).
DROP POLICY IF EXISTS reports_admin_read ON public.reports;
CREATE POLICY reports_admin_read ON public.reports FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

-- 12) notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text        NOT NULL
                          CHECK (kind IN ('follow','follow_accepted','reaction','comment','mention',
                                          'identification','badge','digest',
                                          'vertex_token_expiring')),
  payload     jsonb       NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- M32 v1.1 (#159): widen the kind CHECK to include
-- 'vertex_token_expiring'. Idempotent — drops the existing
-- constraint by name (auto-named when CREATE TABLE first ran) then
-- adds the new one. Existing rows are unchanged.
DO $$
BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
EXCEPTION WHEN others THEN NULL; END $$;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check CHECK (
    kind IN ('follow','follow_accepted','reaction','comment','mention',
             'identification','badge','digest',
             'vertex_token_expiring')
  );

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

-- M27.1 (#116) — additive columns for multi-provider routing. The
-- `resolve_sponsorship` function below references these, so they must
-- exist before the function's CREATE OR REPLACE runs in the same
-- file. The full M27.1 block at the bottom of this file extends the
-- enums + adds the pool tables; the column additions need to ride
-- with the table they belong to.
ALTER TABLE public.sponsor_credentials
  ADD COLUMN IF NOT EXISTS preferred_model text NOT NULL DEFAULT 'claude-haiku-4-5'
    CHECK (length(preferred_model) BETWEEN 1 AND 64),
  ADD COLUMN IF NOT EXISTS endpoint        text
    CHECK (endpoint IS NULL OR length(endpoint) <= 512),
  -- M32 v1.1 (#159): track when a Vertex AI access token expires
  -- so the `vertex_token_expiry_monitor` cron can notify the
  -- sponsor 5 minutes before. NULL for non-Vertex credentials.
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  -- #655: when true, the `identify` EF resolves this credential for the
  -- owner's own identifications BEFORE the BYO localStorage key — own
  -- credit, no sponsorship_usage tracking, no pool consumption.
  ADD COLUMN IF NOT EXISTS use_personally boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sponsor_credentials_personal_idx
  ON public.sponsor_credentials (user_id)
  WHERE use_personally = true AND revoked_at IS NULL;

ALTER TABLE public.sponsor_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sponsor_credentials_owner_read ON public.sponsor_credentials;
CREATE POLICY sponsor_credentials_owner_read ON public.sponsor_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- #655: SECURITY DEFINER RPC that toggles `use_personally` after
-- enforcing owner = caller. We don't expose UPDATE via RLS to
-- authenticated; sponsor_credentials writes go through the
-- `sponsorships` Edge Function (service_role) or this RPC.
CREATE OR REPLACE FUNCTION public.set_credential_personal(
  p_credential_id uuid,
  p_use_personally boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sponsor_credentials
     SET use_personally = p_use_personally
   WHERE id = p_credential_id
     AND user_id = auth.uid()
     AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credential not found or not owned by caller'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_credential_personal(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_credential_personal(uuid, boolean) TO authenticated;

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
-- M27.1 (#116, PR #143) added two columns to the OUT-table
-- (preferred_model, endpoint). `CREATE OR REPLACE FUNCTION` can't
-- change a function's return type, so on environments where the
-- pre-M27.1 signature already exists (production) we must DROP first.
-- Idempotent — a no-op on first install.
DROP FUNCTION IF EXISTS public.resolve_sponsorship(uuid, public.ai_provider);
CREATE OR REPLACE FUNCTION public.resolve_sponsorship(
  p_beneficiary uuid, p_provider public.ai_provider
) RETURNS TABLE (
  sponsorship_id uuid, sponsor_id uuid, credential_id uuid, vault_secret_id uuid,
  kind public.ai_credential_kind, used_this_month integer, monthly_call_cap integer,
  preferred_model text, endpoint text
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
  SELECT w.id, w.sponsor_id, w.credential_id, c.vault_secret_id, c.kind, w.used,
         w.monthly_call_cap, c.preferred_model, c.endpoint
  FROM   with_usage w JOIN public.sponsor_credentials c ON c.id = w.credential_id
  WHERE  w.used < w.monthly_call_cap
  ORDER  BY w.priority ASC, w.created_at ASC
  LIMIT  1;
$$;
REVOKE ALL ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) TO service_role;

-- has_active_sponsorship: lightweight boolean wrapper used by the client-side
-- claude.ts isAvailable() check. Returns TRUE when at least one active,
-- non-exhausted sponsorship exists for the calling user and given provider.
DROP FUNCTION IF EXISTS public.has_active_sponsorship(public.ai_provider);
CREATE OR REPLACE FUNCTION public.has_active_sponsorship(
  p_provider public.ai_provider
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.resolve_sponsorship(auth.uid(), p_provider) LIMIT 1
  );
$$;
REVOKE ALL ON FUNCTION public.has_active_sponsorship(public.ai_provider) FROM public;
GRANT EXECUTE ON FUNCTION public.has_active_sponsorship(public.ai_provider) TO authenticated;

-- 10. Extend karma_events.reason CHECK to include sponsorship reasons.
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call',
    'pool_donation','pool_call_sponsor_drip'
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

-- 16b. read_vault_secret — companion to create/delete. Edge Functions
--      can't `.schema('vault')` directly via PostgREST (the vault schema
--      isn't in the API exposed-schemas list, and surfacing it would
--      over-expose raw secret rows). This SECURITY DEFINER wrapper is
--      the only path the EF has to read a decrypted secret. Used by
--      /credentials/:id/test, the heartbeat cron, and the sponsor
--      cascade in the identify EF.
CREATE OR REPLACE FUNCTION public.read_vault_secret(p_secret_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1'
    INTO v_secret USING p_secret_id;
  RETURN v_secret;
END $$;
REVOKE ALL ON FUNCTION public.read_vault_secret(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.read_vault_secret(uuid) TO service_role;

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

-- 1b) Track whether country_code was set by the user or inferred by the
-- nightly recompute_user_stats() job. PR4 carry-forward from PR #92 review:
-- the Profile → Edit "inferred from your region" badge only renders when
-- source = 'auto'. recompute_user_stats() does NOT touch this column —
-- the DEFAULT 'auto' applies to existing rows and to any auto-fill via
-- normalize_country_code(). Profile → Edit save flips it to 'user'.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country_code_source text NOT NULL DEFAULT 'auto'
    CHECK (country_code_source IN ('auto','user'));

-- 1d) Per-user IANA timezone (PR14). NULL means treat as UTC. Currently
-- consumed by detect_admin_anomalies() to evaluate the off_hours rule in
-- the admin's local time rather than UTC. Wider use (push notifications,
-- streak rollovers) is a v1.1 follow-up — keep the column nullable so
-- consumers must defensively coalesce to 'UTC'.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone text;

-- 1c) Column-level UPDATE grants for the three M28-writable columns. Lives
-- here (rather than in the consolidated REVOKE/GRANT block above) because
-- those columns are added by the ALTER TABLE statements above; granting
-- on them at file head would forward-reference a non-existent column on a
-- fresh apply. Column-level GRANTs are additive in Postgres, so this
-- composes cleanly with the earlier GRANT UPDATE (...) block.
GRANT UPDATE (country_code, country_code_source, hide_from_leaderboards)
  ON public.users TO authenticated;

-- PR14: users.timezone is user-writable so Profile → Edit can persist it.
GRANT UPDATE (timezone) ON public.users TO authenticated;

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
-- Column order note: karma_total is appended last because Postgres
-- CREATE OR REPLACE VIEW only allows adding columns at the end.
-- Inserting karma_total mid-list is treated as a column rename and
-- breaks db-apply on databases with the previous view definition.
CREATE OR REPLACE VIEW public.community_observers AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  last_observation_at, joined_at,
  karma_total
FROM public.users
WHERE hide_from_leaderboards = false;
-- 2026-04-30: dropped `profile_public = true AND` — M28 visibility is now
-- governed solely by its dedicated opt-out (hide_from_leaderboards). The
-- belt-and-suspenders gate on profile_public was inherited from the M08
-- binary privacy model, which is being deprecated in favor of M25's
-- profile_privacy matrix. /community/observers/ is now default-discoverable;
-- users wanting to hide flip the toggle in Profile → Edit.

GRANT SELECT ON public.community_observers TO anon, authenticated;

-- 7) Authenticated-only view — adds centroid_geog for the Nearby
-- feature. Anon callers cannot read centroid via any path; the lack of
-- a GRANT to anon is the security gate (mirrored in UI by the sign-in
-- requirement).
-- Column order note: karma_total is appended LAST (after centroid_lat /
-- centroid_lng) because Postgres CREATE OR REPLACE VIEW only allows
-- adding columns at the end. Inserting karma_total mid-list is treated
-- as a rename of the column at that position and breaks db-apply on
-- databases that already have centroid_lat/lng but no karma_total
-- (the production state since 2026-05-04). Same rule as
-- community_observers above.
CREATE OR REPLACE VIEW public.community_observers_with_centroid AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  centroid_geog, last_observation_at, joined_at,
  -- Scalar lat/lng for clients that can't decode the geography WKB
  -- (the /community/map/ heatmap reads these directly). PostGIS
  -- geography → geometry cast is a zero-copy reinterpret for points.
  ST_Y(centroid_geog::geometry) AS centroid_lat,
  ST_X(centroid_geog::geometry) AS centroid_lng,
  karma_total
FROM public.users
WHERE hide_from_leaderboards = false;
-- 2026-04-30: same change as community_observers above — M28-only opt-out.

GRANT SELECT ON public.community_observers_with_centroid TO authenticated;
-- Explicitly NO grant to anon. Lack of grant is the security gate.

-- =====================================================================
-- M28 default visibility (2026-04-30) — A + B + C combined
--
-- Goal: by default, users see all members on /community/observers/.
--   A) New users default to profile_public=true (was false from M08).
--   B) M28 views drop the profile_public requirement (above).
--   C) Backfill existing profile_public=false users to true so they
--      appear immediately. Users who explicitly want privacy can flip
--      profile_public=false (hides /u/ profile page) AND/OR
--      hide_from_leaderboards=true (hides M28 card specifically).
--
-- Idempotent: ALTER COLUMN DEFAULT is no-op on second run; the UPDATE
-- only touches rows that haven't already been backfilled.
-- =====================================================================
ALTER TABLE public.users ALTER COLUMN profile_public SET DEFAULT true;

UPDATE public.users
   SET profile_public = true
 WHERE profile_public = false;

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

-- 9) Nearby helper — authenticated only. Reads the centroid view
-- (which is not granted to anon), so the SQL-layer privacy gate
-- fires regardless of the UI sign-in check. SECURITY INVOKER:
-- runs with the caller's privileges, so anon callers fail the
-- view-level grant check before the function body even runs.
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

-- 10) Nearby helper at an arbitrary point — authenticated only. Same
-- privacy gate as community_observers_nearby (reads the centroid view,
-- which is not granted to anon), but uses caller-supplied coords
-- instead of the viewer's stored centroid. Lets a brand-new user with
-- no observations still discover nearby observers via GPS. Coords
-- never persist server-side; the client passes them per-call.
CREATE OR REPLACE FUNCTION public.community_observers_nearby_at(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m numeric  DEFAULT 200000,
  p_limit    int      DEFAULT 20,
  p_offset   int      DEFAULT 0,
  p_country  text     DEFAULT NULL,
  p_taxa     text[]   DEFAULT NULL,
  p_experts  boolean  DEFAULT false
)
RETURNS SETOF public.community_observers_with_centroid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT v.*
    FROM public.community_observers_with_centroid v
   WHERE v.centroid_geog IS NOT NULL
     AND ST_DWithin(
       v.centroid_geog,
       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
       p_radius_m
     )
     AND (p_country IS NULL OR v.country_code = p_country)
     AND (p_taxa    IS NULL OR v.expert_taxa @> p_taxa)
     AND (p_experts = false OR v.is_expert = true)
   ORDER BY v.centroid_geog <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
   LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.community_observers_nearby_at(double precision, double precision, numeric, int, int, text, text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_observers_nearby_at(double precision, double precision, numeric, int, int, text, text[], boolean) TO authenticated;

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

-- delete_photo_atomic — single transaction wrapper used by the
-- delete-photo Edge Function (PR6 of obs-detail redesign). Wraps the
-- three writes the spec requires:
--   1. soft-delete media_files (deleted_at = now())
--   2. when p_demote: clear validated_by / validated_at and flip
--      is_research_grade = false on the primary identification
--   3. when p_demote: bump observations.last_material_edit_at
-- The Edge Function is responsible for the auth / ownership check; this
-- function trusts its caller (SECURITY DEFINER, EXECUTE granted only to
-- authenticated; service_role can call it via the EF as well).
--
-- Per PR #87 schema correction: identifications has no `verified` column —
-- the demote uses validated_by/validated_at/is_research_grade.
CREATE OR REPLACE FUNCTION public.delete_photo_atomic(
  p_obs_id   uuid,
  p_media_id uuid,
  p_demote   boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.media_files
     SET deleted_at = now()
   WHERE id = p_media_id
     AND observation_id = p_obs_id
     AND deleted_at IS NULL;

  IF p_demote THEN
    UPDATE public.identifications
       SET validated_by      = NULL,
           validated_at      = NULL,
           is_research_grade = false
     WHERE observation_id = p_obs_id
       AND is_primary     = true;

    UPDATE public.observations
       SET last_material_edit_at = now()
     WHERE id = p_obs_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_photo_atomic(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_photo_atomic(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_photo_atomic(uuid, uuid, boolean) TO service_role;

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
-- ── Sponsoring table grants — service_role needs explicit GRANT even with BYPASSRLS ──
-- The Edge Function (sponsorships/index.ts) uses the service_role key. In Supabase,
-- service_role bypasses RLS but still requires table-level GRANT from the schema owner.
-- Without these, all sponsoring Edge Function calls get "permission denied for table …".
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_credentials    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsorships           TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsorship_requests   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_errors_log          TO service_role;

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
  ('bioblitzEvents',         'Bioblitz events UI',                    'Public listing and participation UI for bioblitz events. Ships when the first organizer requests an event.',                                                              false, 'admin'),
  ('enforce_two_person_irreversible', 'Enforce two-person rule on irreversible ops', 'When enabled, the admin dispatcher rejects direct calls to role.revoke / user.ban / observation.hide / badge.revoke unless the call is invoked from proposal.approve. Off by default; flip after operators trust the Proposals queue.', false, 'admin')
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
  ('manual_adjust',      NULL, 'Manual adjustment',     'Ajuste manual',             'Admin-issued karma adjustment. Delta varies per case.',                           'Ajuste de karma emitido por un administrador. El delta varía por caso.'),
  ('pool_donation',      20,   'Pool donation',         'Donación a pool',           'Awarded when a sponsor donates calls to a platform pool.',                        'Otorgado cuando un patrocinador dona llamadas a un pool.'),
  ('pool_call_sponsor_drip', 0.5, 'Pool call (sponsor drip)', 'Llamada de pool (goteo patrocinador)', 'Small karma drip to the sponsor each time a beneficiary uses a pool call.', 'Pequeño goteo de karma al patrocinador cada vez que un beneficiario usa una llamada del pool.')
ON CONFLICT (reason) DO UPDATE
  SET label_en       = EXCLUDED.label_en,
      label_es       = EXCLUDED.label_es,
      description_en = EXCLUDED.description_en,
      description_es = EXCLUDED.description_es;
  -- delta is intentionally NOT updated on conflict — preserves any future runtime edits.

-- profile_karma_breakdown: per-reason aggregation of recent karma_events
-- for use by the profile page's expandable breakdown widget.
-- Self-only: only the calling user can see their own breakdown, except
-- admins (has_role(auth.uid(), 'admin')) which can see any user's.
-- The denormalised label join makes this one round-trip from the client.
CREATE OR REPLACE FUNCTION public.profile_karma_breakdown(
  p_user_id uuid,
  p_window  interval DEFAULT '7 days'
)
RETURNS TABLE (
  reason    text,
  label_en  text,
  label_es  text,
  count     bigint,
  sum_delta numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN
    RAISE EXCEPTION 'profile_karma_breakdown: forbidden';
  END IF;

  RETURN QUERY
  SELECT
    ke.reason,
    COALESCE(kc.label_en, ke.reason)              AS label_en,
    COALESCE(kc.label_es, ke.reason)              AS label_es,
    COUNT(*)::bigint                              AS count,
    COALESCE(SUM(ke.delta), 0)::numeric           AS sum_delta
  FROM public.karma_events ke
  LEFT JOIN public.karma_config kc ON kc.reason = ke.reason
  WHERE ke.user_id = p_user_id
    AND ke.created_at >= now() - p_window
  GROUP BY ke.reason, kc.label_en, kc.label_es
  ORDER BY sum_delta DESC, count DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.profile_karma_breakdown(uuid, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_karma_breakdown(uuid, interval) TO authenticated;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- PR10 — Subject UX: ban_appeals + audit_ops + notification kind extensions
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Extend notifications.kind CHECK to include ban lifecycle + appeal events.
--    Postgres CHECK constraints cannot be altered in place; the idempotent
--    approach is to drop and recreate with the extended list.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'follow','follow_accepted','reaction','comment','mention',
    'identification','badge','digest',
    'ban_received','ban_lifted','appeal_rejected'
  ));

-- 2. Extend audit_op enum for appeal outcomes (IF NOT EXISTS = idempotent).
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'appeal_accepted';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'appeal_rejected';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. ban_appeals table.
CREATE TABLE IF NOT EXISTS public.ban_appeals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_id          uuid NOT NULL REFERENCES public.user_bans(id) ON DELETE CASCADE,
  appellant_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message         text NOT NULL CHECK (length(message) BETWEEN 20 AND 2000),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  reviewer_id     uuid REFERENCES public.users(id),
  reviewer_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ban_appeals_ban ON public.ban_appeals(ban_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ban_appeals_pending ON public.ban_appeals(status, created_at) WHERE status = 'pending';

ALTER TABLE public.ban_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ban_appeals_self_read ON public.ban_appeals;
CREATE POLICY ban_appeals_self_read ON public.ban_appeals
  FOR SELECT TO authenticated
  USING (appellant_id = auth.uid());

DROP POLICY IF EXISTS ban_appeals_mod_read ON public.ban_appeals;
CREATE POLICY ban_appeals_mod_read ON public.ban_appeals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'moderator') OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS ban_appeals_self_insert ON public.ban_appeals;
CREATE POLICY ban_appeals_self_insert ON public.ban_appeals
  FOR INSERT TO authenticated
  WITH CHECK (
    appellant_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_bans
      WHERE id = ban_id
        AND user_id = auth.uid()
        AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS ban_appeals_no_client_update ON public.ban_appeals;
CREATE POLICY ban_appeals_no_client_update ON public.ban_appeals
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS ban_appeals_no_client_delete ON public.ban_appeals;
CREATE POLICY ban_appeals_no_client_delete ON public.ban_appeals
  FOR DELETE TO authenticated USING (false);

GRANT SELECT, INSERT ON public.ban_appeals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ban_appeals TO service_role;

-- ============================================================
-- PROJECTS (M29) — ANP / monitoring-protocol polygons
-- ============================================================
-- A project is a named polygon (typically an ANP, reserve, or sampling
-- grid) that observations are auto-tagged into when their location
-- falls inside the polygon. Used by professional monitoring workflows
-- (PROREST 2026, DRFSIPS) to filter / export per-protocol data.
--
-- Auto-tagging happens via a BEFORE INSERT/UPDATE trigger on
-- observations: if location is set and project_id is null, find the
-- first project whose polygon contains the point and assign it.
--
-- Privacy: project polygons are public by default but visibility=
-- 'private' restricts membership-only. Observation→project linkage
-- gates the same way (a public project's tagged observations remain
-- subject to the existing obs_public_read predicate; private projects
-- only expose their tagged observations to project_members rows).

CREATE TABLE IF NOT EXISTS public.projects (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  name_es         text CHECK (length(name_es) BETWEEN 1 AND 200),
  description     text CHECK (length(description) <= 4000),
  description_es  text CHECK (length(description_es) <= 4000),
  polygon         geography(MultiPolygon, 4326) NOT NULL,
  visibility      text NOT NULL DEFAULT 'public'
                  CHECK (visibility IN ('public','private')),
  owner_user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  species_list    jsonb,                 -- optional whitelist (PROREST taxon IDs)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_polygon ON public.projects USING GIST(polygon);
CREATE INDEX IF NOT EXISTS idx_projects_owner   ON public.projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_visible ON public.projects(visibility);

CREATE TABLE IF NOT EXISTS public.project_members (
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','validator','member')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);

-- Denormalised project_id on observations. Auto-assigned by trigger
-- when location is provided. Manual override allowed for cases where
-- the GPS is fuzzy / outside the polygon by mistake.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_obs_project ON public.observations(project_id)
  WHERE project_id IS NOT NULL;

-- ── Auto-assign trigger ────────────────────────────────────────────
-- Picks the first project whose polygon contains NEW.location.
-- "First" is ordered by `created_at ASC` so the longest-lived project
-- wins on overlap (operators with overlapping polygons should resolve
-- by editing one or the other).
--
-- SECURITY DEFINER so the trigger:
--   (a) can auto-tag observations into private projects whose rows the
--       writer can't SELECT under their own RLS — without this, "polygon
--       is the routing key" silently breaks for non-member writers
--       landing on a private polygon.
--   (b) bypasses RLS evaluation on `projects` entirely. Even though the
--       projects ↔ project_members cycle is now broken at the policy
--       level (helper functions below), keeping the trigger as DEFINER
--       belts-and-braces against future cross-table policies on either
--       side accidentally re-introducing it.
CREATE OR REPLACE FUNCTION public.assign_observation_to_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Honour explicit assignments (or unassignments) from the client.
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO NEW.project_id
    FROM public.projects
   WHERE ST_Covers(polygon, NEW.location)
   ORDER BY created_at ASC
   LIMIT 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_observation_to_project_trigger ON public.observations;
CREATE TRIGGER assign_observation_to_project_trigger
  BEFORE INSERT OR UPDATE OF location ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_observation_to_project();

-- ── Membership/owner predicate helpers ──────────────────────────────
-- These exist purely to break the projects ↔ project_members RLS cycle
-- (Postgres 42P17 — observed in prod 2026-04-30 on PATCH /observations
-- when the BEFORE UPDATE OF location trigger scanned `projects` and the
-- USING clause expanded into project_members → back into projects).
--
-- Both helpers are SECURITY DEFINER + STABLE + boolean-only:
--   - SECURITY DEFINER → the EXISTS subquery executes under the function
--     owner (postgres, BYPASSRLS), so policies on the inner table do
--     not re-evaluate. The cycle is broken at the SQL planner level.
--   - boolean return only → the function cannot leak rows; an attacker
--     calling is_project_member(p, target_uid) only learns yes/no for a
--     specific pair, which is information they can already infer from
--     the public RLS-surfaced join.
--   - search_path pinned → defends against shadowed schema attacks now
--     that the function runs with elevated privilege.
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.projects
        WHERE id = p_project_id
          AND owner_user_id = p_user_id
     );
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.project_members
        WHERE project_id = p_project_id
          AND user_id    = p_user_id
     );
$$;

REVOKE ALL ON FUNCTION public.is_project_owner(uuid, uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_owner(uuid, uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO anon, authenticated, service_role;

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_public_read ON public.projects;
CREATE POLICY projects_public_read ON public.projects
  FOR SELECT
  USING (
    visibility = 'public'
    OR owner_user_id = auth.uid()
    OR public.is_project_member(id, auth.uid())
  );

DROP POLICY IF EXISTS projects_owner_insert ON public.projects;
CREATE POLICY projects_owner_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS projects_owner_update ON public.projects;
CREATE POLICY projects_owner_update ON public.projects
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS projects_owner_delete ON public.projects;
CREATE POLICY projects_owner_delete ON public.projects
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- The four project_members policies all routed through inline EXISTS
-- subqueries against `projects`, which expanded `projects_public_read`,
-- which referenced `project_members` again → 42P17 recursion. They now
-- call is_project_owner() instead, which bypasses RLS via SECURITY DEFINER.
DROP POLICY IF EXISTS project_members_read ON public.project_members;
CREATE POLICY project_members_read ON public.project_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_project_owner(project_id, auth.uid())
  );

DROP POLICY IF EXISTS project_members_owner_write ON public.project_members;
CREATE POLICY project_members_owner_write ON public.project_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_owner(project_id, auth.uid()));

DROP POLICY IF EXISTS project_members_owner_delete ON public.project_members;
CREATE POLICY project_members_owner_delete ON public.project_members
  FOR DELETE TO authenticated
  USING (public.is_project_owner(project_id, auth.uid()));

GRANT SELECT                        ON public.projects        TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE        ON public.projects        TO authenticated;
GRANT SELECT                        ON public.project_members TO anon, authenticated;
GRANT INSERT, DELETE                ON public.project_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO service_role;

-- ── Read view (RLS-respecting) with polygon as GeoJSON ──────────────
-- A SECURITY INVOKER view: queries inherit the caller's RLS, so anon
-- gets only public rows; owners + members see private + public; service
-- role sees all. supabase-js consumers use this instead of selecting
-- `polygon` directly (PostgREST returns geography as base64 WKB).
CREATE OR REPLACE VIEW public.projects_with_geojson
  WITH (security_invoker = true) AS
SELECT
  p.id,
  p.slug,
  p.name,
  p.name_es,
  p.description,
  p.description_es,
  p.visibility,
  p.owner_user_id,
  p.species_list,
  p.created_at,
  p.updated_at,
  CASE
    WHEN p.polygon IS NOT NULL THEN ST_AsGeoJSON(p.polygon)::jsonb
    ELSE NULL
  END                                      AS polygon_geojson,
  CASE
    WHEN p.polygon IS NOT NULL THEN ST_Area(p.polygon) / 1e6
    ELSE NULL
  END                                      AS area_km2
FROM public.projects p;

GRANT SELECT ON public.projects_with_geojson TO anon, authenticated, service_role;

-- ── Owner-scoped upsert RPC accepting GeoJSON text ──────────────────
-- supabase-js can't write geography columns directly (PostgREST has no
-- WKB encoder). The client passes GeoJSON; this RPC parses it and
-- enforces owner_user_id = auth.uid() before INSERT/UPDATE. RLS still
-- guards the underlying table — this just makes the write ergonomic.
CREATE OR REPLACE FUNCTION public.upsert_project(
  p_slug             text,
  p_name             text,
  p_name_es          text,
  p_description      text,
  p_description_es   text,
  p_visibility       text,
  p_polygon_geojson  jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geom    geometry;
  v_geog    geography;
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  IF p_visibility NOT IN ('public','private') THEN
    RAISE EXCEPTION 'visibility must be public|private' USING ERRCODE = '22023';
  END IF;
  v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson::text), 4326);
  -- Promote a Polygon to MultiPolygon so the column type is uniform.
  IF GeometryType(v_geom) = 'POLYGON' THEN
    v_geom := ST_Multi(v_geom);
  END IF;
  IF GeometryType(v_geom) <> 'MULTIPOLYGON' THEN
    RAISE EXCEPTION 'GeoJSON must be Polygon or MultiPolygon' USING ERRCODE = '22023';
  END IF;
  v_geog := v_geom::geography;

  -- Reject if the slug exists and isn't owned by the caller.
  SELECT owner_user_id INTO v_owner
    FROM public.projects WHERE slug = p_slug;
  IF v_owner IS NOT NULL AND v_owner <> v_uid THEN
    RAISE EXCEPTION 'slug taken' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.projects (
    slug, name, name_es, description, description_es, visibility, owner_user_id, polygon
  ) VALUES (
    p_slug, p_name, p_name_es, p_description, p_description_es, p_visibility, v_uid, v_geog
  )
  ON CONFLICT (slug) DO UPDATE SET
    name           = EXCLUDED.name,
    name_es        = EXCLUDED.name_es,
    description    = EXCLUDED.description,
    description_es = EXCLUDED.description_es,
    visibility     = EXCLUDED.visibility,
    polygon        = EXCLUDED.polygon,
    updated_at     = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_project(text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_project(text,text,text,text,text,text,jsonb)
  TO authenticated, service_role;
-- ADMIN RATE LIMIT BUCKETS (PR11 — durable across isolates)
-- ============================================================
-- Token-bucket state for the admin Edge Function dispatcher.
-- The in-memory Map in rate-limit.ts resets on every cold start; this
-- table persists across isolates so a determined attacker cannot evade
-- the limit by outlasting cold-start windows.
--
-- Access: service_role only. No client reads, no client writes.
-- The consume_rate_limit_token() function is SECURITY DEFINER so it
-- bypasses RLS but is only callable by service_role.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  actor_id    uuid PRIMARY KEY,
  tokens      numeric NOT NULL DEFAULT 30,
  last_refill timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_limit_no_client_read ON public.rate_limit_buckets;
CREATE POLICY rate_limit_no_client_read ON public.rate_limit_buckets
  FOR SELECT TO authenticated, anon USING (false);

GRANT SELECT, INSERT, UPDATE ON public.rate_limit_buckets TO service_role;

-- Atomic UPSERT + token-consume in a single RPC call.
-- Returns (allowed boolean, retry_after_seconds int, tokens_remaining numeric).
-- Fail-open semantics live in the Edge Function: if this RPC errors, the
-- dispatcher lets the request through rather than locking everyone out.
CREATE OR REPLACE FUNCTION public.consume_rate_limit_token(
  p_actor_id uuid,
  p_cost numeric DEFAULT 1.0,
  p_capacity numeric DEFAULT 30.0,
  p_refill_per_second numeric DEFAULT 0.5
) RETURNS TABLE (allowed boolean, retry_after_seconds int, tokens_remaining numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_tokens numeric;
BEGIN
  -- Atomic UPSERT — first call initialises the bucket at full capacity.
  INSERT INTO public.rate_limit_buckets (actor_id, tokens, last_refill, updated_at)
  VALUES (p_actor_id, p_capacity, v_now, v_now)
  ON CONFLICT (actor_id) DO UPDATE
  SET tokens = LEAST(p_capacity, public.rate_limit_buckets.tokens
                                  + EXTRACT(EPOCH FROM (v_now - public.rate_limit_buckets.last_refill))
                                  * p_refill_per_second),
      last_refill = v_now,
      updated_at = v_now
  RETURNING public.rate_limit_buckets.tokens INTO v_tokens;

  IF v_tokens >= p_cost THEN
    UPDATE public.rate_limit_buckets
    SET tokens = tokens - p_cost,
        updated_at = v_now
    WHERE actor_id = p_actor_id
    RETURNING tokens INTO v_tokens;
    RETURN QUERY SELECT true, 0, v_tokens;
  ELSE
    RETURN QUERY SELECT
      false,
      CEIL((p_cost - v_tokens) / p_refill_per_second)::int,
      v_tokens;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.consume_rate_limit_token(uuid, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_token(uuid, numeric, numeric, numeric) TO service_role;

-- ============================================================
-- ADMIN OBSERVABILITY (PR12 — Section C-2)
-- ============================================================
-- Three admin-only sinks fed by the dispatcher and a pair of cron jobs:
--   * admin_anomalies        — automated anomaly detections from admin_audit
--   * admin_health_digests   — weekly platform-health snapshots
--   * function_errors        — Edge Function structured error sink
--
-- Read access is gated by has_role(auth.uid(),'admin'); writes happen via
-- service_role only (cron / SECURITY DEFINER functions / Edge Functions).

-- 1. audit_op enum extensions for the new actions
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'anomaly_acknowledge';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'audit_export';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. admin_anomalies — captures detections from admin_audit scans
CREATE TABLE IF NOT EXISTS public.admin_anomalies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  actor_id         uuid REFERENCES auth.users(id),
  window_start     timestamptz NOT NULL,
  window_end       timestamptz NOT NULL,
  event_count      int NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid REFERENCES auth.users(id),
  ack_notes        text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_anomalies_unique_window UNIQUE (kind, actor_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_admin_anomalies_actor
  ON public.admin_anomalies (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_anomalies_unack
  ON public.admin_anomalies (acknowledged_at NULLS FIRST, created_at DESC);

ALTER TABLE public.admin_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_anomalies_admin_read ON public.admin_anomalies;
CREATE POLICY admin_anomalies_admin_read ON public.admin_anomalies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_anomalies_no_client_write ON public.admin_anomalies;
CREATE POLICY admin_anomalies_no_client_write ON public.admin_anomalies
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.admin_anomalies TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON public.admin_anomalies TO service_role;

-- 3. admin_health_digests — weekly snapshots
CREATE TABLE IF NOT EXISTS public.admin_health_digests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  metrics       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_health_digests_unique_period UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_admin_health_digests_period
  ON public.admin_health_digests (period_end DESC);

ALTER TABLE public.admin_health_digests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_health_digests_admin_read ON public.admin_health_digests;
CREATE POLICY admin_health_digests_admin_read ON public.admin_health_digests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_health_digests_no_client_write ON public.admin_health_digests;
CREATE POLICY admin_health_digests_no_client_write ON public.admin_health_digests
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.admin_health_digests TO authenticated;
GRANT SELECT, INSERT                  ON public.admin_health_digests TO service_role;

-- 4. function_errors — Edge Function structured error sink
CREATE TABLE IF NOT EXISTS public.function_errors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  text NOT NULL,
  code           text NOT NULL,
  actor_id       uuid,
  context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_function_errors_fn
  ON public.function_errors (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_errors_code
  ON public.function_errors (code, created_at DESC);

ALTER TABLE public.function_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS function_errors_admin_read ON public.function_errors;
CREATE POLICY function_errors_admin_read ON public.function_errors
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS function_errors_no_client_write ON public.function_errors;
CREATE POLICY function_errors_no_client_write ON public.function_errors
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.function_errors TO authenticated;
GRANT SELECT, INSERT                  ON public.function_errors TO service_role;

-- 5. detect_admin_anomalies — runs hourly via pg_cron, surfaces three rules.
--
--   * High rate     — > 50 admin_audit rows from one actor in any rolling
--                     1-hour window in the last hour.
--   * Bulk delete   — > 10 actions whose op text contains 'hide', 'revoke',
--                     'ban', or 'delete' in the last hour from one actor.
--   * Off-hours     — >= 5 actions outside 06:00–22:00 in the actor's
--                     local time (PR14: respects users.timezone, falls
--                     back to UTC when NULL).
--
-- Each detection is INSERTed into admin_anomalies with ON CONFLICT DO NOTHING
-- on (kind, actor_id, window_start) so re-runs over an overlapping window
-- are idempotent. The window_start is truncated to the hour so a single
-- detection per actor+kind+hour is the natural deduplication key.
CREATE OR REPLACE FUNCTION public.detect_admin_anomalies()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now     timestamptz := now();
  v_start   timestamptz := date_trunc('hour', v_now) - interval '1 hour';
  v_end     timestamptz := date_trunc('hour', v_now);
BEGIN
  -- High rate: > 50 rows in [v_start, v_end) from one actor.
  INSERT INTO public.admin_anomalies (kind, actor_id, window_start, window_end, event_count, details)
  SELECT
    'high_rate',
    actor_id,
    v_start,
    v_end,
    count(*),
    jsonb_build_object('threshold', 50)
  FROM public.admin_audit
  WHERE created_at >= v_start AND created_at < v_end
  GROUP BY actor_id
  HAVING count(*) > 50
  ON CONFLICT (kind, actor_id, window_start) DO NOTHING;

  -- Bulk delete: > 10 destructive-ish ops from one actor in the window.
  INSERT INTO public.admin_anomalies (kind, actor_id, window_start, window_end, event_count, details)
  SELECT
    'bulk_delete',
    actor_id,
    v_start,
    v_end,
    count(*),
    jsonb_build_object(
      'threshold', 10,
      'ops_seen', array_agg(DISTINCT op::text)
    )
  FROM public.admin_audit
  WHERE created_at >= v_start AND created_at < v_end
    AND (
      op::text LIKE '%hide%'   OR
      op::text LIKE '%revoke%' OR
      op::text LIKE '%ban%'    OR
      op::text LIKE '%delete%'
    )
  GROUP BY actor_id
  HAVING count(*) > 10
  ON CONFLICT (kind, actor_id, window_start) DO NOTHING;

  -- Off-hours: >= 5 actions outside 06:00–22:00 in the actor's local
  -- timezone (PR14). users.timezone is consulted via LEFT JOIN so admins
  -- without a configured tz fall back to UTC. The detail row records the
  -- evaluated zone for forensics.
  INSERT INTO public.admin_anomalies (kind, actor_id, window_start, window_end, event_count, details)
  SELECT
    'off_hours',
    a.actor_id,
    v_start,
    v_end,
    count(*),
    jsonb_build_object(
      'threshold', 5,
      'allowed_hours_local', '06:00-22:00',
      'tz', COALESCE(u.timezone, 'UTC')
    )
  FROM public.admin_audit a
  LEFT JOIN public.users u ON u.id = a.actor_id
  WHERE a.created_at >= v_start AND a.created_at < v_end
    AND (
      EXTRACT(HOUR FROM a.created_at AT TIME ZONE COALESCE(u.timezone, 'UTC')) < 6
      OR EXTRACT(HOUR FROM a.created_at AT TIME ZONE COALESCE(u.timezone, 'UTC')) >= 22
    )
  GROUP BY a.actor_id, u.timezone
  HAVING count(*) >= 5
  ON CONFLICT (kind, actor_id, window_start) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.detect_admin_anomalies() FROM public;
GRANT EXECUTE ON FUNCTION public.detect_admin_anomalies() TO service_role;

-- 6. compute_admin_health_digest — runs weekly via pg_cron. Aggregates a set
-- of platform metrics for the previous 7 days and inserts one row into
-- admin_health_digests. ON CONFLICT DO NOTHING keeps re-runs idempotent.
CREATE OR REPLACE FUNCTION public.compute_admin_health_digest()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_end   timestamptz := now();
  v_period_start timestamptz := v_period_end - interval '7 days';
  v_metrics      jsonb;
BEGIN
  SELECT jsonb_build_object(
    'admin_actions',     COALESCE((
      SELECT count(*)::bigint FROM public.admin_audit
      WHERE created_at >= v_period_start AND created_at < v_period_end
    ), 0),
    'bans_issued',       COALESCE((
      SELECT count(*)::bigint FROM public.user_bans
      WHERE created_at >= v_period_start AND created_at < v_period_end
    ), 0),
    'bans_lifted',       COALESCE((
      SELECT count(*)::bigint FROM public.user_bans
      WHERE revoked_at IS NOT NULL
        AND revoked_at >= v_period_start AND revoked_at < v_period_end
    ), 0),
    'appeals_open',      COALESCE((
      SELECT count(*)::bigint FROM public.ban_appeals
      WHERE status = 'pending'
    ), 0),
    'reports_open',      COALESCE((
      SELECT count(*)::bigint FROM public.reports
      WHERE status IN ('open', 'triaged')
    ), 0),
    'anomalies_unack',   COALESCE((
      SELECT count(*)::bigint FROM public.admin_anomalies
      WHERE acknowledged_at IS NULL
    ), 0),
    'function_errors_7d', COALESCE((
      SELECT count(*)::bigint FROM public.function_errors
      WHERE created_at >= v_period_start AND created_at < v_period_end
    ), 0)
  ) INTO v_metrics;

  INSERT INTO public.admin_health_digests (period_start, period_end, metrics)
  VALUES (v_period_start, v_period_end, v_metrics)
  ON CONFLICT (period_start, period_end) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.compute_admin_health_digest() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_admin_health_digest() TO service_role;

-- ═════════════════════════════════════════════════════════════════════
-- PR13 — Future-proofing primitives
-- See docs/runbooks/admin-time-bounded-roles.md
-- See docs/runbooks/admin-two-person-rule.md
-- See docs/runbooks/admin-webhooks.md
-- See docs/runbooks/admin-trust-scores.md
-- ═════════════════════════════════════════════════════════════════════

-- 1. Time-bounded role grants
-- ─────────────────────────────────────────────────────────────────────
-- Adds expires_at + auto_revoke_reason to user_roles. has_role() rewrites
-- to also check (expires_at IS NULL OR expires_at > now()). A daily cron
-- (auto-revoke-expired-roles-daily) runs auto_revoke_expired_roles() to
-- soft-revoke any role rows past expiry and write an admin_audit row.

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz;
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS auto_revoke_reason text;

CREATE INDEX IF NOT EXISTS user_roles_expires_at_idx
  ON public.user_roles (expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- has_role() now treats expires_at the same as a future-dated revoked_at:
-- both gate the role to "currently active". The original revoked_at clause
-- is preserved for backwards compatibility (admin manual revocation path).
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
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.user_role) FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_revoke_expired_roles()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_row record;
  v_count int := 0;
  v_actor uuid;
BEGIN
  -- The cron job has no actor_id; we record a fixed sentinel via a NULL
  -- actor in details->>'auto'. admin_audit.actor_id is NOT NULL, so we
  -- need a placeholder — we resolve to the granting admin so the audit
  -- trail still ties back to a real human. If granted_by is NULL (rare,
  -- legacy rows), we fall back to the user_id itself.
  FOR v_row IN
    SELECT user_id, role, granted_by, expires_at
      FROM public.user_roles
     WHERE revoked_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at <= v_now
  LOOP
    UPDATE public.user_roles
       SET revoked_at         = v_now,
           auto_revoke_reason = 'expired'
     WHERE user_id = v_row.user_id
       AND role    = v_row.role
       AND revoked_at IS NULL;

    v_actor := COALESCE(v_row.granted_by, v_row.user_id);
    INSERT INTO public.admin_audit (actor_id, op, target_type, target_id, before, after, reason)
    VALUES (
      v_actor,
      'role_revoke',
      'user',
      v_row.user_id::text,
      jsonb_build_object('role', v_row.role, 'expires_at', v_row.expires_at),
      jsonb_build_object('revoked_at', v_now, 'auto_revoke_reason', 'expired'),
      'auto-revoke: role grant expired'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.auto_revoke_expired_roles() FROM public;
GRANT EXECUTE ON FUNCTION public.auto_revoke_expired_roles() TO service_role;

-- 2. Two-person rule on irreversible actions
-- ─────────────────────────────────────────────────────────────────────
-- New table admin_action_proposals stores pending irreversible actions.
-- Approver MUST differ from proposer (handler-side check). Proposals
-- expire after 24h; expire_stale_proposals() flips status to 'expired'.

DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'proposal_create';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'proposal_approve';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'proposal_reject';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.admin_action_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  op                  public.audit_op NOT NULL,
  target_type         text NOT NULL,
  target_id           text NOT NULL,
  payload             jsonb NOT NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  approver_id         uuid REFERENCES auth.users(id),
  approved_at         timestamptz,
  rejected_at         timestamptz,
  executed_at         timestamptz,
  executed_audit_id   bigint REFERENCES public.admin_audit(id),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_status_created
  ON public.admin_action_proposals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_proposer
  ON public.admin_action_proposals (proposer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_action_proposals_expires
  ON public.admin_action_proposals (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.admin_action_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_action_proposals_admin_read ON public.admin_action_proposals;
CREATE POLICY admin_action_proposals_admin_read ON public.admin_action_proposals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_action_proposals_no_client_write ON public.admin_action_proposals;
CREATE POLICY admin_action_proposals_no_client_write ON public.admin_action_proposals
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.admin_action_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON public.admin_action_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_proposals()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE public.admin_action_proposals
       SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at <= now()
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM updated;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.expire_stale_proposals() FROM public;
GRANT EXECUTE ON FUNCTION public.expire_stale_proposals() TO service_role;

-- 3. Webhook subscriptions
-- ─────────────────────────────────────────────────────────────────────
-- admin_webhooks: per-subscription URL + event filter + HMAC secret.
-- admin_webhook_deliveries: append-only delivery log (debugging + retry
-- planning). dispatch_admin_webhooks(event, payload) is a SECURITY DEFINER
-- helper that pg_net's a POST to every enabled, matching subscription
-- and disables the subscription after 10 consecutive failures.

DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'webhook_create';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'webhook_update';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'webhook_delete';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'webhook_test';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.admin_webhooks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url                  text NOT NULL CHECK (url ~ '^https://'),
  events               text[] NOT NULL,
  secret               text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  created_by           uuid NOT NULL REFERENCES auth.users(id),
  last_delivery_at     timestamptz,
  last_delivery_status int,
  consecutive_failures int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_webhooks_enabled
  ON public.admin_webhooks (enabled)
  WHERE enabled = true;

ALTER TABLE public.admin_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_webhooks_admin_read ON public.admin_webhooks;
CREATE POLICY admin_webhooks_admin_read ON public.admin_webhooks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_webhooks_no_client_write ON public.admin_webhooks;
CREATE POLICY admin_webhooks_no_client_write ON public.admin_webhooks
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.admin_webhooks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.admin_webhooks TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   uuid NOT NULL REFERENCES public.admin_webhooks(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  status_code  int,
  error        text
);

-- PR14: replay protection columns. nonce is stamped into the signed body
-- as _meta.nonce so receivers can dedupe; request_id is the bigint
-- pg_net.http_post returns, persisted so reconcile_webhook_deliveries()
-- can later JOIN against net._http_response and write back the resolved
-- status_code (pg_net is fire-and-forget, so the synchronous INSERT into
-- this table cannot capture the response).
ALTER TABLE public.admin_webhook_deliveries
  ADD COLUMN IF NOT EXISTS nonce      text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS request_id bigint;

CREATE INDEX IF NOT EXISTS idx_admin_webhook_deliveries_webhook
  ON public.admin_webhook_deliveries (webhook_id, attempted_at DESC);

-- Partial index drives the reconcile cron's hot-path lookup.
CREATE INDEX IF NOT EXISTS idx_admin_webhook_deliveries_pending
  ON public.admin_webhook_deliveries (request_id)
  WHERE status_code IS NULL AND request_id IS NOT NULL;

ALTER TABLE public.admin_webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_webhook_deliveries_admin_read ON public.admin_webhook_deliveries;
CREATE POLICY admin_webhook_deliveries_admin_read ON public.admin_webhook_deliveries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_webhook_deliveries_no_client_write ON public.admin_webhook_deliveries;
CREATE POLICY admin_webhook_deliveries_no_client_write ON public.admin_webhook_deliveries
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

GRANT SELECT                          ON public.admin_webhook_deliveries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.admin_webhook_deliveries TO service_role;

-- HMAC-SHA256 signing helper. pgcrypto provides hmac() with the right
-- semantics; we hex-encode the digest because it's slightly more
-- ergonomic for verification on the receiver side than base64.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.dispatch_admin_webhooks(p_event text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_body          text;
  v_signed_payload jsonb;
  v_event_id       text;
  v_nonce          text;
  v_timestamp      text;
  v_sig  text;
  v_request_id bigint;
BEGIN
  -- PR14 replay protection: stamp _meta into the signed payload so the
  -- HMAC commits to a specific (event_id, nonce, timestamp) tuple.
  -- Receivers dedupe on event_id and reject when timestamp drifts more
  -- than ~5 minutes. event_id is generated per dispatch so two webhooks
  -- subscribed to the same trigger see the same event_id.
  v_event_id  := gen_random_uuid()::text;
  v_timestamp := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  FOR v_row IN
    SELECT id, url, secret
      FROM public.admin_webhooks
     WHERE enabled = true
       AND p_event = ANY (events)
  LOOP
    -- Per-delivery nonce so a body signed for webhook A cannot be
    -- replayed against webhook B and pass dedupe.
    v_nonce := gen_random_uuid()::text;
    v_signed_payload := p_payload || jsonb_build_object(
      '_meta', jsonb_build_object(
        'event_id',  v_event_id,
        'event',     p_event,
        'timestamp', v_timestamp,
        'nonce',     v_nonce,
        'version',   1
      )
    );
    v_body := v_signed_payload::text;
    v_sig := encode(
      hmac(v_body::bytea, v_row.secret::bytea, 'sha256'),
      'hex'
    );

    BEGIN
      v_request_id := net.http_post(
        url     := v_row.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Rastrum-Signature', 'sha256=' || v_sig,
          'X-Rastrum-Event',     p_event,
          'X-Rastrum-Event-Id',  v_event_id,
          'X-Rastrum-Timestamp', v_timestamp,
          'X-Rastrum-Nonce',     v_nonce
        ),
        body    := v_signed_payload
      );

      INSERT INTO public.admin_webhook_deliveries (webhook_id, event, payload, nonce, request_id)
      VALUES (v_row.id, p_event, v_signed_payload, v_nonce, v_request_id);

      UPDATE public.admin_webhooks
         SET last_delivery_at  = now(),
             consecutive_failures = 0
       WHERE id = v_row.id;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.admin_webhook_deliveries (webhook_id, event, payload, nonce, error)
      VALUES (v_row.id, p_event, v_signed_payload, v_nonce, SQLERRM);

      UPDATE public.admin_webhooks
         SET last_delivery_at     = now(),
             consecutive_failures = consecutive_failures + 1,
             enabled              = (consecutive_failures + 1 < 10)
       WHERE id = v_row.id;
    END;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.dispatch_admin_webhooks(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.dispatch_admin_webhooks(text, jsonb) TO service_role;

-- PR14: reconcile webhook deliveries by joining the pending rows against
-- pg_net's internal _http_response table. dispatch_admin_webhooks() is
-- fire-and-forget by design (pg_net.http_post returns immediately with a
-- bigint request id); the response lands later in net._http_response. A
-- cron at every 2 minutes calls this function to write status_code +
-- error back into admin_webhook_deliveries and bump the parent webhook's
-- consecutive_failures counter / last_delivery_status. Idempotent —
-- skips rows that already have a status_code.
CREATE OR REPLACE FUNCTION public.reconcile_webhook_deliveries()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_updated int := 0;
BEGIN
  -- Resolve pending deliveries against net._http_response. Mark the
  -- webhook's last_delivery_status from the freshest result; bump
  -- consecutive_failures when status_code is in 4xx/5xx or NULL after
  -- timeout. The cron's 2-minute cadence + pg_net's default 5s timeout
  -- means a true unreachable receiver lands in the failure branch
  -- within ~3 minutes.
  WITH pending AS (
    SELECT d.id           AS delivery_id,
           d.webhook_id   AS webhook_id,
           d.request_id   AS request_id,
           r.status_code  AS resp_status,
           r.error_msg    AS resp_error,
           r.timed_out    AS resp_timed_out
      FROM public.admin_webhook_deliveries d
      JOIN net._http_response r ON r.id = d.request_id
     WHERE d.status_code IS NULL
       AND d.request_id IS NOT NULL
  ),
  upd AS (
    UPDATE public.admin_webhook_deliveries d
       SET status_code = p.resp_status,
           error       = COALESCE(p.resp_error,
                                  CASE WHEN p.resp_timed_out THEN 'timeout' END,
                                  d.error)
      FROM pending p
     WHERE d.id = p.delivery_id
    RETURNING d.id, d.webhook_id, d.status_code
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  -- Bump consecutive_failures on the parent webhook for any 4xx/5xx /
  -- NULL status_code resolutions. 2xx/3xx resolutions reset the counter.
  -- Done in a second pass so the WITH ... RETURNING above stays simple.
  UPDATE public.admin_webhooks w
     SET last_delivery_status = sub.status_code,
         consecutive_failures = CASE
           WHEN sub.status_code BETWEEN 200 AND 399 THEN 0
           ELSE w.consecutive_failures + 1
         END,
         enabled = CASE
           WHEN sub.status_code BETWEEN 200 AND 399 THEN w.enabled
           ELSE (w.consecutive_failures + 1 < 10)
         END
    FROM (
      SELECT DISTINCT ON (d.webhook_id)
             d.webhook_id, d.status_code
        FROM public.admin_webhook_deliveries d
       WHERE d.status_code IS NOT NULL
         AND d.attempted_at >= now() - interval '10 minutes'
       ORDER BY d.webhook_id, d.attempted_at DESC
    ) sub
   WHERE w.id = sub.webhook_id;

  RETURN v_updated;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_webhook_deliveries() FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_webhook_deliveries() TO service_role;

-- Triggers — fan out from anomaly creation + privileged audit ops to
-- subscribed webhooks. AFTER INSERT keeps the dispatch out of the
-- critical-path commit; failures inside dispatch_admin_webhooks() are
-- swallowed and logged to admin_webhook_deliveries.
CREATE OR REPLACE FUNCTION public.admin_anomalies_dispatch_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dispatch_admin_webhooks('anomaly_created', to_jsonb(NEW));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS admin_anomalies_dispatch ON public.admin_anomalies;
CREATE TRIGGER admin_anomalies_dispatch
AFTER INSERT ON public.admin_anomalies
FOR EACH ROW EXECUTE FUNCTION public.admin_anomalies_dispatch_trigger();

CREATE OR REPLACE FUNCTION public.admin_audit_dispatch_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  v_event := CASE NEW.op::text
    WHEN 'user_ban'      THEN 'user_banned'
    WHEN 'user_unban'    THEN 'user_unbanned'
    WHEN 'role_grant'    THEN 'role_granted'
    WHEN 'role_revoke'   THEN 'role_revoked'
    ELSE NULL
  END;
  IF v_event IS NOT NULL THEN
    PERFORM public.dispatch_admin_webhooks(v_event, to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS admin_audit_dispatch ON public.admin_audit;
CREATE TRIGGER admin_audit_dispatch
AFTER INSERT ON public.admin_audit
FOR EACH ROW EXECUTE FUNCTION public.admin_audit_dispatch_trigger();

-- 4. Moderator trust score (v1.1 — PR14)
-- ─────────────────────────────────────────────────────────────────────
-- !! Any change to this function MUST bump the version comment in
-- !! `docs/runbooks/admin-trust-scores.md` AND ship a runbook entry
-- !! explaining the rationale. Trust scores are surfaced to admins;
-- !! silent reformulations would be confusing and unfair.
--
-- Version: 1.1 (2026-04-29)
--
-- Formula (weighted sum, clamped to 0..100):
--   base               = 70
--   anomaly_factor     = -8 × unack_anomalies_last_30d  (older anomalies
--                        decay to zero weight)
--   overturn_penalty   = -25 × overturn_rate            (where overturn_rate
--                        is the fraction of report.dismiss actions
--                        reversed by a *different* moderator within 7 days)
--   action_volume      = +30 × min(1, sqrt(active_days_last_90d / 30))
--                        (rewards consistency without rewarding raw
--                        bursts; capped at +30)
--   recency_bonus      = +5 if the moderator acted in the last 7 days
--
-- Returns NULL when the user is neither moderator nor admin.

CREATE OR REPLACE FUNCTION public.compute_moderator_trust_score(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unack             int;
  v_dismiss_total     int;
  v_dismiss_overturned int;
  v_overturn_rate     numeric := 0.0;
  v_active_days       int;
  v_recent_action     boolean;
  v_score             numeric;
BEGIN
  IF NOT (public.has_role(p_user_id, 'moderator') OR public.has_role(p_user_id, 'admin')) THEN
    RETURN NULL;
  END IF;

  -- Anomaly factor: only the last 30 days at full weight; older
  -- unacknowledged anomalies don't penalise indefinitely.
  SELECT count(*)::int INTO v_unack
    FROM public.admin_anomalies
   WHERE actor_id = p_user_id
     AND acknowledged_at IS NULL
     AND created_at >= now() - interval '30 days';

  -- Overturn rate: report.dismiss actions taken by this moderator that
  -- were subsequently re-opened or resolved by a *different*
  -- moderator within 7 days. We approximate "overturned" as: the same
  -- target_id received a later report_resolve audit row from a
  -- different actor inside the 7-day window.
  SELECT count(*)::int INTO v_dismiss_total
    FROM public.admin_audit
   WHERE actor_id = p_user_id
     AND op::text = 'report_dismiss'
     AND created_at >= now() - interval '90 days';

  IF v_dismiss_total > 0 THEN
    SELECT count(DISTINCT a.id)::int INTO v_dismiss_overturned
      FROM public.admin_audit a
     WHERE a.actor_id = p_user_id
       AND a.op::text = 'report_dismiss'
       AND a.created_at >= now() - interval '90 days'
       AND EXISTS (
         SELECT 1 FROM public.admin_audit b
          WHERE b.target_id   = a.target_id
            AND b.target_type = a.target_type
            AND b.actor_id   <> p_user_id
            AND b.op::text   = 'report_resolve'
            AND b.created_at >  a.created_at
            AND b.created_at <= a.created_at + interval '7 days'
       );
    v_overturn_rate := v_dismiss_overturned::numeric / v_dismiss_total::numeric;
  END IF;

  -- Action volume: count of distinct days the moderator wrote at least
  -- one admin_audit row in the last 90. The sqrt-then-cap shape rewards
  -- consistency (5 days → ~ +12, 30 days → +30) without giving infinite
  -- credit for an admin who handled 1 ticket every day for years.
  SELECT count(DISTINCT date_trunc('day', created_at))::int INTO v_active_days
    FROM public.admin_audit
   WHERE actor_id = p_user_id
     AND created_at >= now() - interval '90 days';

  -- Recency: did they act at all in the last 7 days?
  SELECT EXISTS (
    SELECT 1 FROM public.admin_audit
     WHERE actor_id = p_user_id
       AND created_at >= now() - interval '7 days'
  ) INTO v_recent_action;

  v_score :=  70.0
            -  8.0 * v_unack
            - 25.0 * v_overturn_rate
            + 30.0 * least(1.0, sqrt(v_active_days::numeric / 30.0))
            + (CASE WHEN v_recent_action THEN 5.0 ELSE 0.0 END);

  RETURN greatest(0.0, least(100.0, v_score));
END $$;

REVOKE ALL ON FUNCTION public.compute_moderator_trust_score(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.compute_moderator_trust_score(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.moderator_trust_scores AS
SELECT u.id AS user_id,
       u.username,
       u.display_name,
       public.compute_moderator_trust_score(u.id) AS trust_score
  FROM public.users u
 WHERE EXISTS (
   SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role IN ('moderator', 'admin')
      AND (ur.revoked_at IS NULL OR ur.revoked_at > now())
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
 );

GRANT SELECT ON public.moderator_trust_scores TO authenticated;

-- ============================================================
-- PR15 — Observability UI surface (Health + Errors + Webhook drill-down)
-- See docs/runbooks/admin-health-digest.md
-- See docs/runbooks/admin-function-errors.md
-- See docs/runbooks/admin-webhooks.md
-- ============================================================

-- 1. audit_op enum extensions for the new actions.
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'health_recompute';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'error_acknowledge';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'error_acknowledge_bulk';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'webhook_replay';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. function_errors — acknowledge audit fields.
-- The Errors tab (/console/errors/) lets admins triage and acknowledge
-- operationally-handled rows. Acknowledged rows stay in the table so the
-- audit trail and post-mortem queries are preserved.
ALTER TABLE public.function_errors
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.function_errors
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES auth.users(id);
ALTER TABLE public.function_errors
  ADD COLUMN IF NOT EXISTS ack_notes text;

-- Drives the default Unacknowledged tab — partial index keeps writes cheap
-- (most acknowledged rows aren't read again outside forensics queries).
CREATE INDEX IF NOT EXISTS function_errors_unack_idx
  ON public.function_errors (created_at DESC)
  WHERE acknowledged_at IS NULL;
-- M27.1 — Multi-provider vision (#116, #118)
-- ============================================================
-- Adds provider variants beyond direct-Anthropic to the AI cascade:
-- AWS Bedrock (#116), OpenAI / Azure OpenAI / Gemini / Vertex AI
-- (#118). Plus per-sponsor model selection so beneficiaries on a
-- given credential see Haiku-cost or Sonnet-quality consistently.
--
-- Migration is additive-only:
--   • `ai_provider` enum gains 5 values via ALTER TYPE … ADD VALUE
--   • `ai_credential_kind` enum gains 4 values
--   • `sponsor_credentials` gets `preferred_model` (default
--     'claude-haiku-4-5') and `endpoint` (Azure URL / Vertex region)
--   • `sponsorships` and `sponsor_pools` get the same
--     `preferred_model` so a pool sponsor can cap to Haiku-only.

DO $$ BEGIN
  ALTER TYPE public.ai_provider ADD VALUE IF NOT EXISTS 'bedrock';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_provider ADD VALUE IF NOT EXISTS 'openai';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_provider ADD VALUE IF NOT EXISTS 'azure_openai';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_provider ADD VALUE IF NOT EXISTS 'gemini';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_provider ADD VALUE IF NOT EXISTS 'vertex_ai';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.ai_credential_kind ADD VALUE IF NOT EXISTS 'bedrock';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_credential_kind ADD VALUE IF NOT EXISTS 'openai_api_key';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_credential_kind ADD VALUE IF NOT EXISTS 'azure_openai';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_credential_kind ADD VALUE IF NOT EXISTS 'gemini_api_key';
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE public.ai_credential_kind ADD VALUE IF NOT EXISTS 'vertex_ai';
EXCEPTION WHEN others THEN NULL; END $$;

-- (sponsor_credentials.preferred_model + endpoint are added inline
--  with the original CREATE TABLE near line 3625 — they're referenced
--  by `resolve_sponsorship` below, which is itself defined before
--  this M27.1 block runs in the same file.)

-- ============================================================
-- M27.2 — Platform-wide AI call pool (#115)
-- ============================================================
-- Sponsor donates N calls to a shared pool that any user can draw
-- from. Per-user daily cap (`pool_consumption`) prevents Sybil
-- abuse. Resolution order in identify EF:
--   1. BYO key (client_keys) — always wins
--   2. User's personal sponsorship (existing M27 1-to-1)
--   3. Platform pool — round-robin among active pools
--   4. Skip Claude (PlantNet only)
--
-- Privacy: the consumer's user_id is recorded in pool_consumption
-- but never joined to auth.users.email in any RPC. Sponsors see
-- only aggregate stats.

CREATE TABLE IF NOT EXISTS public.sponsor_pools (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id   uuid NOT NULL REFERENCES public.sponsor_credentials(id) ON DELETE RESTRICT,
  total_cap       integer NOT NULL CHECK (total_cap BETWEEN 1 AND 1000000),
  used            integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  monthly_reset   boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','paused','exhausted')),
  preferred_model text NOT NULL DEFAULT 'claude-haiku-4-5'
                  CHECK (length(preferred_model) BETWEEN 1 AND 64),
  daily_user_cap  integer NOT NULL DEFAULT 10
                  CHECK (daily_user_cap BETWEEN 1 AND 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sponsor_pools_sponsor ON public.sponsor_pools(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_pools_active
  ON public.sponsor_pools(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.pool_consumption (
  user_id  uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day      date    NOT NULL,
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_pool_consumption_day ON public.pool_consumption(day);

ALTER TABLE public.sponsor_pools     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_consumption  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsor_pools_owner_read ON public.sponsor_pools;
CREATE POLICY sponsor_pools_owner_read ON public.sponsor_pools
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid());

DROP POLICY IF EXISTS sponsor_pools_owner_write ON public.sponsor_pools;
CREATE POLICY sponsor_pools_owner_write ON public.sponsor_pools
  FOR ALL TO authenticated
  USING (sponsor_id = auth.uid())
  WITH CHECK (sponsor_id = auth.uid());

-- pool_consumption is read-only for the user themselves; service role
-- (the identify EF) does the increments via RPC.
DROP POLICY IF EXISTS pool_consumption_self_read ON public.pool_consumption;
CREATE POLICY pool_consumption_self_read ON public.pool_consumption
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_pools     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsor_pools     TO service_role;
GRANT SELECT                         ON public.pool_consumption  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_consumption  TO service_role;

-- ── Pool resolution + atomic consume RPC ────────────────────────────
-- Picks the next pool slot the caller can draw from. Returns the pool
-- + credential to use, atomically increments `used` + the per-user
-- daily counter, and respects daily_user_cap. Service-role only —
-- the identify EF wraps it with the rest of the identification work.
CREATE OR REPLACE FUNCTION public.consume_pool_slot(p_user_id uuid)
RETURNS TABLE (pool_id uuid, credential_id uuid, preferred_model text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today    date := current_date;
  v_used_today integer;
  v_pool_id  uuid;
  v_cred_id  uuid;
  v_model    text;
  v_cap      integer;
BEGIN
  -- Lock the chosen pool row to make the (used + cap) check + increment atomic.
  SELECT sp.id, sp.credential_id, sp.preferred_model, sp.daily_user_cap
    INTO v_pool_id, v_cred_id, v_model, v_cap
    FROM public.sponsor_pools sp
   WHERE sp.status = 'active' AND sp.used < sp.total_cap
   ORDER BY sp.created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF v_pool_id IS NULL THEN
    RETURN;  -- no pool available
  END IF;

  -- Enforce per-user daily cap.
  SELECT COALESCE(count, 0) INTO v_used_today
    FROM public.pool_consumption
   WHERE user_id = p_user_id AND day = v_today;
  IF v_used_today >= v_cap THEN
    RETURN;  -- caller hit daily limit
  END IF;

  -- Atomic increments.
  UPDATE public.sponsor_pools SET used = used + 1, updated_at = now()
   WHERE id = v_pool_id;

  INSERT INTO public.pool_consumption (user_id, day, count)
       VALUES (p_user_id, v_today, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = pool_consumption.count + 1;

  -- Mark exhausted if we just filled it.
  UPDATE public.sponsor_pools SET status = 'exhausted'
   WHERE id = v_pool_id AND used >= total_cap AND status = 'active';

  RETURN QUERY SELECT v_pool_id, v_cred_id, v_model;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_pool_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_pool_slot(uuid) TO service_role;

-- ── Pool donation karma — +20 on INSERT to sponsor_pools ────────────
-- Awards pool_donation karma to the sponsor when they create a new pool.
CREATE OR REPLACE FUNCTION public.award_pool_donation_karma() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.add_karma_simple(NEW.sponsor_id, 20, 'pool_donation');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sponsor_pools_award_donation_karma ON public.sponsor_pools;
CREATE TRIGGER sponsor_pools_award_donation_karma AFTER INSERT ON public.sponsor_pools
  FOR EACH ROW EXECUTE FUNCTION public.award_pool_donation_karma();

-- ============================================================
-- CAMERA STATIONS (M31, issue #112) — sampling-effort metadata for camera traps
-- ============================================================
-- A station is a fixed camera deployment. Active periods record
-- when the camera was capturing — needed for trap-night counts +
-- standardised wildlife monitoring indices (RAI, detection rate per
-- 100 trap-nights, species richness per station/project).
--
-- Depends on M29 (projects) — every station belongs to a project,
-- and the auto-tagging trigger on observations writes project_id
-- before this module's logic ever runs.
--
-- v1 ships the schema + minimal owner-RLS. UI / metric rollups are
-- v1.1 follow-ups.

CREATE TABLE IF NOT EXISTS public.camera_stations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  station_key     text NOT NULL CHECK (length(station_key) BETWEEN 1 AND 64),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  name_es         text CHECK (length(name_es) BETWEEN 1 AND 200),
  coords          geography(Point, 4326) NOT NULL,
  habitat         text,
  camera_model    text,
  notes           text CHECK (length(notes) <= 4000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, station_key)
);

CREATE INDEX IF NOT EXISTS idx_camera_stations_project ON public.camera_stations(project_id);
CREATE INDEX IF NOT EXISTS idx_camera_stations_coords  ON public.camera_stations USING GIST(coords);

CREATE TABLE IF NOT EXISTS public.camera_station_periods (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id  uuid NOT NULL REFERENCES public.camera_stations(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date,
  notes       text CHECK (length(notes) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_csp_station ON public.camera_station_periods(station_id, start_date);

-- Optional FK from observations → station; populated by the CLI
-- importer when --station-key is supplied. The auto-tagging by
-- coordinates happens via the project polygon (M29) — station
-- assignment stays explicit because two stations within one polygon
-- need different trap-night counts.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS camera_station_id uuid
    REFERENCES public.camera_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_obs_camera_station ON public.observations(camera_station_id)
  WHERE camera_station_id IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────
-- A camera_station inherits its project's visibility — public projects
-- expose stations to anon; private projects restrict to project members.

ALTER TABLE public.camera_stations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_station_periods  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS camera_stations_read ON public.camera_stations;
CREATE POLICY camera_stations_read ON public.camera_stations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = camera_stations.project_id
         AND (
           p.visibility = 'public'
           OR p.owner_user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
           )
         )
    )
  );

DROP POLICY IF EXISTS camera_stations_owner_write ON public.camera_stations;
CREATE POLICY camera_stations_owner_write ON public.camera_stations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = camera_stations.project_id
         AND p.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS camera_stations_owner_update ON public.camera_stations;
CREATE POLICY camera_stations_owner_update ON public.camera_stations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = camera_stations.project_id AND p.owner_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = camera_stations.project_id AND p.owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS camera_stations_owner_delete ON public.camera_stations;
CREATE POLICY camera_stations_owner_delete ON public.camera_stations
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = camera_stations.project_id AND p.owner_user_id = auth.uid())
  );

DROP POLICY IF EXISTS camera_station_periods_read ON public.camera_station_periods;
CREATE POLICY camera_station_periods_read ON public.camera_station_periods
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.camera_stations cs
       JOIN public.projects p ON p.id = cs.project_id
       WHERE cs.id = camera_station_periods.station_id
         AND (
           p.visibility = 'public'
           OR p.owner_user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.project_members pm
              WHERE pm.project_id = p.id AND pm.user_id = auth.uid()
           )
         )
    )
  );

DROP POLICY IF EXISTS camera_station_periods_owner_write ON public.camera_station_periods;
CREATE POLICY camera_station_periods_owner_write ON public.camera_station_periods
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.camera_stations cs
       JOIN public.projects p ON p.id = cs.project_id
       WHERE cs.id = camera_station_periods.station_id
         AND p.owner_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.camera_stations cs
       JOIN public.projects p ON p.id = cs.project_id
       WHERE cs.id = camera_station_periods.station_id
         AND p.owner_user_id = auth.uid()
    )
  );

GRANT SELECT                        ON public.camera_stations         TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE        ON public.camera_stations         TO authenticated;
GRANT SELECT                        ON public.camera_station_periods  TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE        ON public.camera_station_periods  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.camera_stations         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.camera_station_periods  TO service_role;

-- ── Trap-night helper ────────────────────────────────────────────────
-- Returns the number of nights a station was active across all its
-- periods, optionally bounded to a date range. NULL end_date means
-- "still active" — counted up to the supplied upper bound (or now()).
CREATE OR REPLACE FUNCTION public.station_trap_nights(
  p_station_id uuid,
  p_from       date DEFAULT NULL,
  p_to         date DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(
    GREATEST(
      0,
      LEAST(COALESCE(end_date, COALESCE(p_to, current_date)), COALESCE(p_to, current_date))
        - GREATEST(start_date, COALESCE(p_from, start_date))
    )
  ), 0)::integer
  FROM public.camera_station_periods
  WHERE station_id = p_station_id;
$$;

GRANT EXECUTE ON FUNCTION public.station_trap_nights(uuid, date, date) TO anon, authenticated, service_role;

-- ── MCP platform metrics ─────────────────────────────────────────────
-- Called by the MCP server's get_platform_status tool (scope: status).
-- Returns aggregate counts safe to share with any token holder.
CREATE OR REPLACE FUNCTION public.platform_status_metrics()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_observations',    (SELECT COUNT(*) FROM observations WHERE sync_status = 'synced'),
    'total_species',         (SELECT COUNT(DISTINCT primary_taxon_id) FROM observations WHERE sync_status = 'synced' AND primary_taxon_id IS NOT NULL),
    'active_observers_30d',  (SELECT COUNT(DISTINCT observer_id) FROM observations WHERE sync_status = 'synced' AND observed_at >= now() - interval '30 days'),
    'public_projects',       (SELECT COUNT(*) FROM projects WHERE visibility = 'public'),
    'observations_7d',       (SELECT COUNT(*) FROM observations WHERE observed_at >= now() - interval '7 days' AND sync_status = 'synced'),
    'as_of',                 now()
  )
$$;
REVOKE ALL ON FUNCTION public.platform_status_metrics() FROM public;
GRANT EXECUTE ON FUNCTION public.platform_status_metrics() TO service_role;

-- Called by the MCP server's get_admin_metrics tool (scope: admin).
-- The Edge Function also verifies the caller holds the admin role before
-- invoking this, so the service_role-only grant is a second guard.
CREATE OR REPLACE FUNCTION public.admin_platform_metrics()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_users',           (SELECT COUNT(*) FROM users),
    'new_users_7d',          (SELECT COUNT(*) FROM users WHERE joined_at >= now() - interval '7 days'),
    'new_users_30d',         (SELECT COUNT(*) FROM users WHERE joined_at >= now() - interval '30 days'),
    'total_observations',    (SELECT COUNT(*) FROM observations WHERE sync_status = 'synced'),
    'observations_7d',       (SELECT COUNT(*) FROM observations WHERE observed_at >= now() - interval '7 days' AND sync_status = 'synced'),
    'observations_30d',      (SELECT COUNT(*) FROM observations WHERE observed_at >= now() - interval '30 days' AND sync_status = 'synced'),
    'active_users_7d',       (SELECT COUNT(DISTINCT observer_id) FROM observations WHERE observed_at >= now() - interval '7 days'),
    'total_species',         (SELECT COUNT(DISTINCT primary_taxon_id) FROM observations WHERE primary_taxon_id IS NOT NULL),
    'public_projects',       (SELECT COUNT(*) FROM projects WHERE visibility = 'public'),
    'as_of',                 now()
  )
$$;
REVOKE ALL ON FUNCTION public.admin_platform_metrics() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_platform_metrics() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- PR16 — Hot-path indexes for admin entity browsers (Identifications,
-- Notifications, Media, Follows, Watchlists, Projects). Each backs a
-- (filter_field, created_at DESC) lookup pattern in the browser tabs.
-- All idempotent (CREATE INDEX IF NOT EXISTS) and additive only — no
-- write penalty beyond the index keys themselves.
-- ════════════════════════════════════════════════════════════════════════

-- Identifications — admin time-ordered list, validator filter, RG filter
CREATE INDEX IF NOT EXISTS idx_id_created_desc
  ON public.identifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_id_validator_created
  ON public.identifications (validated_by, created_at DESC)
  WHERE validated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_id_rg_created
  ON public.identifications (is_research_grade, created_at DESC);

-- Notifications — kind-filtered admin browse (per-user is already covered)
CREATE INDEX IF NOT EXISTS idx_notifications_kind_created
  ON public.notifications (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created_desc
  ON public.notifications (created_at DESC);

-- Media files — type-filter + active browse
CREATE INDEX IF NOT EXISTS idx_media_type_created
  ON public.media_files (media_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_active_created
  ON public.media_files (created_at DESC)
  WHERE deleted_at IS NULL;

-- Watchlists — taxon-filtered browse
CREATE INDEX IF NOT EXISTS idx_watchlists_taxon_created
  ON public.watchlists (taxon_id, created_at DESC)
  WHERE taxon_id IS NOT NULL;

-- Follows — time-ordered admin spam-audit
CREATE INDEX IF NOT EXISTS idx_follows_created_desc
  ON public.follows (created_at DESC);

-- Projects — time-ordered admin browse
CREATE INDEX IF NOT EXISTS idx_projects_created_desc
  ON public.projects (created_at DESC);

-- Observation comments — author timeline (existing comments view + future
-- author drill-downs from the user browser)
CREATE INDEX IF NOT EXISTS idx_comments_author_created
  ON public.observation_comments (author_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- PR16 — Admin SELECT policies on owner-scoped tables (notifications,
-- watchlists). These tables previously had only owner-scoped RLS; admin
-- already has equivalent service-role visibility for ops. These policies
-- expose the same audit visibility through the console using the
-- has_role() predicate that is the canonical privilege gate.
-- Privacy-neutral: admin can already read these via Supabase Studio /
-- service-role; this just plumbs them through anon/authenticated so the
-- console can render them. No write privilege is granted.
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS notif_admin_read ON public.notifications;
CREATE POLICY notif_admin_read ON public.notifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS watchlists_admin_read ON public.watchlists;
CREATE POLICY watchlists_admin_read ON public.watchlists
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ════════════════════════════════════════════════════════════════════════
-- gc_orphan_media_log — audit log for the gc-orphan-media cron (#285)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gc_orphan_media_log (
  id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_at        timestamptz NOT NULL DEFAULT now(),
  prefix        text        NOT NULL,
  scanned       int         NOT NULL,
  deleted       int         NOT NULL DEFAULT 0,
  bytes_freed   bigint      NOT NULL DEFAULT 0,
  errors        int         NOT NULL DEFAULT 0,
  duration_ms   int         NOT NULL DEFAULT 0,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_gc_orphan_media_log_run_at
  ON public.gc_orphan_media_log(run_at DESC);

ALTER TABLE public.gc_orphan_media_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gc_orphan_media_log_admin_read ON public.gc_orphan_media_log;
CREATE POLICY gc_orphan_media_log_admin_read ON public.gc_orphan_media_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT ON public.gc_orphan_media_log TO service_role;
-- ── merge_user_accounts RPC (#284) ──────────────────────────────────────────
-- Rewrites all FK references from discard_user to keep_user in a single
-- transaction. Called only from the user-merge admin handler.
-- SECURITY DEFINER so it can write to auth.users (soft-delete discard).

CREATE OR REPLACE FUNCTION public.merge_user_accounts(
  p_keep    uuid,
  p_discard uuid,
  p_actor   uuid,
  p_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_summary jsonb := '{}'::jsonb;
  v_count   int;
BEGIN
  IF p_keep = p_discard THEN
    RAISE EXCEPTION 'keep and discard must differ';
  END IF;

  -- Verify both users exist
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_keep) THEN
    RAISE EXCEPTION 'keep user not found: %', p_keep;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_discard) THEN
    RAISE EXCEPTION 'discard user not found: %', p_discard;
  END IF;

  -- Rewrite FK references table by table
  UPDATE public.observations    SET observer_id  = p_keep WHERE observer_id  = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('observations', v_count);

  UPDATE public.identifications SET validated_by = p_keep WHERE validated_by = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('identifications_validated', v_count);

  UPDATE public.comments        SET user_id      = p_keep WHERE user_id      = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('comments', v_count);

  UPDATE public.follows         SET follower_id  = p_keep WHERE follower_id  = p_discard;
  UPDATE public.follows         SET followee_id  = p_keep WHERE followee_id  = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('follows', v_count);

  UPDATE public.reactions       SET user_id      = p_keep WHERE user_id      = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('reactions', v_count);

  -- For badges: delete duplicates in the discard user first, then update
  DELETE FROM public.user_badges
  WHERE user_id = p_discard
    AND badge_key IN (SELECT badge_key FROM public.user_badges WHERE user_id = p_keep);
  UPDATE public.user_badges SET user_id = p_keep WHERE user_id = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('badges', v_count);

  UPDATE public.watchlist_entries SET user_id    = p_keep WHERE user_id      = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('watchlist', v_count);

  UPDATE public.projects        SET owner_id     = p_keep WHERE owner_id     = p_discard;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_summary := v_summary || jsonb_build_object('projects', v_count);

  -- Soft-delete the discarded account
  UPDATE public.users SET
    username     = 'deleted_merged_' || left(p_discard::text, 8),
    display_name = '[Merged account]',
    deleted_at   = now()
  WHERE id = p_discard;

  -- Audit log
  INSERT INTO public.admin_audit (actor_id, op, payload, reason)
  VALUES (p_actor, 'user.merge', jsonb_build_object(
    'keep_user_id',    p_keep,
    'discard_user_id', p_discard,
    'summary',         v_summary
  ), p_reason);

  RETURN v_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_user_accounts(uuid, uuid, uuid, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: extend identifications.source CHECK to cover client-side
-- identifiers (BirdNET-Lite audio, EfficientNet-Lite0 images, MegaDetector
-- camera-trap, Phi-3.5-vision). Without this, the sync layer's direct
-- insert of a client identification (added 2026-05-01 to fix audio
-- observations landing as "Unknown species") fails the CHECK constraint.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.identifications
  DROP CONSTRAINT IF EXISTS identifications_source_check;
ALTER TABLE public.identifications
  ADD CONSTRAINT identifications_source_check
  CHECK (source IN (
    -- Server-side cascade
    'plantnet','claude_haiku','claude_sonnet','onnx_offline','human',
    -- Client-side identifiers (M03 + M31)
    'birdnet_lite','onnx_efficientnet_lite0','camera_trap_megadetector','phi_vision',
    -- M32 multi-provider vision (each provider tags its result with its kind)
    'bedrock','openai','azure_openai','gemini','vertex_ai'
  ));

-- ============================================================
-- CONSERVATION STATUS COLUMNS (karma conservation bonus — #189)
-- ============================================================
-- taxa.iucn_category and taxa.nom059_status already exist in the
-- CREATE TABLE above. These idempotent ALTERs are here as a
-- documentation marker: the karma conservation bonus system
-- (src/lib/karma-conservation.ts) reads these columns to compute
-- multipliers for karma rewards. Observations of threatened species
-- earn bonus karma:
--   IUCN:    LC(1×) → NT(1.2×) → VU(1.5×) → EN(2×) → CR(3×) → EW(5×)
--   NOM-059: Pr(1.3×) → A(1.8×) → P(2.5×) → E(4×)
-- The higher of the two multipliers wins.
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS iucn_category text;
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS nom059_status text;

-- ── M34: Species Explorer — taxa enhancements ──────────────────────────────
-- hero_media_id: community-voted best photo for the species
-- hero_observation_id: the observation that provides the hero photo
-- hero_updated_at: when the hero was last recomputed
-- slug: URL-safe species identifier (lower, spaces→dashes)
-- rarity_tier: 1=common, 2=uncommon, 3=rare, 4=very rare (used by daily challenge)
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS hero_media_id uuid REFERENCES public.media_files(id) ON DELETE SET NULL;
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS hero_observation_id uuid REFERENCES public.observations(id) ON DELETE SET NULL;
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS hero_updated_at timestamptz;
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.taxa ADD COLUMN IF NOT EXISTS rarity_tier int CHECK (rarity_tier BETWEEN 1 AND 4);

-- Back-fill slugs for existing taxa (idempotent)
UPDATE public.taxa
SET slug = lower(regexp_replace(scientific_name, '\s+', '-', 'g'))
WHERE slug IS NULL AND scientific_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS taxa_slug_idx ON public.taxa(slug)
  WHERE slug IS NOT NULL;

-- Materialized view for the taxonomy sunburst
CREATE MATERIALIZED VIEW IF NOT EXISTS public.species_taxonomy_counts AS
SELECT
  t.id                            AS taxon_id,
  t.kingdom,
  t.phylum,
  t.class,
  t."order",
  t.family,
  t.genus,
  t.scientific_name,
  t.common_name_es,
  t.common_name_en,
  t.slug,
  t.hero_media_id,
  COUNT(DISTINCT o.id)            AS observation_count,
  COUNT(DISTINCT o.observer_id)   AS observer_count
FROM public.taxa t
JOIN public.observations o ON o.primary_taxon_id = t.id
WHERE o.sync_status = 'synced'
GROUP BY
  t.id, t.kingdom, t.phylum, t.class, t."order",
  t.family, t.genus, t.scientific_name, t.common_name_es, t.common_name_en,
  t.slug, t.hero_media_id
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS species_taxonomy_counts_taxon_id_idx
  ON public.species_taxonomy_counts (taxon_id);

-- Allow best_shot reactions (community hero photo nominations)
DO $$ BEGIN
  ALTER TABLE public.reactions
    DROP CONSTRAINT IF EXISTS reactions_reaction_type_check;
  ALTER TABLE public.reactions
    ADD CONSTRAINT reactions_reaction_type_check
    CHECK (reaction_type IN ('thumbs_up','thumbs_down','heart','expert','best_shot'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Location update via RPC ──────────────────────────────────────────────────
-- PostgREST cannot cast jsonb → geography implicitly (requires owning both
-- types, which the DB role does not). Instead of a CAST, we expose an RPC
-- function that accepts lat/lng as floats and builds the geography internally.
-- The client calls rpc('update_observation_location', {p_obs_id, p_lat, p_lng}).
-- SECURITY DEFINER so the function runs as the function owner (bypasses RLS
-- for the geography construction only); the WHERE clause still enforces
-- observer_id = auth.uid() so users can only move their own observations.

CREATE OR REPLACE FUNCTION public.update_observation_location(
  p_obs_id uuid,
  p_lat    double precision,
  p_lng    double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- RLS-equivalent guard: only the owner can move their observation.
  -- The function is SECURITY DEFINER so geography construction works,
  -- but we explicitly check auth.uid() = observer_id for safety.
  UPDATE public.observations
  SET
    location        = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    location_source = 'manual',
    updated_at      = now()
  WHERE id          = p_obs_id
    AND observer_id = (SELECT auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rls_filtered'
      USING HINT = 'Observation not found or you are not the owner.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_observation_location(uuid, double precision, double precision)
  TO authenticated;



-- ════════════════════════════════════════════════════════════════════════
-- M-Loc-1: Places infrastructure
-- ════════════════════════════════════════════════════════════════════════
-- Adds:
--   - public.places table with GIST/GIN indexes and RLS
--   - observations.place_id FK column + index
--   - assign_observation_place trigger (BEFORE INSERT OR UPDATE OF location)
--   - H3 fallback: auto-creates a place_type='h3_cell' row when no named
--     place covers the location
-- Blocked by: none (foundational)
-- Blocks: M-Loc-2, M-Loc-3, M-Loc-4, M-Loc-5
-- ════════════════════════════════════════════════════════════════════════

-- ── places table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.places (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  name_local      text,
  place_type      text NOT NULL
                  CHECK (place_type IN ('protected_area','h3_cell','custom','community')),
  geometry        geography(Geometry,4326) NOT NULL,
  h3_cells        text[],
  h3_resolution   int,
  source          text NOT NULL
                  CHECK (source IN ('wdpa','user','auto_h3','nominatim')),
  source_id       text,
  country_code    text,
  state_province  text,
  description     text,
  created_by      uuid REFERENCES public.users(id),
  obs_count       int NOT NULL DEFAULT 0,
  species_count   int NOT NULL DEFAULT 0,
  observer_count  int NOT NULL DEFAULT 0,
  first_obs_at    timestamptz,
  last_obs_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_places_geometry  ON public.places USING GIST(geometry);
CREATE INDEX IF NOT EXISTS idx_places_h3_cells  ON public.places USING GIN(h3_cells);
CREATE INDEX IF NOT EXISTS idx_places_type      ON public.places(place_type);
CREATE INDEX IF NOT EXISTS idx_places_obs_count ON public.places(obs_count DESC);

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

-- Everyone can read places (public catalogue)
DROP POLICY IF EXISTS places_public_read  ON public.places;
CREATE POLICY places_public_read  ON public.places FOR SELECT USING (true);

-- Only the row owner can update custom/community places
DROP POLICY IF EXISTS places_owner_update ON public.places;
CREATE POLICY places_owner_update ON public.places FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()))
  WITH CHECK (created_by = (SELECT auth.uid()));

-- Authenticated users may insert custom or community places
DROP POLICY IF EXISTS places_user_insert  ON public.places;
CREATE POLICY places_user_insert  ON public.places FOR INSERT TO authenticated
  WITH CHECK (place_type IN ('custom','community') AND created_by = (SELECT auth.uid()));

-- ── observations.place_id FK ──────────────────────────────────────────────────
ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES public.places(id);
CREATE INDEX IF NOT EXISTS idx_obs_place ON public.observations(place_id) WHERE place_id IS NOT NULL;

-- ── assign_observation_place trigger ─────────────────────────────────────────
-- Fires BEFORE INSERT OR UPDATE OF location so the trigger can rewrite
-- NEW.place_id before the row lands in the table (no extra UPDATE round-trip).
--
-- Logic:
--   1. If location is NULL → leave place_id unchanged, return NEW.
--   2. Look for the smallest named place (place_type ≠ 'h3_cell') that
--      contains the point.  ST_Within on the GIST index is sub-ms at
--      the expected volume (<10 k places for MX).
--   3. If none found → compute a deterministic slug from rounded lat/lng,
--      upsert an auto_h3 place_type='h3_cell' row (ST_Buffer 5 km), and
--      use its id.
--
-- H3 extension: if h3-pg is available the slug uses the real H3 cell ID
-- at resolution 7 instead of the lat/lng rounding approximation.
-- Degrade gracefully when the extension is absent.
--
-- SECURITY DEFINER: needed to INSERT into places (service-role bypass)
-- without exposing a writable service-role key to the trigger body.
-- The WHERE clause on the UPDATE guard still enforces observer ownership.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_observation_place()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_place_id     uuid;
  v_lat          double precision;
  v_lng          double precision;
  v_slug         text;
  v_h3_available boolean := false;
  v_cell_id      text;
BEGIN
  -- 1. No location → nothing to do
  IF NEW.location IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Find the most-specific named place (smallest area, not an h3_cell)
  SELECT id INTO v_place_id
    FROM public.places
   WHERE place_type != 'h3_cell'
     AND ST_Within(NEW.location::geometry, geometry::geometry)
   ORDER BY ST_Area(geometry::geometry) ASC
   LIMIT 1;

  IF v_place_id IS NOT NULL THEN
    NEW.place_id := v_place_id;
    RETURN NEW;
  END IF;

  -- 3. No named place found → upsert an H3 fallback cell
  v_lat := ST_Y(NEW.location::geometry);
  v_lng := ST_X(NEW.location::geometry);

  -- Try to use h3-pg for a real cell ID if available
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'h3'
    ) INTO v_h3_available;
  EXCEPTION WHEN OTHERS THEN
    v_h3_available := false;
  END;

  IF v_h3_available THEN
    BEGIN
      -- h3_lat_lng_to_cell returns an h3index (bigint or text depending on version)
      SELECT h3_lat_lng_to_cell(v_lat, v_lng, 7)::text INTO v_cell_id;
      v_slug := 'h3_' || v_cell_id;
    EXCEPTION WHEN OTHERS THEN
      -- Extension present but function signature differs — fall back gracefully
      v_h3_available := false;
    END;
  END IF;

  IF NOT v_h3_available OR v_cell_id IS NULL THEN
    -- Lat/lng rounding approximation (~5 km grid at equator, resolution 7 equivalent)
    v_slug := 'h3_' ||
              replace(to_char(round(v_lat::numeric, 2), 'FM999990.00'), '.', 'p')
              || '_' ||
              replace(to_char(round(v_lng::numeric, 2), 'FM999990.00'), '.', 'p');
    -- Normalize sign: negative becomes 'm' prefix
    v_slug := replace(v_slug, 'h3_-', 'h3_m');
    v_slug := replace(v_slug, '__m', '_m');
  END IF;

  -- Upsert the H3 cell row (idempotent on slug)
  INSERT INTO public.places (
    slug,
    name,
    place_type,
    geometry,
    source,
    country_code
  )
  VALUES (
    v_slug,
    'Zona H3 ' || v_slug,
    'h3_cell',
    -- ~5 km buffer around the point
    ST_Buffer(
      ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
      5000
    ),
    'auto_h3',
    NULL  -- country_code backfilled separately if needed
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_place_id;

  -- If DO NOTHING fired (row already existed) fetch the id
  IF v_place_id IS NULL THEN
    SELECT id INTO v_place_id FROM public.places WHERE slug = v_slug;
  END IF;

  NEW.place_id := v_place_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_observation_place_trigger ON public.observations;
CREATE TRIGGER assign_observation_place_trigger
  BEFORE INSERT OR UPDATE OF location ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_observation_place();

-- ── M-Loc-3: Place detail RPCs ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.place_top_species(
  p_place_id uuid,
  p_limit    int DEFAULT 20
)
RETURNS TABLE (
  taxon_id       uuid,
  scientific_name text,
  common_name_es  text,
  slug            text,
  obs_count       bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.scientific_name, t.common_name_es, t.slug, COUNT(*) AS obs_count
  FROM public.observations o
  JOIN public.taxa t ON t.id = o.primary_taxon_id
  WHERE o.place_id = p_place_id AND o.sync_status = 'synced'
  GROUP BY t.id, t.scientific_name, t.common_name_es, t.slug
  ORDER BY obs_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.place_top_observers(
  p_place_id uuid,
  p_limit    int DEFAULT 10
)
RETURNS TABLE (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  obs_count    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.display_name, u.avatar_url, COUNT(*) AS obs_count
  FROM public.observations o
  JOIN public.users u ON u.id = o.observer_id
  WHERE o.place_id = p_place_id AND o.sync_status = 'synced'
  GROUP BY u.id, u.display_name, u.avatar_url
  ORDER BY obs_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.place_geojson_by_slug(p_slug text)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT row_to_json(t) FROM (
    SELECT
      id, slug, name, name_local, place_type, source,
      country_code, state_province, description,
      obs_count, species_count, observer_count,
      first_obs_at, last_obs_at,
      ST_AsGeoJSON(geometry)::json AS geometry_geojson,
      ST_AsGeoJSON(ST_Centroid(geometry::geometry))::json AS centroid_geojson
    FROM public.places
    WHERE slug = p_slug
    LIMIT 1
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.place_top_species(uuid, int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.place_top_observers(uuid, int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.place_geojson_by_slug(text) TO authenticated, anon;

-- ── places_map_geojson RPC ─────────────────────────────────────────────────────
-- Returns a GeoJSON FeatureCollection of all places with obs_count > 0.
-- Used by the "Show areas" toggle on the explore map.
CREATE OR REPLACE FUNCTION public.places_map_geojson(p_limit int DEFAULT 200)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(json_agg(f.feature), '[]'::json)
  )
  FROM (
    SELECT json_build_object(
      'type',       'Feature',
      'geometry',   ST_AsGeoJSON(geometry)::json,
      'properties', json_build_object(
        'id',            id,
        'slug',          slug,
        'name',          name,
        'place_type',    place_type,
        'obs_count',     obs_count,
        'species_count', species_count
      )
    ) AS feature
    FROM public.places
    WHERE obs_count > 0
    ORDER BY obs_count DESC
    LIMIT p_limit
  ) f;
$$;

GRANT EXECUTE ON FUNCTION public.places_map_geojson(int) TO authenticated, anon;

-- ── M-Loc-4/5: places_near RPC ────────────────────────────────────────────────
-- Returns places sorted by distance from a given lat/lng point.
-- Used by the "Near me" button on the places index page.

CREATE OR REPLACE FUNCTION public.places_near(
  p_lat    double precision,
  p_lng    double precision,
  p_limit  int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  slug         text,
  name         text,
  place_type   text,
  obs_count    int,
  species_count int,
  distance_m   double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    id, slug, name, place_type, obs_count, species_count,
    ST_Distance(
      geometry,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
    ) AS distance_m
  FROM public.places
  WHERE obs_count > 0
  ORDER BY distance_m ASC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.places_near(double precision, double precision, int, int)
  TO authenticated, anon;

-- ── M34 Phase 1: Species profile page RPCs ──────────────────────────────────

-- get_species_stats: aggregated stats for a single taxon
CREATE OR REPLACE FUNCTION public.get_species_stats(p_taxon_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT json_build_object(
    'obs_count', COUNT(DISTINCT o.id),
    'observer_count', COUNT(DISTINCT o.observer_id),
    'last_observed_at', MAX(o.observed_at),
    'consensus_pct', ROUND(
      100.0 * COUNT(DISTINCT o.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM identifications i
          WHERE i.observation_id = o.id AND i.is_primary AND i.scientific_name = t.scientific_name
        )
      ) / NULLIF(COUNT(DISTINCT o.id), 0), 1
    ),
    'state_counts', (
      SELECT json_agg(json_build_object('state', state_province, 'count', n))
      FROM (
        SELECT state_province, COUNT(*) as n
        FROM observations
        WHERE primary_taxon_id = p_taxon_id AND sync_status = 'synced' AND state_province IS NOT NULL
        GROUP BY state_province ORDER BY n DESC LIMIT 5
      ) s
    )
  )
  FROM observations o
  JOIN taxa t ON t.id = p_taxon_id
  WHERE o.primary_taxon_id = p_taxon_id AND o.sync_status = 'synced';
$$;

GRANT EXECUTE ON FUNCTION public.get_species_stats(uuid) TO authenticated, anon;

-- recompute_species_hero: pick the best photo for a taxon (most best_shot reactions, then newest)
CREATE OR REPLACE FUNCTION public.recompute_species_hero(p_taxon_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_media_id uuid;
  v_obs_id uuid;
BEGIN
  SELECT mf.id, o.id INTO v_media_id, v_obs_id
  FROM media_files mf
  JOIN observations o ON o.id = mf.observation_id
  LEFT JOIN reactions r ON r.target_id = mf.id AND r.reaction_type = 'best_shot'
  WHERE o.primary_taxon_id = p_taxon_id
    AND o.sync_status = 'synced'
    AND mf.deleted_at IS NULL
    AND mf.media_type = 'photo'
  GROUP BY mf.id, o.id
  ORDER BY COUNT(r.id) DESC, o.observed_at DESC
  LIMIT 1;
  UPDATE taxa SET hero_media_id = v_media_id, hero_observation_id = v_obs_id, hero_updated_at = now()
  WHERE id = p_taxon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_species_hero(uuid) TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════
-- Pool analytics: top taxa + daily usage (#226)
-- ═══════════════════════════════════════════════════════════════════════════

-- Top taxa identified via a specific pool (last 30 days)
-- NOTE: pool_consumption tracks daily call counts per user but does not
-- link to specific observations. Until ai_usage gains a pool_id +
-- observation_id column, this function returns an empty set. The
-- PoolDashboardView handles this gracefully with a "coming soon" message.
CREATE OR REPLACE FUNCTION public.pool_top_taxa(p_pool_id uuid)
RETURNS TABLE(scientific_name text, call_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT NULL::text, NULL::bigint WHERE false;
$$;

-- Daily usage for a pool. Original broken body — kept here so the schema
-- replays in order against a fresh DB (pool_usage_daily is declared later
-- in the file). The FIXED body that joins pool_usage_daily + sponsor_pools
-- and filters by caller ownership lives at the bottom of the file in the
-- 2026-05-07 trailer; CREATE OR REPLACE FUNCTION is idempotent and the
-- last definition wins, so consumers get the corrected behavior.
CREATE OR REPLACE FUNCTION public.pool_daily_usage(p_pool_id uuid)
RETURNS TABLE(usage_date date, calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT pc.day AS usage_date, pc.count::bigint AS calls
  FROM public.pool_consumption pc
  WHERE pc.day >= date_trunc('month', now())::date
  ORDER BY pc.day;
$$;

GRANT EXECUTE ON FUNCTION public.pool_top_taxa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pool_daily_usage(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Wire dead karma reasons: observation_synced + first_in_rastrum.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.award_observation_synced_karma()
RETURNS trigger AS $$
BEGIN
  PERFORM public.add_karma_simple(NEW.observer_id, 1, 'observation_synced');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS award_observation_synced_karma_trigger ON public.observations;
CREATE TRIGGER award_observation_synced_karma_trigger
  AFTER INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.award_observation_synced_karma();

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
  v_observer_id  uuid;
  v_other_rg_exists boolean;
  v_already_awarded boolean;
BEGIN
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
    RETURN;
  END IF;

  SELECT COALESCE(bool_or(is_research_grade), false)
    INTO prev_research_grade
    FROM public.identifications
   WHERE observation_id = p_observation_id AND is_primary;

  IF winning_score >= 2.0 AND validator_count >= 2 THEN
    UPDATE public.identifications
       SET is_research_grade = true
     WHERE observation_id = p_observation_id
       AND taxon_id = winning_taxon
       AND is_primary;
    was_promoted := NOT prev_research_grade;
  END IF;

  IF NOT was_promoted THEN RETURN; END IF;

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

  FOR v_voter IN
    SELECT DISTINCT i.validated_by AS user_id, i.taxon_id, i.confidence
    FROM   public.identifications i
    WHERE  i.observation_id = p_observation_id
      AND  i.validated_by IS NOT NULL
  LOOP
    IF v_voter.taxon_id = winning_taxon THEN
      v_outcome := 'win';
    ELSE
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

  SELECT observer_id INTO v_observer_id
    FROM public.observations
   WHERE id = p_observation_id;

  IF v_observer_id IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.identifications i
   WHERE i.taxon_id = winning_taxon
     AND i.is_research_grade = true
     AND i.observation_id <> p_observation_id
  ) INTO v_other_rg_exists;

  IF v_other_rg_exists THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.karma_events
    WHERE reason = 'first_in_rastrum'
      AND taxon_id = winning_taxon
  ) INTO v_already_awarded;

  IF v_already_awarded THEN RETURN; END IF;

  INSERT INTO public.karma_events
    (user_id, observation_id, taxon_id, delta, reason)
  VALUES
    (v_observer_id, p_observation_id, winning_taxon, 10, 'first_in_rastrum');

  UPDATE public.users
     SET karma_total      = karma_total + 10,
         karma_updated_at = now()
   WHERE id = v_observer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recompute_consensus(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_consensus(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- karma_leaderboard_30d — 30-day rolling karma leaderboard
-- ═══════════════════════════════════════════════════════════════════════════
-- Materialized view that aggregates positive karma deltas over the last 30
-- days per user. The eligibility predicate mirrors community_observers
-- (`hide_from_leaderboards = false`); MVs don't have RLS, so the privacy
-- gate is baked into the WHERE clause.
--
-- Refreshed every 6h via pg_cron (see cron-schedules.sql). Initial refresh
-- (non-concurrent, fine on an empty MV) runs at apply time so the view is
-- queryable immediately. Subsequent refreshes use CONCURRENTLY thanks to
-- the unique index on user_id.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.karma_leaderboard_30d AS
SELECT
  u.id                                                                AS user_id,
  u.username,
  u.display_name,
  u.avatar_url,
  u.country_code,
  u.species_count,
  COALESCE(SUM(ke.delta) FILTER (WHERE ke.delta > 0), 0)::numeric     AS karma_30d,
  COUNT(*) FILTER (WHERE ke.reason = 'consensus_win' AND ke.delta > 0)::int AS wins_30d,
  COUNT(ke.id)::int                                                   AS events_30d
FROM public.users u
LEFT JOIN public.karma_events ke
  ON ke.user_id = u.id
 AND ke.created_at >= now() - interval '30 days'
WHERE u.hide_from_leaderboards = false
GROUP BY u.id;

CREATE UNIQUE INDEX IF NOT EXISTS karma_leaderboard_30d_user_id_uidx
  ON public.karma_leaderboard_30d (user_id);

CREATE INDEX IF NOT EXISTS karma_leaderboard_30d_karma_idx
  ON public.karma_leaderboard_30d (karma_30d DESC NULLS LAST);

GRANT SELECT ON public.karma_leaderboard_30d TO anon, authenticated;

-- Initial population. Safe to run on each apply: REFRESH on an MV that's
-- already been refreshed is just a no-op write. Non-concurrent so it works
-- on the very first apply when the MV is empty (CONCURRENTLY requires
-- the MV to be populated at least once).
DO $$ BEGIN
  REFRESH MATERIALIZED VIEW public.karma_leaderboard_30d;
EXCEPTION WHEN OTHERS THEN
  -- A pre-existing concurrent refresh from cron may collide; ignore.
  NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- #703 — karma_leaderboard_window: server-side aggregation for today/week.
--
-- The 30-day leaderboard uses the materialized view above; shorter windows
-- (today / week) need an exact, on-demand aggregation. Doing the GROUP BY
-- client-side after pulling raw karma_events rows breaks correctness once
-- a power user accrues more rows than the LIMIT cap (the prior 5000-row
-- pull aggregated client-side could mis-rank the top 20). This RPC pushes
-- the aggregation, ORDER BY, and LIMIT down to Postgres.
--
-- SECURITY DEFINER is required so the function bypasses karma_events_self_read
-- RLS for the aggregation. The privacy gate is the JOIN against
-- community_observers, which already enforces hide_from_leaderboards = false.
-- LANGUAGE sql binds search_path at definition time, so no SET search_path
-- is needed (per CLAUDE.md schema invariant 3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.karma_leaderboard_window(
  p_since        timestamptz,
  p_limit        integer    DEFAULT 20,
  p_restrict_ids uuid[]     DEFAULT NULL,
  p_country_code text       DEFAULT NULL
)
RETURNS TABLE (user_id uuid, total numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ke.user_id, SUM(ke.delta)::numeric AS total
    FROM public.karma_events ke
    JOIN public.community_observers co ON co.id = ke.user_id
   WHERE ke.delta > 0
     AND ke.created_at >= p_since
     AND (p_restrict_ids IS NULL OR ke.user_id = ANY(p_restrict_ids))
     AND (p_country_code IS NULL OR co.country_code = p_country_code)
   GROUP BY ke.user_id
   ORDER BY total DESC
   LIMIT GREATEST(p_limit, 1);
$$;

REVOKE EXECUTE ON FUNCTION public.karma_leaderboard_window(timestamptz, integer, uuid[], text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.karma_leaderboard_window(timestamptz, integer, uuid[], text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #589 — UNIQUE primary identification per observation + upsert RPC.
--
-- Multiple code paths (sync.ts step 4.5, triggerIdentify, identify EF,
-- retry-unidentified, MCP observe_create) each independently insert
-- is_primary=true rows. Under transient errors (4.5 returns clientIdErr but
-- the row was actually written), two primary rows can land for the same
-- observation. There was no SQL guard.
--
-- Cleanup must precede the index creation; otherwise db-apply fails on
-- existing duplicates.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  WITH ranked AS (
    SELECT id, observation_id,
           ROW_NUMBER() OVER (PARTITION BY observation_id
                              ORDER BY created_at DESC, id DESC) AS rn
    FROM public.identifications
    WHERE is_primary IS TRUE
  )
  UPDATE public.identifications i
  SET is_primary = false
  FROM ranked r
  WHERE i.id = r.id AND r.rn > 1;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS identifications_one_primary_per_obs
  ON public.identifications (observation_id)
  WHERE is_primary IS TRUE;

-- upsert_primary_identification: SECURITY DEFINER RPC that demotes any
-- lower-confidence existing primary, or inserts as non-primary if a
-- higher-confidence primary already exists. Callers stop fighting the
-- UNIQUE constraint by routing every primary write through here.
CREATE OR REPLACE FUNCTION public.upsert_primary_identification(
  p_observation_id uuid,
  p_scientific_name text,
  p_taxon_id uuid,
  p_confidence numeric,
  p_source text,
  p_raw_response jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.identifications
  SET is_primary = false
  WHERE observation_id = p_observation_id
    AND is_primary IS TRUE
    AND confidence < p_confidence;

  IF EXISTS (
    SELECT 1 FROM public.identifications
    WHERE observation_id = p_observation_id AND is_primary IS TRUE
  ) THEN
    INSERT INTO public.identifications (
      observation_id, scientific_name, taxon_id,
      confidence, source, raw_response, is_primary
    )
    VALUES (
      p_observation_id, p_scientific_name, p_taxon_id,
      p_confidence, p_source, p_raw_response, false
    )
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.identifications (
      observation_id, scientific_name, taxon_id,
      confidence, source, raw_response, is_primary
    )
    VALUES (
      p_observation_id, p_scientific_name, p_taxon_id,
      p_confidence, p_source, p_raw_response, true
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.upsert_primary_identification(uuid, text, uuid, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_primary_identification(uuid, text, uuid, numeric, text, jsonb) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- #581 — anon_rate_limit: persistent per-IP rate counter for unauthenticated
-- callers. Replaces the in-memory globalThis Map in identify EF that reset
-- on every V8 cold start. Cleanup cron lives in cron-schedules.sql.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.anon_rate_limit (
  ip        text NOT NULL,
  endpoint  text NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anon_rate_limit_lookup
  ON public.anon_rate_limit (endpoint, ip, ts DESC);

ALTER TABLE public.anon_rate_limit ENABLE ROW LEVEL SECURITY;
-- Service-role only — no anon/authenticated grants. The EF talks to this
-- table via service role; never exposed to clients.
DROP POLICY IF EXISTS anon_rate_limit_service_only ON public.anon_rate_limit;
CREATE POLICY anon_rate_limit_service_only ON public.anon_rate_limit
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- #590 — retry-unidentified scope refactor.
--
--   * users.last_active_at: bumped on every authenticated request (or via the
--     touch_user_activity RPC). The retry-unidentified cron skips obs whose
--     observer was active < 7 days ago — their browser will retry client-side.
--   * observations.identification_status: 'pending' (default) | 'abandoned'.
--     Cron flips to 'abandoned' after 30 days without an ID so the obs can
--     be flagged for human review in /console/identifications/.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

CREATE INDEX IF NOT EXISTS users_last_active_at_idx
  ON public.users (last_active_at DESC NULLS LAST);

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS identification_status text
  CHECK (identification_status IN ('pending', 'abandoned'))
  DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.touch_user_activity()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  -- Debounce: only update if last_active_at is older than 5 minutes.
  -- Avoids hammering the row on a chatty session.
  UPDATE public.users
     SET last_active_at = now()
   WHERE id = auth.uid()
     AND (last_active_at IS NULL OR last_active_at < now() - interval '5 minutes');
END $$;

REVOKE ALL ON FUNCTION public.touch_user_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_activity() TO authenticated;

-- 2026-05-04: trigger db-apply to deploy upsert_primary_identification (#618)

-- ── 2026-05-07: Claude availability check for the client capability banner ──
-- The ObserveView2 banner used to gate `runners.claude` on `hasAnthropicKey()`
-- only — i.e. a BYO key in the browser. That hid the fact that an active
-- beneficiary sponsorship or any active platform pool with capacity also
-- unlocks Claude Vision (server-side resolution in the identify EF).
--
-- `sponsor_pools` RLS is owner-only, so the client can't introspect "is
-- there any pool I could draw from?" directly. This SECURITY DEFINER
-- function reports the two server-side eligibility flags + the caller's
-- pool consumption today, in one round-trip. Service-role-equivalent
-- privilege via the function — but it never returns row-level data, only
-- aggregate booleans + counts scoped to the caller.
CREATE OR REPLACE FUNCTION public.claude_eligibility()
RETURNS TABLE (
  has_sponsor    boolean,
  has_pool       boolean,
  pool_used_today integer,
  pool_cap_today  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, false, 0, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1
        FROM public.sponsorships s
        JOIN public.sponsor_credentials c ON c.id = s.credential_id
       WHERE s.beneficiary_id = v_uid
         AND s.status = 'active'
         AND c.revoked_at IS NULL
    ) AS has_sponsor,
    EXISTS (
      SELECT 1
        FROM public.sponsor_pools sp
        JOIN public.sponsor_credentials c ON c.id = sp.credential_id
       WHERE sp.status = 'active'
         AND sp.used   < sp.total_cap
         AND c.revoked_at IS NULL
    ) AS has_pool,
    COALESCE(
      (SELECT count FROM public.pool_consumption
        WHERE user_id = v_uid AND day = current_date),
      0
    ) AS pool_used_today,
    COALESCE(
      (SELECT MIN(daily_user_cap) FROM public.sponsor_pools
        WHERE status = 'active' AND used < total_cap),
      0
    ) AS pool_cap_today;
END $$;

REVOKE ALL ON FUNCTION public.claude_eligibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claude_eligibility() TO authenticated;

-- ── 2026-05-07: Per-pool daily usage aggregate for the donor dashboard ─────
-- pool_consumption is keyed by (user_id, day) — used for daily-cap enforcement
-- and for the consumer-facing "you used N/M today" indicator. It deliberately
-- has no pool_id because consume_pool_slot can hop between pools as one fills.
--
-- Donors need the orthogonal slice: "how is my own pool being used over time?"
-- This table captures it without leaking consumer identity (no user_id).
CREATE TABLE IF NOT EXISTS public.pool_usage_daily (
  pool_id uuid    NOT NULL REFERENCES public.sponsor_pools(id) ON DELETE CASCADE,
  day     date    NOT NULL,
  count   integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (pool_id, day)
);

CREATE INDEX IF NOT EXISTS idx_pool_usage_daily_pool ON public.pool_usage_daily(pool_id, day DESC);

ALTER TABLE public.pool_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pool_usage_daily_owner_read ON public.pool_usage_daily;
CREATE POLICY pool_usage_daily_owner_read ON public.pool_usage_daily
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sponsor_pools sp
       WHERE sp.id = pool_usage_daily.pool_id
         AND sp.sponsor_id = auth.uid()
    )
  );

GRANT SELECT                         ON public.pool_usage_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_usage_daily TO service_role;

-- Updated consume_pool_slot: now also bumps the per-pool daily aggregate.
-- Same return type as before — no DROP needed.
CREATE OR REPLACE FUNCTION public.consume_pool_slot(p_user_id uuid)
RETURNS TABLE (pool_id uuid, credential_id uuid, preferred_model text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today    date := current_date;
  v_used_today integer;
  v_pool_id  uuid;
  v_cred_id  uuid;
  v_model    text;
  v_cap      integer;
BEGIN
  SELECT sp.id, sp.credential_id, sp.preferred_model, sp.daily_user_cap
    INTO v_pool_id, v_cred_id, v_model, v_cap
    FROM public.sponsor_pools sp
   WHERE sp.status = 'active' AND sp.used < sp.total_cap
   ORDER BY sp.created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF v_pool_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(count, 0) INTO v_used_today
    FROM public.pool_consumption
   WHERE user_id = p_user_id AND day = v_today;
  IF v_used_today >= v_cap THEN
    RETURN;
  END IF;

  UPDATE public.sponsor_pools SET used = used + 1, updated_at = now()
   WHERE id = v_pool_id;

  INSERT INTO public.pool_consumption (user_id, day, count)
       VALUES (p_user_id, v_today, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = pool_consumption.count + 1;

  -- Per-pool daily aggregate for the donor dashboard.
  INSERT INTO public.pool_usage_daily (pool_id, day, count)
       VALUES (v_pool_id, v_today, 1)
  ON CONFLICT (pool_id, day) DO UPDATE SET count = pool_usage_daily.count + 1;

  UPDATE public.sponsor_pools SET status = 'exhausted'
   WHERE id = v_pool_id AND used >= total_cap AND status = 'active';

  RETURN QUERY SELECT v_pool_id, v_cred_id, v_model;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_pool_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_pool_slot(uuid) TO service_role;

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

-- M34 cron: refresh mv_platform_stats hourly. Idempotent — unschedule first.
SELECT cron.unschedule('refresh-platform-stats')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-platform-stats');
SELECT cron.schedule('refresh-platform-stats', '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_platform_stats$$);

-- ─────────────────────────────────────────────────────────────────────────
-- mv_taxon_obs_counts — per-species observation counts.
-- Lets /explore/species/ render the index without scanning the full
-- observations table client-side. Refreshed hourly via pg_cron.
-- Single-row-per-taxon MV; UNIQUE index on taxon_id lets us
-- REFRESH CONCURRENTLY.
-- ─────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_taxon_obs_counts AS
SELECT
  o.primary_taxon_id                      AS taxon_id,
  COUNT(*)::bigint                        AS obs_count,
  MAX(o.observed_at)                      AS last_observed_at
FROM public.observations o
WHERE o.sync_status = 'synced'
  AND o.primary_taxon_id IS NOT NULL
GROUP BY o.primary_taxon_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_taxon_obs_counts_unique
  ON public.mv_taxon_obs_counts (taxon_id);

GRANT SELECT ON public.mv_taxon_obs_counts TO anon, authenticated;

-- Refresh hourly (offset 5 minutes from mv_platform_stats so the two
-- aren't competing for write locks on the same minute). Idempotent —
-- unschedule first.
SELECT cron.unschedule('refresh-taxon-obs-counts')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-taxon-obs-counts');
SELECT cron.schedule('refresh-taxon-obs-counts', '5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_taxon_obs_counts$$);


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
  -- Resolve effective viewer: only the authenticated caller's own dex.
  -- The viewer_id parameter must match auth.uid(); otherwise return 0 rows.
  WITH effective AS (
    SELECT auth.uid() AS uid
     WHERE auth.uid() IS NOT NULL
       AND auth.uid() = viewer_id
  ),
  owned AS (
    SELECT taxon_id FROM public.profile_pokedex
     WHERE user_id = (SELECT uid FROM effective)
  ),
  user_top_kingdom AS (
    SELECT kingdom, COUNT(*) AS c
      FROM public.profile_pokedex
     WHERE user_id = (SELECT uid FROM effective) AND kingdom IS NOT NULL
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
  WHERE EXISTS (SELECT 1 FROM effective)
    AND t.id NOT IN (SELECT taxon_id FROM owned)
    AND t.kingdom = COALESCE((SELECT kingdom FROM user_top_kingdom), 'Animalia')
    AND COALESCE(tr.bucket, 1) <= 2
    AND EXISTS (
      SELECT 1 FROM public.taxa_thumbnails tt
       WHERE tt.taxon_id = t.id AND tt.thumbnail_url IS NOT NULL
    )
  ORDER BY md5(t.id::text || (SELECT uid FROM effective)::text || to_char(now(), 'YYYY-MM-DD'))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_pokedex_target(uuid) TO authenticated;

-- ── 2026-05-07: pool_daily_usage final body (overrides earlier stub) ──
-- Earlier in this file the function is declared with a placeholder body
-- so the schema replays top-to-bottom on a fresh DB (pool_usage_daily is
-- created in this same trailer block). This trailing CREATE OR REPLACE
-- supplies the real body — same function signature, idempotent.
CREATE OR REPLACE FUNCTION public.pool_daily_usage(p_pool_id uuid)
RETURNS TABLE(usage_date date, calls bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT pud.day AS usage_date, pud.count::bigint AS calls
    FROM public.pool_usage_daily pud
    JOIN public.sponsor_pools sp ON sp.id = pud.pool_id
   WHERE pud.pool_id = p_pool_id
     AND sp.sponsor_id = auth.uid()
     AND pud.day >= (current_date - interval '30 days')::date
   ORDER BY pud.day;
$$;

-- ============================================================
-- M32 / #468: Pool management — soft-delete + per-pool per-user usage
-- ============================================================
-- Soft-delete column on sponsor_pools. Hard-delete would orphan pool_usage_daily
-- and pool_user_usage rows (FK ON DELETE CASCADE), losing the ledger that
-- beneficiaries and donors both rely on. Soft-delete preserves history while
-- excluding the pool from `consume_pool_slot()` and donor-side reads.
ALTER TABLE public.sponsor_pools
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sponsor_pools_not_deleted
  ON public.sponsor_pools (sponsor_id) WHERE deleted_at IS NULL;

-- Extend the existing read policy to filter soft-deleted rows.
DROP POLICY IF EXISTS sponsor_pools_owner_read ON public.sponsor_pools;
CREATE POLICY sponsor_pools_owner_read ON public.sponsor_pools
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid() AND deleted_at IS NULL);

-- Per-pool per-user usage ledger. pool_consumption is keyed by (user_id, day)
-- and has no pool_id (the daily-cap check spans pools); pool_usage_daily is
-- keyed by (pool_id, day) and has no user_id (privacy-aggregate). Neither
-- supports the "who has consumed from THIS pool" query the donor management
-- UI needs. New table fills the gap with a 30-day rolling retention.
CREATE TABLE IF NOT EXISTS public.pool_user_usage (
  pool_id  uuid    NOT NULL REFERENCES public.sponsor_pools(id) ON DELETE CASCADE,
  user_id  uuid    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day      date    NOT NULL,
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (pool_id, user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_pool_user_usage_pool_day
  ON public.pool_user_usage (pool_id, day DESC);

ALTER TABLE public.pool_user_usage ENABLE ROW LEVEL SECURITY;

-- Donor (pool sponsor) reads. Service role bypasses RLS for the EF write path.
DROP POLICY IF EXISTS pool_user_usage_owner_read ON public.pool_user_usage;
CREATE POLICY pool_user_usage_owner_read ON public.pool_user_usage
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sponsor_pools sp
       WHERE sp.id = pool_user_usage.pool_id
         AND sp.sponsor_id = auth.uid()
    )
  );

GRANT SELECT                         ON public.pool_user_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_user_usage TO service_role;

-- Updated consume_pool_slot: also bumps pool_user_usage and ignores
-- soft-deleted pools. Same return type — no DROP needed.
CREATE OR REPLACE FUNCTION public.consume_pool_slot(p_user_id uuid)
RETURNS TABLE (pool_id uuid, credential_id uuid, preferred_model text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today    date := current_date;
  v_used_today integer;
  v_pool_id  uuid;
  v_cred_id  uuid;
  v_model    text;
  v_cap      integer;
BEGIN
  SELECT sp.id, sp.credential_id, sp.preferred_model, sp.daily_user_cap
    INTO v_pool_id, v_cred_id, v_model, v_cap
    FROM public.sponsor_pools sp
   WHERE sp.status = 'active'
     AND sp.used < sp.total_cap
     AND sp.deleted_at IS NULL
   ORDER BY sp.created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF v_pool_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(count, 0) INTO v_used_today
    FROM public.pool_consumption
   WHERE user_id = p_user_id AND day = v_today;
  IF v_used_today >= v_cap THEN
    RETURN;
  END IF;

  UPDATE public.sponsor_pools SET used = used + 1, updated_at = now()
   WHERE id = v_pool_id;

  INSERT INTO public.pool_consumption (user_id, day, count)
       VALUES (p_user_id, v_today, 1)
  ON CONFLICT (user_id, day) DO UPDATE SET count = pool_consumption.count + 1;

  INSERT INTO public.pool_usage_daily (pool_id, day, count)
       VALUES (v_pool_id, v_today, 1)
  ON CONFLICT (pool_id, day) DO UPDATE SET count = pool_usage_daily.count + 1;

  INSERT INTO public.pool_user_usage (pool_id, user_id, day, count)
       VALUES (v_pool_id, p_user_id, v_today, 1)
  ON CONFLICT (pool_id, user_id, day) DO UPDATE SET count = pool_user_usage.count + 1;

  UPDATE public.sponsor_pools SET status = 'exhausted'
   WHERE id = v_pool_id AND used >= total_cap AND status = 'active';

  RETURN QUERY SELECT v_pool_id, v_cred_id, v_model;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_pool_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_pool_slot(uuid) TO service_role;

-- pool_beneficiaries(p_pool_id, p_since): aggregated per-user consumption
-- from this pool over the past N days. Used by the donor-side beneficiary
-- list in /sponsorships/pools/:id/beneficiaries. SECURITY DEFINER + the
-- explicit sponsor_id = auth.uid() check is the privacy gate; the function
-- doesn't expose any consumer info to non-owners.
CREATE OR REPLACE FUNCTION public.pool_beneficiaries(
  p_pool_id uuid,
  p_since   date DEFAULT (current_date - interval '30 days')::date
) RETURNS TABLE (
  user_id      uuid,
  username     text,
  display_name text,
  total_calls  bigint,
  last_seen    date
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH owner_check AS (
    SELECT 1
      FROM public.sponsor_pools sp
     WHERE sp.id = p_pool_id
       AND sp.sponsor_id = auth.uid()
  )
  SELECT
    puu.user_id,
    u.username,
    u.display_name,
    SUM(puu.count)::bigint AS total_calls,
    MAX(puu.day)           AS last_seen
  FROM public.pool_user_usage puu
  JOIN public.users u ON u.id = puu.user_id
  WHERE EXISTS (SELECT 1 FROM owner_check)
    AND puu.pool_id = p_pool_id
    AND puu.day >= p_since
  GROUP BY puu.user_id, u.username, u.display_name
  ORDER BY total_calls DESC, last_seen DESC;
$$;

REVOKE ALL ON FUNCTION public.pool_beneficiaries(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pool_beneficiaries(uuid, date) TO authenticated;

-- Re-create claude_eligibility so that soft-deleted pools no longer
-- contribute to has_pool / pool_cap_today. Same signature, same return
-- type — the body is the only change.
CREATE OR REPLACE FUNCTION public.claude_eligibility()
RETURNS TABLE (
  has_sponsor    boolean,
  has_pool       boolean,
  pool_used_today integer,
  pool_cap_today  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, false, 0, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1
        FROM public.sponsorships s
        JOIN public.sponsor_credentials c ON c.id = s.credential_id
       WHERE s.beneficiary_id = v_uid
         AND s.status = 'active'
         AND c.revoked_at IS NULL
    ) AS has_sponsor,
    EXISTS (
      SELECT 1
        FROM public.sponsor_pools sp
        JOIN public.sponsor_credentials c ON c.id = sp.credential_id
       WHERE sp.status = 'active'
         AND sp.used   < sp.total_cap
         AND sp.deleted_at IS NULL
         AND c.revoked_at IS NULL
    ) AS has_pool,
    COALESCE(
      (SELECT count FROM public.pool_consumption
        WHERE user_id = v_uid AND day = current_date),
      0
    ) AS pool_used_today,
    COALESCE(
      (SELECT MIN(daily_user_cap) FROM public.sponsor_pools
        WHERE status = 'active' AND used < total_cap AND deleted_at IS NULL),
      0
    ) AS pool_cap_today;
END;
$$;

REVOKE ALL ON FUNCTION public.claude_eligibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claude_eligibility() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- karma_milestones — celebratory thresholds (issue #557)
-- ═══════════════════════════════════════════════════════════════════════════
-- Admin-tunable thresholds that fire a celebratory toast when crossed.
-- Read by src/lib/karma-toast.ts on every realtime karma INSERT to decide
-- whether the new total just crossed any threshold.
CREATE TABLE IF NOT EXISTS public.karma_milestones (
  threshold  numeric PRIMARY KEY,
  label_en   text NOT NULL,
  label_es   text NOT NULL,
  icon       text NOT NULL DEFAULT '🏆',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.karma_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karma_milestones_public_read ON public.karma_milestones;
CREATE POLICY karma_milestones_public_read ON public.karma_milestones
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.karma_milestones TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.karma_milestones TO service_role;

INSERT INTO public.karma_milestones (threshold, label_en, label_es, icon) VALUES
  (100,  'First 100 karma',                     'Primer 100 de karma',                          '✨'),
  (500,  '500 karma observer',                  'Observador con 500 de karma',                  '🌱'),
  (1000, '1,000 karma — research-grade ally',   '1.000 de karma — aliado de grado de investigación', '🌳'),
  (5000, '5,000 karma — power observer',        '5.000 de karma — observador experto',          '🌟')
ON CONFLICT (threshold) DO UPDATE SET
  label_en = EXCLUDED.label_en,
  label_es = EXCLUDED.label_es,
  icon     = EXCLUDED.icon;
-- M28 — Active observers today (issue #743)
--
-- Returns the number of distinct observers in the given country who
-- have at least one synced observation since the start of the current
-- UTC day. Drives the "Hoy N personas observan en <region>" micro-banner
-- on /observe. Anon callers can read it (the count is non-PII), but the
-- function is SECURITY INVOKER so RLS on `observations` (public-read)
-- and `users` (hide_from_leaderboards = false) still applies. The
-- caller passes an ISO-3166 alpha-2 country code; NULL collapses to
-- a global count.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.community_active_observers_today(
  p_country text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COUNT(DISTINCT o.observer_id)::int
    FROM public.observations o
    JOIN public.users u ON u.id = o.observer_id
   WHERE o.sync_status = 'synced'
     AND o.observed_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
     AND u.hide_from_leaderboards = false
     AND (p_country IS NULL OR u.country_code = p_country);
$$;

REVOKE ALL ON FUNCTION public.community_active_observers_today(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_active_observers_today(text) TO anon, authenticated;
-- M08 — Falta-dex / taxonomic gaps (issue #726, supersedes #561 phase-1)
--
-- Returns the union of (a) species the user has ALREADY observed —
-- mirroring `profile_pokedex` columns — and (b) species *missing* from
-- their dex but observed in their region by other Rastrum users at
-- research grade. Missing rows are ordered by rarity bucket DESC then
-- regional obs_count ASC (rarest + scarcest first), so the gamification
-- rewards effort proportional to challenge.
--
-- Baseline source (Option A — own observation data as proxy):
--   The "expected pool" for a country is the set of taxa with at least
--   one synced, research-grade, public observation made by an observer
--   whose `country_code` matches. This avoids a GBIF ETL for v1 and is
--   honest about its limits — the i18n copy says so. Option B (curated
--   GBIF baseline per state/ecoregion) remains the v1.1 follow-up.
--
-- Region resolution: defaults to `users.country_code` of the target
-- user. If still NULL, the function returns only present rows (no
-- region pool to draw missing slots from).
--
-- The viewer is gated by `can_see_facet(target, 'pokedex', viewer)` —
-- same predicate as `profile_pokedex`. Public/private profile rules
-- propagate naturally because the missing-pool excludes hidden
-- observers' contributions only if they hide their *observations*; the
-- pool is derived from public observation rows already.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.profile_pokedex_with_missing(
  p_user_id         uuid,
  p_region_country  text DEFAULT NULL,
  p_missing_limit   int  DEFAULT 60
)
RETURNS TABLE (
  user_id           uuid,
  taxon_id          uuid,
  scientific_name   text,
  kingdom           text,
  rarity_bucket     smallint,
  first_observed_at timestamptz,
  obs_count         int,
  common_name_es    text,
  common_name_en    text,
  slug              text,
  endemic_mx        boolean,
  nom059_status     text,
  thumbnail_url     text,
  is_missing        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country text;
  v_can_see boolean;
BEGIN
  -- Facet gate — anonymous callers and viewers blocked by privacy
  -- settings get the same answer as profile_pokedex would: zero rows.
  SELECT public.can_see_facet(p_user_id, 'pokedex', auth.uid())
    INTO v_can_see;
  IF v_can_see IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Resolve region: explicit param wins, else derive from the target
  -- user's stored country_code. Two-letter ISO check mirrors the
  -- column constraint on users.country_code.
  v_country := COALESCE(
    NULLIF(upper(p_region_country), ''),
    (SELECT u.country_code FROM public.users u WHERE u.id = p_user_id)
  );

  -- Cap missing-limit defensively — the UI grid is bounded.
  IF p_missing_limit IS NULL OR p_missing_limit <= 0 THEN
    p_missing_limit := 60;
  ELSIF p_missing_limit > 200 THEN
    p_missing_limit := 200;
  END IF;

  RETURN QUERY
  -- Present rows — pulled directly from the existing view so this
  -- function stays in lock-step with the dex shape.
  SELECT
    pp.user_id,
    pp.taxon_id,
    pp.scientific_name,
    pp.kingdom,
    pp.rarity_bucket,
    pp.first_observed_at,
    pp.obs_count,
    pp.common_name_es,
    pp.common_name_en,
    pp.slug,
    pp.endemic_mx,
    pp.nom059_status,
    pp.thumbnail_url,
    false AS is_missing
  FROM public.profile_pokedex pp
  WHERE pp.user_id = p_user_id

  UNION ALL

  -- Missing rows — region-pool species the user has not observed.
  -- Region pool: synced research-grade public observations with
  -- a taxon, observed by users whose country_code matches v_country.
  -- Excludes private observations and rows already in the dex.
  -- Wrapped in a subquery so ORDER BY + LIMIT scope to the missing
  -- branch only, not the UNION result.
  SELECT * FROM (
    SELECT
      p_user_id                AS user_id,
      t.id                     AS taxon_id,
      t.scientific_name,
      t.kingdom,
      tr.bucket                AS rarity_bucket,
      NULL::timestamptz        AS first_observed_at,
      region_pool.regional_obs_count::int AS obs_count,
      t.common_name_es,
      t.common_name_en,
      t.slug,
      t.is_endemic_mexico      AS endemic_mx,
      t.nom059_status,
      (SELECT tt.thumbnail_url
         FROM public.taxa_thumbnails tt
        WHERE tt.taxon_id = t.id) AS thumbnail_url,
      true                     AS is_missing
    FROM (
      SELECT i.taxon_id, COUNT(*)::bigint AS regional_obs_count
        FROM public.observations o
        JOIN public.identifications i
          ON i.observation_id = o.id AND i.is_primary = true
        JOIN public.users u
          ON u.id = o.observer_id
       WHERE v_country IS NOT NULL
         AND u.country_code = v_country
         AND o.sync_status = 'synced'
         AND o.obscure_level <> 'private'
         AND i.is_research_grade = true
         AND i.taxon_id IS NOT NULL
       GROUP BY i.taxon_id
    ) AS region_pool
    JOIN public.taxa t ON t.id = region_pool.taxon_id
    LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = t.id
    WHERE v_country IS NOT NULL
      AND t.taxon_rank = 'species'
      AND NOT EXISTS (
        SELECT 1 FROM public.profile_pokedex pp
         WHERE pp.user_id = p_user_id
           AND pp.taxon_id = t.id
      )
    ORDER BY tr.bucket DESC NULLS LAST,
             region_pool.regional_obs_count ASC
    LIMIT p_missing_limit
  ) AS missing;
END;
$$;

REVOKE ALL ON FUNCTION public.profile_pokedex_with_missing(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_pokedex_with_missing(uuid, text, int)
  TO anon, authenticated;

-- Companion helper — region pool size (denominator for "X of Y species
-- in your region"). Cached behaviour is fine: STABLE in a single txn.
-- Anonymous-friendly: the count itself is non-PII.
CREATE OR REPLACE FUNCTION public.region_species_pool_size(
  p_region_country text
)
RETURNS integer
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COUNT(DISTINCT i.taxon_id)::int
    FROM public.observations o
    JOIN public.identifications i
      ON i.observation_id = o.id AND i.is_primary = true
    JOIN public.users u
      ON u.id = o.observer_id
   WHERE p_region_country IS NOT NULL
     AND u.country_code = upper(p_region_country)
     AND o.sync_status = 'synced'
     AND o.obscure_level <> 'private'
     AND i.is_research_grade = true
     AND i.taxon_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.region_species_pool_size(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.region_species_pool_size(text)
  TO anon, authenticated;

-- =====================================================================
-- M01 contextual species suggestions (issue #723)
--
-- "What is likely here right now?" — given a lat/lng + month, returns
-- the top-N taxa observed within ~50 km whose primary identifications
-- fall in the same month-window (±1 month, wrapping). Mirrors the
-- falta-dex Option A approach: Rastrum's own observations as proxy
-- for a baseline. v1.1 follow-up can swap in a curated GBIF baseline.
--
-- Privacy: SECURITY INVOKER — RLS on `observations` + `identifications`
-- gates rows. Anonymous callers see public observations only; authed
-- callers additionally see their own private rows (which is fine for a
-- "probable here" suggestion list).
--
-- The `has_observed_by_viewer` column is auth.uid()-aware: NULL for
-- anonymous callers, true/false for authenticated callers based on
-- whether they themselves have a primary ID for that taxon.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.probable_taxa_at(
  p_lat   numeric,
  p_lng   numeric,
  p_month int,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  taxon_id               uuid,
  scientific_name        text,
  common_name_es         text,
  common_name_en         text,
  slug                   text,
  thumbnail_url          text,
  n_obs                  int,
  last_seen_distance_km  numeric,
  has_observed_by_viewer boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_point   geography;
  v_viewer  uuid;
  v_months  int[];
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_month IS NULL THEN
    RETURN;
  END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RETURN;
  END IF;
  IF p_month < 1 OR p_month > 12 THEN
    RETURN;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 10;
  ELSIF p_limit > 50 THEN
    p_limit := 50;
  END IF;

  v_point  := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_viewer := auth.uid();

  -- Wrap month window (±1) at year boundaries: month 1 → {12,1,2}.
  v_months := ARRAY[
    ((p_month - 2 + 12) % 12) + 1,
    p_month,
    (p_month % 12) + 1
  ]::int[];

  RETURN QUERY
  WITH nearby AS (
    SELECT
      i.taxon_id,
      ST_Distance(o.location, v_point) AS distance_m,
      o.observer_id
    FROM public.observations o
    JOIN public.identifications i
      ON i.observation_id = o.id AND i.is_primary = true
    WHERE o.location IS NOT NULL
      AND i.taxon_id IS NOT NULL
      AND ST_DWithin(o.location, v_point, 50000)
      AND EXTRACT(MONTH FROM o.observed_at AT TIME ZONE 'UTC')::int = ANY(v_months)
      AND (i.is_research_grade = true OR o.primary_taxon_id IS NOT NULL)
  ),
  ranked AS (
    SELECT
      n.taxon_id,
      COUNT(*)::int                  AS n_obs,
      MIN(n.distance_m) / 1000.0     AS last_seen_distance_km,
      bool_or(n.observer_id = v_viewer) AS observed_by_viewer
    FROM nearby n
    GROUP BY n.taxon_id
    ORDER BY COUNT(*) DESC, MIN(n.distance_m) ASC
    LIMIT p_limit
  )
  SELECT
    t.id                        AS taxon_id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.slug,
    th.thumbnail_url,
    r.n_obs,
    ROUND(r.last_seen_distance_km::numeric, 1) AS last_seen_distance_km,
    CASE WHEN v_viewer IS NULL THEN NULL ELSE COALESCE(r.observed_by_viewer, false) END
                                AS has_observed_by_viewer
  FROM ranked r
  JOIN public.taxa t   ON t.id = r.taxon_id
  LEFT JOIN public.taxa_thumbnails th ON th.taxon_id = t.id
  WHERE t.taxon_rank = 'species'
  ORDER BY r.n_obs DESC, r.last_seen_distance_km ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.probable_taxa_at(numeric, numeric, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.probable_taxa_at(numeric, numeric, int, int)
  TO anon, authenticated;
-- ============================================================
-- M08 — "tú vs. observador MX promedio" percentile cards (#744)
-- ============================================================
-- Normative comparison (Fogg ch. 8) replacing toxic raw rank framing.
-- Four diversity-rich metrics per user, percentile-only, computed against
-- the cohort of users with >= 5 observations in the last 90 days.
--
-- Privacy / framing invariants:
--  * NEVER raw rank — only PERCENT_RANK percentile.
--  * No "people above you" copy — UI shows percentile bar + cohort N.
--  * If cohort_n < 50, the UI surfaces "datos insuficientes" instead of
--    a noisy norm. The MV still ships a row per user when computed so
--    the client can read both fields atomically.
--  * `cohort_country` is reserved for v1.1 sub-cohorts; v1 fixes it to
--    'MX' to mirror the platform's primary country focus and keep the
--    initial cohort tractable.
--
-- Metrics:
--   1. diversity_pctl  — Shannon H' over a user's observed taxa (primary IDs)
--   2. habitats_pctl   — DISTINCT count of observations.habitat
--   3. validations_pctl — count of identifications.validated_by = user
--   4. spread_pctl     — km^2 of ST_ConvexHull over user's observation points
--
-- The materialized view is refreshed nightly in the same RPC the
-- `recompute-user-stats` cron already calls (recompute_user_stats wraps
-- both the user-stats UPDATE and the MV REFRESH in one transactional
-- shot — see further down).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_metrics_percentile AS
WITH cohort AS (
  SELECT u.id AS user_id, COALESCE(u.country_code, 'MX') AS cohort_country
    FROM public.users u
   WHERE EXISTS (
     SELECT 1 FROM public.observations o
      WHERE o.observer_id = u.id
        AND o.sync_status = 'synced'
        AND o.observed_at >= now() - interval '90 days'
      GROUP BY o.observer_id
      HAVING COUNT(*) >= 5
   )
),
diversity AS (
  SELECT c.user_id,
         -- Shannon H' = -SUM(p_i * ln(p_i)) over taxa shares.
         COALESCE(-SUM((cnt::numeric / total::numeric) * LN(cnt::numeric / total::numeric)), 0)::numeric AS h_prime
    FROM cohort c
    JOIN LATERAL (
      SELECT i.taxon_id, COUNT(*)::numeric AS cnt,
             SUM(COUNT(*)) OVER ()::numeric AS total
        FROM public.observations o
        JOIN public.identifications i
          ON i.observation_id = o.id AND i.is_primary = true
       WHERE o.observer_id  = c.user_id
         AND o.sync_status  = 'synced'
         AND i.taxon_id IS NOT NULL
       GROUP BY i.taxon_id
    ) tx ON true
   GROUP BY c.user_id
),
habitats AS (
  SELECT c.user_id,
         COUNT(DISTINCT o.habitat)::int AS habitat_count
    FROM cohort c
    LEFT JOIN public.observations o
      ON o.observer_id = c.user_id
     AND o.sync_status = 'synced'
     AND o.habitat IS NOT NULL
     AND o.habitat <> ''
   GROUP BY c.user_id
),
validations AS (
  SELECT c.user_id,
         COUNT(*)::int AS validation_count
    FROM cohort c
    LEFT JOIN public.identifications i
      ON i.validated_by = c.user_id
   GROUP BY c.user_id
),
spread AS (
  SELECT c.user_id,
         COALESCE(
           ST_Area(
             ST_ConvexHull(ST_Collect(o.location::geometry))::geography
           ) / 1e6,
           0
         )::numeric AS spread_km2
    FROM cohort c
    LEFT JOIN public.observations o
      ON o.observer_id = c.user_id
     AND o.sync_status = 'synced'
     AND o.location IS NOT NULL
   GROUP BY c.user_id
),
joined AS (
  SELECT c.user_id,
         c.cohort_country,
         COALESCE(d.h_prime, 0)         AS diversity_metric,
         COALESCE(h.habitat_count, 0)   AS habitats_metric,
         COALESCE(v.validation_count, 0) AS validations_metric,
         COALESCE(s.spread_km2, 0)      AS spread_metric
    FROM cohort c
    LEFT JOIN diversity   d ON d.user_id = c.user_id
    LEFT JOIN habitats    h ON h.user_id = c.user_id
    LEFT JOIN validations v ON v.user_id = c.user_id
    LEFT JOIN spread      s ON s.user_id = c.user_id
),
ranked AS (
  SELECT j.user_id,
         j.cohort_country,
         j.diversity_metric,
         j.habitats_metric,
         j.validations_metric,
         j.spread_metric,
         (PERCENT_RANK() OVER (ORDER BY j.diversity_metric)   * 100)::numeric AS diversity_pctl,
         (PERCENT_RANK() OVER (ORDER BY j.habitats_metric)    * 100)::numeric AS habitats_pctl,
         (PERCENT_RANK() OVER (ORDER BY j.validations_metric) * 100)::numeric AS validations_pctl,
         (PERCENT_RANK() OVER (ORDER BY j.spread_metric)      * 100)::numeric AS spread_pctl,
         COUNT(*) OVER ()::int AS cohort_n
    FROM joined j
)
SELECT user_id,
       cohort_country,
       diversity_metric,
       habitats_metric,
       validations_metric,
       spread_metric,
       diversity_pctl,
       habitats_pctl,
       validations_pctl,
       spread_pctl,
       cohort_n,
       now()::timestamptz AS computed_at
  FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS user_metrics_percentile_pkey
  ON public.user_metrics_percentile (user_id);

REVOKE ALL    ON public.user_metrics_percentile FROM PUBLIC;
REVOKE ALL    ON public.user_metrics_percentile FROM anon;
REVOKE ALL    ON public.user_metrics_percentile FROM authenticated;
GRANT  SELECT ON public.user_metrics_percentile TO service_role;

-- SECURITY INVOKER RPC — returns ONLY auth.uid()'s row, projected as
-- jsonb. Each user reads their own percentiles + cohort_n; the raw
-- per-user metric values are kept off the public surface to reduce
-- triangulation risk. cohort_n < 50 → UI shows "datos insuficientes"
-- (the threshold is enforced in the client, not the RPC, so the
-- function stays a pure projection and is easy to inspect).
CREATE OR REPLACE FUNCTION public.get_my_percentiles()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
PARALLEL SAFE
SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL::jsonb
    ELSE (
      SELECT jsonb_build_object(
        'user_id',           p.user_id,
        'cohort_country',    p.cohort_country,
        'cohort_n',          p.cohort_n,
        'computed_at',       p.computed_at,
        'diversity_pctl',    ROUND(p.diversity_pctl)::int,
        'habitats_pctl',     ROUND(p.habitats_pctl)::int,
        'validations_pctl',  ROUND(p.validations_pctl)::int,
        'spread_pctl',       ROUND(p.spread_pctl)::int,
        'diversity_value',   ROUND(p.diversity_metric::numeric,    2),
        'habitats_value',    p.habitats_metric,
        'validations_value', p.validations_metric,
        'spread_value',      ROUND(p.spread_metric::numeric,        1)
      )
      FROM public.user_metrics_percentile p
      WHERE p.user_id = auth.uid()
    )
  END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_percentiles() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_percentiles() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #805 — State-level sub-cohorts for percentile cards
-- Adds a state-scoped MV (user_metrics_percentile_state) that partitions by
-- region_primary, and a scoped get_my_percentiles(p_scope) RPC override.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_metrics_percentile_state AS
WITH cohort AS (
  SELECT u.id AS user_id,
         COALESCE(u.country_code, 'MX') AS cohort_country,
         u.region_primary                AS cohort_state
    FROM public.users u
   WHERE u.region_primary IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.observations o
        WHERE o.observer_id = u.id
          AND o.sync_status = 'synced'
          AND o.observed_at >= now() - interval '90 days'
        GROUP BY o.observer_id
       HAVING COUNT(*) >= 5
     )
),
diversity AS (
  SELECT c.user_id,
         COALESCE(-SUM((cnt::numeric / total::numeric) * LN(cnt::numeric / total::numeric)), 0)::numeric AS h_prime
    FROM cohort c
    JOIN LATERAL (
      SELECT i.taxon_id, COUNT(*)::numeric AS cnt,
             SUM(COUNT(*)) OVER ()::numeric AS total
        FROM public.observations o
        JOIN public.identifications i
          ON i.observation_id = o.id AND i.is_primary = true
       WHERE o.observer_id  = c.user_id
         AND o.sync_status  = 'synced'
         AND i.taxon_id IS NOT NULL
       GROUP BY i.taxon_id
    ) tx ON true
   GROUP BY c.user_id
),
habitats AS (
  SELECT c.user_id,
         COUNT(DISTINCT o.habitat)::int AS habitat_count
    FROM cohort c
    LEFT JOIN public.observations o
      ON o.observer_id = c.user_id
     AND o.sync_status = 'synced'
     AND o.habitat IS NOT NULL
     AND o.habitat <> ''
   GROUP BY c.user_id
),
validations AS (
  SELECT c.user_id,
         COUNT(*)::int AS validation_count
    FROM cohort c
    LEFT JOIN public.identifications i
      ON i.validated_by = c.user_id
   GROUP BY c.user_id
),
spread AS (
  SELECT c.user_id,
         COALESCE(
           ST_Area(
             ST_ConvexHull(ST_Collect(o.location::geometry))::geography
           ) / 1e6,
           0
         )::numeric AS spread_km2
    FROM cohort c
    LEFT JOIN public.observations o
      ON o.observer_id = c.user_id
     AND o.sync_status = 'synced'
     AND o.location IS NOT NULL
   GROUP BY c.user_id
),
joined AS (
  SELECT c.user_id,
         c.cohort_country,
         c.cohort_state,
         COALESCE(d.h_prime, 0)          AS diversity_metric,
         COALESCE(h.habitat_count, 0)    AS habitats_metric,
         COALESCE(v.validation_count, 0)  AS validations_metric,
         COALESCE(s.spread_km2, 0)        AS spread_metric
    FROM cohort c
    LEFT JOIN diversity   d ON d.user_id = c.user_id
    LEFT JOIN habitats    h ON h.user_id = c.user_id
    LEFT JOIN validations v ON v.user_id = c.user_id
    LEFT JOIN spread      s ON s.user_id = c.user_id
),
ranked AS (
  SELECT j.user_id,
         j.cohort_country,
         j.cohort_state,
         j.diversity_metric,
         j.habitats_metric,
         j.validations_metric,
         j.spread_metric,
         (PERCENT_RANK() OVER (PARTITION BY j.cohort_country, j.cohort_state ORDER BY j.diversity_metric)   * 100)::numeric AS diversity_pctl,
         (PERCENT_RANK() OVER (PARTITION BY j.cohort_country, j.cohort_state ORDER BY j.habitats_metric)    * 100)::numeric AS habitats_pctl,
         (PERCENT_RANK() OVER (PARTITION BY j.cohort_country, j.cohort_state ORDER BY j.validations_metric) * 100)::numeric AS validations_pctl,
         (PERCENT_RANK() OVER (PARTITION BY j.cohort_country, j.cohort_state ORDER BY j.spread_metric)      * 100)::numeric AS spread_pctl,
         COUNT(*) OVER (PARTITION BY j.cohort_country, j.cohort_state)::int AS cohort_n
    FROM joined j
)
SELECT user_id,
       cohort_country,
       cohort_state,
       diversity_metric,
       habitats_metric,
       validations_metric,
       spread_metric,
       diversity_pctl,
       habitats_pctl,
       validations_pctl,
       spread_pctl,
       cohort_n,
       now()::timestamptz AS computed_at
  FROM ranked;

CREATE UNIQUE INDEX IF NOT EXISTS user_metrics_percentile_state_pkey
  ON public.user_metrics_percentile_state (user_id);

REVOKE ALL    ON public.user_metrics_percentile_state FROM PUBLIC;
REVOKE ALL    ON public.user_metrics_percentile_state FROM anon;
REVOKE ALL    ON public.user_metrics_percentile_state FROM authenticated;
GRANT  SELECT ON public.user_metrics_percentile_state TO service_role;

-- Scoped RPC: get_my_percentiles(p_scope) — overloaded variant that accepts
-- 'country' (default — reads the existing MV) or 'state' (reads the new
-- state MV). The original zero-arg form is preserved for backwards compat.
CREATE OR REPLACE FUNCTION public.get_my_percentiles(p_scope text DEFAULT 'country')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
PARALLEL SAFE
SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL::jsonb
    WHEN p_scope = 'state' THEN (
      SELECT jsonb_build_object(
        'user_id',           s.user_id,
        'scope',             'state',
        'cohort_country',    s.cohort_country,
        'cohort_state',      s.cohort_state,
        'cohort_n',          s.cohort_n,
        'computed_at',       s.computed_at,
        'diversity_pctl',    ROUND(s.diversity_pctl)::int,
        'habitats_pctl',     ROUND(s.habitats_pctl)::int,
        'validations_pctl',  ROUND(s.validations_pctl)::int,
        'spread_pctl',       ROUND(s.spread_pctl)::int,
        'diversity_value',   ROUND(s.diversity_metric::numeric,    2),
        'habitats_value',    s.habitats_metric,
        'validations_value', s.validations_metric,
        'spread_value',      ROUND(s.spread_metric::numeric,        1)
      )
      FROM public.user_metrics_percentile_state s
      WHERE s.user_id = auth.uid()
    )
    ELSE (
      SELECT jsonb_build_object(
        'user_id',           p.user_id,
        'scope',             'country',
        'cohort_country',    p.cohort_country,
        'cohort_state',      null,
        'cohort_n',          p.cohort_n,
        'computed_at',       p.computed_at,
        'diversity_pctl',    ROUND(p.diversity_pctl)::int,
        'habitats_pctl',     ROUND(p.habitats_pctl)::int,
        'validations_pctl',  ROUND(p.validations_pctl)::int,
        'spread_pctl',       ROUND(p.spread_pctl)::int,
        'diversity_value',   ROUND(p.diversity_metric::numeric,    2),
        'habitats_value',    p.habitats_metric,
        'validations_value', p.validations_metric,
        'spread_value',      ROUND(p.spread_metric::numeric,        1)
      )
      FROM public.user_metrics_percentile p
      WHERE p.user_id = auth.uid()
    )
  END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_percentiles(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_percentiles(text) TO authenticated;
-- calls. SECURITY DEFINER + service_role-only matches recompute_user_stats.
-- Kept separate so it can be invoked manually for testing without
-- re-running the full user-stats UPDATE.
CREATE OR REPLACE FUNCTION public.recompute_user_metrics_percentile()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_metrics_percentile;
  -- Also refresh the state-level sub-cohort MV (#805).
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_metrics_percentile_state;
  EXCEPTION WHEN OTHERS THEN
    REFRESH MATERIALIZED VIEW public.user_metrics_percentile_state;
  END;
  SELECT COUNT(*) INTO v_count FROM public.user_metrics_percentile;
  RETURN v_count;
EXCEPTION
  WHEN OTHERS THEN
    -- First-ever refresh can't be CONCURRENTLY (needs a populated MV);
    -- fall back to a non-concurrent refresh and continue.
    REFRESH MATERIALIZED VIEW public.user_metrics_percentile;
    BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_metrics_percentile_state;
    EXCEPTION WHEN OTHERS THEN
      REFRESH MATERIALIZED VIEW public.user_metrics_percentile_state;
    END;
    SELECT COUNT(*) INTO v_count FROM public.user_metrics_percentile;
    RETURN v_count;
END;
$$;

REVOKE ALL    ON FUNCTION public.recompute_user_metrics_percentile() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_user_metrics_percentile() TO service_role;

-- Wire the percentile MV refresh into the existing recompute_user_stats()
-- cron entry-point. CREATE OR REPLACE preserves the function signature
-- so the Edge Function does not need to change — the body now also
-- refreshes the MV after the user-stats UPDATE has settled. Failures
-- in the MV refresh do not abort the user-stats update (best-effort).
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

  -- Best-effort MV refresh; never fail the cron over it.
  BEGIN
    PERFORM public.recompute_user_metrics_percentile();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_user_metrics_percentile failed: %', SQLERRM;
  END;

  -- Recompute taxa rarity tiers (uses observation counts already refreshed above)
  PERFORM public.recompute_taxa_rarity();

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_user_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_user_stats() TO service_role;
-- ─────────────────────────────────────────────────────────────────────
-- Kairos contextual prompts (#724)
-- One row per (user, kind). v1 ships only `golden_hour`. The
-- `kairos-fire` Edge Function reads opted-in subscribers every 15 min
-- and sends a payload-less Web Push when sunset is 15-30 min away.
-- `last_sent_at` enforces the "max one push/user/day" hard cap.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kairos_subscriptions (
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('golden_hour')),
  opt_in       boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_kairos_subs_kind_optin
  ON public.kairos_subscriptions(kind, opt_in) WHERE opt_in = true;

ALTER TABLE public.kairos_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kairos_subs_select_own" ON public.kairos_subscriptions;
CREATE POLICY "kairos_subs_select_own" ON public.kairos_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "kairos_subs_insert_own" ON public.kairos_subscriptions;
CREATE POLICY "kairos_subs_insert_own" ON public.kairos_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "kairos_subs_update_own" ON public.kairos_subscriptions;
CREATE POLICY "kairos_subs_update_own" ON public.kairos_subscriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "kairos_subs_delete_own" ON public.kairos_subscriptions;
CREATE POLICY "kairos_subs_delete_own" ON public.kairos_subscriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kairos_subscriptions TO authenticated;
-- ---------------------------------------------------------------------------
-- M-Surprises — Sorpresas de campo (transparent, opt-in variable rewards)
-- Closes #727. Catalog is FIXED in the client (src/lib/surprises.ts):
-- 'dato_curioso' (10 % random), 'rarito' (deterministic on rare bucket),
-- 'comunidad_activa_hoy' (deterministic, max 1×/day). Defaults OFF.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS surprises_opt_in boolean NOT NULL DEFAULT false;

GRANT UPDATE (surprises_opt_in) ON public.users TO authenticated;

CREATE TABLE IF NOT EXISTS public.surprise_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  observation_id  uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('dato_curioso','rarito','comunidad_activa_hoy')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  shown_at        timestamptz NOT NULL DEFAULT now(),
  dismissed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS surprise_events_user_day_idx
  ON public.surprise_events (user_id, shown_at DESC);

ALTER TABLE public.surprise_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS surprise_events_self_read ON public.surprise_events;
CREATE POLICY surprise_events_self_read ON public.surprise_events
  FOR SELECT USING (user_id = auth.uid());

-- Authenticated users can insert their own rows; the daily cap is
-- enforced by `record_surprise_event()` below (SECURITY DEFINER) so a
-- racing tab can't beat it. The direct-insert policy is a safety net
-- for tests + admin tooling — combined with the cap function nothing
-- bypasses the rule.
DROP POLICY IF EXISTS surprise_events_self_insert ON public.surprise_events;
CREATE POLICY surprise_events_self_insert ON public.surprise_events
  FOR INSERT WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT ON public.surprise_events TO authenticated;

-- ---- Helpers --------------------------------------------------------------

-- Today's count for the calling user. Used by the client to short-circuit
-- the picker before it hits any other RPC. Cheap (covered by the index).
CREATE OR REPLACE FUNCTION public.surprise_count_today()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::int
    FROM public.surprise_events
   WHERE user_id = auth.uid()
     AND shown_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
$$;

REVOKE ALL ON FUNCTION public.surprise_count_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surprise_count_today() TO authenticated;

-- Atomic record-with-cap-check. Returns the inserted row id when the
-- user is under cap, or NULL when capped or opted-out. Inline-checking
-- is the only way to avoid TOCTOU between two tabs racing the same
-- observation.
CREATE OR REPLACE FUNCTION public.record_surprise_event(
  p_observation_id uuid,
  p_kind           text,
  p_payload        jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_count        int;
  v_id           uuid;
  v_opt_in       boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Honour the per-user opt-in. Insert is silently skipped when off so
  -- we never log a surprise the user wouldn't have seen.
  SELECT surprises_opt_in INTO v_opt_in
    FROM public.users
   WHERE id = v_uid;
  IF NOT COALESCE(v_opt_in, false) THEN
    RETURN NULL;
  END IF;

  IF p_kind NOT IN ('dato_curioso','rarito','comunidad_activa_hoy') THEN
    RAISE EXCEPTION 'Unknown surprise kind: %', p_kind;
  END IF;

  -- 1×/day cap
  SELECT COUNT(*) INTO v_count
    FROM public.surprise_events
   WHERE user_id = v_uid
     AND shown_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
  IF v_count >= 1 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.surprise_events (user_id, observation_id, kind, payload)
  VALUES (v_uid, p_observation_id, p_kind, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_surprise_event(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_surprise_event(uuid, text, jsonb) TO authenticated;
-- ── M06 — "Mi impacto ecológico" retrospective (issue #728) ────────────────
--
-- Returns a single JSONB envelope with five honest, computable-today
-- metrics. Designed for ~200 obs per active user — no MV needed.
--
--   transect_km      heuristic: ST_Area(ST_ConvexHull(union of synced obs))
--                    cast to geography → square metres → km² → sqrt() to
--                    get a linear-equivalent km, then *0.5 because a
--                    bounding hull radically over-estimates the swept
--                    transect width.  Honest tooltip in the UI.
--   research_grade   count of the user's RG observations.  Used as the
--                    proxy for "obs that ended up in a DwC export" until
--                    we have a per-export audit log (export-dwca currently
--                    streams a ZIP without persisting which IDs it
--                    enclosed). RG is the conservative subset because
--                    the GBIF IPT only publishes RG.
--   expert_confirmed count of distinct observations where any
--                    identifications row has validated_by set AND that
--                    validator currently holds the 'expert' role.
--   in_research      count of observations whose project_id resolves to
--                    a public M29 project. The projects table has no
--                    `kind` column today; "research dataset" is read as
--                    "tagged into a (typically researcher-owned) project".
--                    When a `kind` column lands later this can be tightened
--                    without changing the API surface.
--   sensitive_seen   distinct species count where the user observed a
--                    taxon flagged on NOM-059 (P/A/Pr/E) or IUCN
--                    (CR/EN/VU/NT). Coarsens nicely as a Fogg-lever
--                    "you've helped track N at-risk species".
--
-- SECURITY DEFINER + restrict-to-self is the simplest sound predicate:
-- callers can only request their own impact (auth.uid() = p_user_id),
-- so the function is safe to grant to authenticated. service_role is
-- exempt for cron/EF reuse.
CREATE OR REPLACE FUNCTION public.compute_user_impact(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_transect_km numeric;
  v_rg_count int;
  v_expert_count int;
  v_research_count int;
  v_sensitive_species int;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  -- service_role calls have auth.uid() = NULL and bypass the predicate.
  -- authenticated callers must be the subject of the impact report.
  IF v_caller IS NOT NULL AND v_caller IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'compute_user_impact: caller must be the subject'
      USING ERRCODE = '42501';
  END IF;

  -- Transect-equivalent km via convex hull radius proxy.
  -- ST_Area on geography returns square metres. sqrt(area) gives an
  -- equivalent linear span; halve to dampen the over-estimate.
  -- Returns 0 (not NULL) for users with <3 located obs (hull undefined).
  SELECT
    COALESCE(
      ROUND(
        (sqrt(GREATEST(ST_Area(ST_ConvexHull(ST_Collect(o.location::geometry))::geography), 0)) / 1000.0)::numeric * 0.5,
        2
      ),
      0
    )
  INTO v_transect_km
  FROM public.observations o
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND o.location IS NOT NULL;

  -- Research-grade observations (DwC-export proxy)
  SELECT COUNT(DISTINCT o.id)::int
  INTO v_rg_count
  FROM public.observations o
  JOIN public.identifications i
    ON i.observation_id = o.id
   AND i.is_primary = true
   AND i.is_research_grade = true
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced';

  -- Expert-confirmed observations
  SELECT COUNT(DISTINCT o.id)::int
  INTO v_expert_count
  FROM public.observations o
  JOIN public.identifications i
    ON i.observation_id = o.id
   AND i.validated_by IS NOT NULL
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND public.has_role(i.validated_by, 'expert'::public.user_role);

  -- Observations included in a project (research-dataset proxy)
  SELECT COUNT(*)::int
  INTO v_research_count
  FROM public.observations o
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND o.project_id IS NOT NULL;

  -- Distinct NOM-059 / IUCN at-risk species observed
  SELECT COUNT(DISTINCT t.id)::int
  INTO v_sensitive_species
  FROM public.observations o
  JOIN public.identifications i
    ON i.observation_id = o.id AND i.is_primary = true
  JOIN public.taxa t
    ON t.id = i.taxon_id
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND (
      t.nom059_status IN ('E','P','A','Pr')
      OR t.iucn_category IN ('CR','EN','VU','NT')
    );

  RETURN jsonb_build_object(
    'transect_km',      COALESCE(v_transect_km, 0),
    'research_grade',   COALESCE(v_rg_count, 0),
    'expert_confirmed', COALESCE(v_expert_count, 0),
    'in_research',      COALESCE(v_research_count, 0),
    'sensitive_seen',   COALESCE(v_sensitive_species, 0),
    'computed_at',      now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_user_impact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_user_impact(uuid)
  TO authenticated, service_role;

-- list_user_impact_obs(user_id, filter, limit, offset)
-- =====================================================================
-- Returns observation IDs that match each impact-card filter, mirroring
-- the predicates inside compute_user_impact() one-for-one. Used by the
-- /profile/observations?filter=<key> deep-link from the impact page so
-- the cards land on the rows their metric was computed from.
--
-- We only return ids (not full rows) because the client already has a
-- detailed SELECT-with-joins for the list; a follow-up
-- `.in('id', returned_ids)` keeps shape parity with the regular path.
--
-- Filters:
--   mapped            location IS NOT NULL
--   research_grade    primary identifications.is_research_grade = true
--   expert_confirmed  any identification.validated_by has 'expert' role
--   in_project        project_id IS NOT NULL
--   sensitive         taxon nom059_status IN ('E','P','A','Pr')
--                     OR    iucn_category IN ('CR','EN','VU','NT')
--
-- Self-only: authenticated callers must be the subject. service_role
-- (auth.uid() = NULL) bypasses for cron/admin reuse.
CREATE OR REPLACE FUNCTION public.list_user_impact_obs(
  p_user_id uuid,
  p_filter  text,
  p_limit   int DEFAULT 20,
  p_offset  int DEFAULT 0
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_caller IS NOT NULL AND v_caller IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'list_user_impact_obs: caller must be the subject'
      USING ERRCODE = '42501';
  END IF;
  IF p_filter NOT IN ('mapped','research_grade','expert_confirmed','in_project','sensitive') THEN
    RAISE EXCEPTION 'list_user_impact_obs: unknown filter %', p_filter
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT o.id
  FROM public.observations o
  WHERE o.observer_id = p_user_id
    AND o.sync_status = 'synced'
    AND CASE p_filter
      WHEN 'mapped' THEN
        o.location IS NOT NULL
      WHEN 'research_grade' THEN
        EXISTS (
          SELECT 1 FROM public.identifications i
          WHERE i.observation_id = o.id
            AND i.is_primary = true
            AND i.is_research_grade = true
        )
      WHEN 'expert_confirmed' THEN
        EXISTS (
          SELECT 1 FROM public.identifications i
          WHERE i.observation_id = o.id
            AND i.validated_by IS NOT NULL
            AND public.has_role(i.validated_by, 'expert'::public.user_role)
        )
      WHEN 'in_project' THEN
        o.project_id IS NOT NULL
      WHEN 'sensitive' THEN
        EXISTS (
          SELECT 1 FROM public.identifications i
          JOIN public.taxa t ON t.id = i.taxon_id
          WHERE i.observation_id = o.id
            AND i.is_primary = true
            AND (
              t.nom059_status IN ('E','P','A','Pr')
              OR t.iucn_category IN ('CR','EN','VU','NT')
            )
        )
    END
  ORDER BY o.observed_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_impact_obs(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_user_impact_obs(uuid, text, int, int)
  TO authenticated, service_role;

-- M07 / #745 — Peer norms for license + privacy choice
-- =====================================================================
-- Two materialised views aggregate community-wide choices:
--   - license_norm:  per (country, license) observation count
--   - privacy_norm:  per (country, facet, visibility) observer count
-- A SECURITY INVOKER lookup (peer_norm_pct) returns the percentage for a
-- given (scope, country, key). The UI renders a small bar next to each
-- option using "X% de observadores en MX eligen esto" copy. Refreshed
-- weekly (Mondays 06:00 UTC) — these counts move slowly and a fresh
-- read every page-load would burn quota for cold-cache benefits.
--
-- Honesty rules:
--   * Anonymous observers and private profiles still count for license_norm
--     (the license sits on the observation, not the user surface).
--   * privacy_norm counts only observers whose `profile_privacy` is set
--     (i.e. anyone with a row in users) — opting out of leaderboards does
--     NOT remove you from the denominator (see below — observer counts).
--   * The bar should be hidden when n < 50 (UI gate, not a SQL gate; the
--     view still ships the count so the client decides).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.license_norm AS
SELECT
  COALESCE(u.country_code, 'XX') AS country_code,
  COALESCE(o.license, u.observer_license) AS license,
  COUNT(*)::bigint AS n
FROM public.observations o
JOIN public.users u ON u.id = o.observer_id
WHERE o.sync_status = 'synced'
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS license_norm_unique
  ON public.license_norm (country_code, license);

GRANT SELECT ON public.license_norm TO anon, authenticated;

-- privacy_norm: pivot the profile_privacy jsonb into (facet, visibility)
-- pairs. Each user contributes one row per facet. Facets we don't recognise
-- still flow through (forward-compat for new facets shipped before a
-- migration).
CREATE MATERIALIZED VIEW IF NOT EXISTS public.privacy_norm AS
SELECT
  COALESCE(u.country_code, 'XX')   AS country_code,
  pf.key                            AS facet,
  pf.value #>> '{}'                 AS visibility,
  COUNT(*)::bigint                  AS n
FROM public.users u,
     LATERAL jsonb_each(u.profile_privacy) AS pf(key, value)
WHERE u.profile_privacy IS NOT NULL
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS privacy_norm_unique
  ON public.privacy_norm (country_code, facet, visibility);

GRANT SELECT ON public.privacy_norm TO anon, authenticated;

-- peer_norm_pct(scope, country, key): single-row helper the UI hits per
-- option. Returns a row with both pct (0-100) and n so the client can
-- decide whether to render the bar (n >= 50) or fall back to copy.
--
-- scope must be 'license' or 'privacy:<facet>' (e.g. 'privacy:profile').
-- country is an ISO-3166 alpha-2 (e.g. 'MX'); pass NULL to mean "global"
-- (sum all rows). key is the option being asked about (license string or
-- visibility level).
CREATE OR REPLACE FUNCTION public.peer_norm_pct(
  p_scope   text,
  p_country text,
  p_key     text
)
RETURNS TABLE (pct numeric, n bigint, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_country text := upper(NULLIF(trim(p_country), ''));
  v_facet   text;
  v_n       bigint := 0;
  v_total   bigint := 0;
BEGIN
  IF p_scope = 'license' THEN
    SELECT COALESCE(SUM(n) FILTER (WHERE license = p_key), 0),
           COALESCE(SUM(n), 0)
      INTO v_n, v_total
      FROM public.license_norm
     WHERE v_country IS NULL OR country_code = v_country;
  ELSIF p_scope LIKE 'privacy:%' THEN
    v_facet := substr(p_scope, 9);
    SELECT COALESCE(SUM(n) FILTER (WHERE visibility = p_key), 0),
           COALESCE(SUM(n), 0)
      INTO v_n, v_total
      FROM public.privacy_norm
     WHERE facet = v_facet
       AND (v_country IS NULL OR country_code = v_country);
  ELSE
    RETURN QUERY SELECT 0::numeric, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_total = 0 THEN
    RETURN QUERY SELECT 0::numeric, 0::bigint, 0::bigint;
  ELSE
    RETURN QUERY SELECT
      ROUND((v_n::numeric / v_total::numeric) * 100, 1),
      v_n,
      v_total;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.peer_norm_pct(text, text, text)
  TO anon, authenticated;

-- Weekly refresh (Mondays 06:00 UTC). Idempotent — unschedule first.
SELECT cron.unschedule('refresh-norms-weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-norms-weekly');
SELECT cron.schedule('refresh-norms-weekly', '0 6 * * 1',
  $$REFRESH MATERIALIZED VIEW public.license_norm;
    REFRESH MATERIALIZED VIEW public.privacy_norm;$$);


-- =====================================================================
-- M01-traits — curated field marks per taxon (issue #736)
--
-- Powers the "¿Por qué?" panel under cascade results: 3-5 short, expert-
-- curated marks that let an observer self-verify the AI ID against the
-- photo. Per-language because Spanish + English readers see different
-- mnemonic phrases (e.g. "orejas desnudas" vs "naked ears").
--
-- Read: public (anon + authenticated). It's a field-guide layer.
-- Write: service_role only — privileged edits flow through M24 admin EF
--        once the editor UI lands. v1 seeds via taxon-traits-seed.sql.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.taxon_traits (
  taxon_id        uuid NOT NULL REFERENCES public.taxa(id) ON DELETE CASCADE,
  lang            text NOT NULL CHECK (lang IN ('en', 'es')),
  trait_marks     text[] NOT NULL,
  source_url      text,
  updated_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (taxon_id, lang)
);

ALTER TABLE public.taxon_traits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taxon_traits_read ON public.taxon_traits;
CREATE POLICY taxon_traits_read ON public.taxon_traits
  FOR SELECT USING (true);

GRANT SELECT ON public.taxon_traits TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.taxon_traits TO service_role;

CREATE INDEX IF NOT EXISTS idx_taxon_traits_lang
  ON public.taxon_traits(lang, taxon_id);

COMMENT ON TABLE public.taxon_traits IS
  'Curated field marks per taxon, surfaced in the "Why this species?" panel under AI cascade results (issue #736). One row per (taxon_id, lang). Read-public, expert-write only.';
-- M22-range — taxon range index (issue #742)
-- =====================================================================
-- Polite "outlier alert" at submit time: when the user's location is far
-- from the known range for the cascaded taxon, surface a soft modal
-- (NEVER blocks submission). Three outcomes:
--   • Real range extension → user confirms, obs.is_range_extension=true
--     and the obs lands on the M22 community-validation queue with
--     priority.
--   • Mis-ID / escapee → user reconsiders before submit.
--   • Reasonable distance (< threshold) → no modal at all.
--
-- v1 source = Rastrum's own research-grade observations (the same Option
-- A choice as falta-dex). v1.1 will replace `source = 'rastrum_proxy'`
-- rows with a curated GBIF ETL.
CREATE TABLE IF NOT EXISTS public.taxon_range_index (
  taxon_id     uuid PRIMARY KEY REFERENCES public.taxa(id) ON DELETE CASCADE,
  geom         geography(MultiPolygon, 4326) NOT NULL,
  source       text NOT NULL,            -- 'gbif' | 'rastrum_proxy' | 'curated'
  built_at     timestamptz NOT NULL DEFAULT now(),
  n_records    integer NOT NULL DEFAULT 0
);
ALTER TABLE public.taxon_range_index ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_taxon_range_index_geom
  ON public.taxon_range_index USING GIST (geom);

DROP POLICY IF EXISTS taxon_range_read ON public.taxon_range_index;
CREATE POLICY taxon_range_read ON public.taxon_range_index
  FOR SELECT USING (true);

GRANT SELECT ON public.taxon_range_index TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.taxon_range_index TO service_role;

-- Buffered membership check used at submit time. Returns the distance
-- (km) from the obs location to the nearest edge of the known range,
-- or NULL if the taxon has no range data yet (caller must treat NULL
-- as "no signal — don't show modal", not "in range").
CREATE OR REPLACE FUNCTION public.taxon_range_distance_km(
  p_taxon_id uuid,
  p_lat numeric,
  p_lng numeric
) RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT (ST_Distance(
            geom,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
          ) / 1000)::numeric(10,2)
    FROM public.taxon_range_index
   WHERE taxon_id = p_taxon_id;
$$;

REVOKE ALL ON FUNCTION public.taxon_range_distance_km(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taxon_range_distance_km(uuid, numeric, numeric)
  TO anon, authenticated;

-- Range-extension flag on observations. When true, the obs is treated
-- as a candidate range extension by M22's validation queue and gets a
-- "Posible extensión de rango" pill on the detail page.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS is_range_extension boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_observations_range_extension
  ON public.observations(is_range_extension)
  WHERE is_range_extension = true;

-- ─────────────────────────────────────────────────────────────────────
-- public.refresh_taxon_ranges() — SECURITY DEFINER cron-only worker
-- Recomputes the per-taxon range index from Rastrum research-grade
-- observations in the last 5 years. Threshold: ≥10 obs per taxon.
-- Geometry: ST_ConvexHull over the union of locations, cast to
-- MultiPolygon for typed-column compatibility (a single hull always
-- becomes a 1-element multipolygon). Idempotent on (taxon_id).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_taxon_ranges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH eligible AS (
    SELECT
      o.primary_taxon_id                                            AS taxon_id,
      ST_Multi(ST_ConvexHull(ST_Collect(o.location::geometry)))::geography(MultiPolygon, 4326) AS geom,
      COUNT(*)::int                                                 AS n_records
      FROM public.observations o
      JOIN public.identifications i
        ON i.observation_id = o.id
       AND i.is_primary
       AND i.is_research_grade
     WHERE o.primary_taxon_id IS NOT NULL
       AND o.location IS NOT NULL
       AND o.observed_at >= now() - interval '5 years'
     GROUP BY o.primary_taxon_id
    HAVING COUNT(*) >= 10
  )
  INSERT INTO public.taxon_range_index AS tri
    (taxon_id, geom, source, built_at, n_records)
  SELECT taxon_id, geom, 'rastrum_proxy', now(), n_records
    FROM eligible
       ON CONFLICT (taxon_id) DO UPDATE
      SET geom      = EXCLUDED.geom,
          source    = EXCLUDED.source,
          built_at  = EXCLUDED.built_at,
          n_records = EXCLUDED.n_records;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_taxon_ranges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_taxon_ranges() TO service_role;

-- ── Chat entity cards (M01 chat improvements, 2026-05-09) ──
-- Read-only functions returning EntityCard-shaped JSONB. Every function
-- is SECURITY INVOKER; the existing RLS policies enforce visibility.

DROP FUNCTION IF EXISTS public.chat_obs_card(uuid);
CREATE FUNCTION public.chat_obs_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH o AS (
    SELECT
      o.id, o.observer_id, o.observed_at,
      o.primary_taxon_id, o.obscure_level,
      o.location, o.location_obscured,
      o.state_province, o.notes,
      COALESCE(i.is_research_grade, false) AS is_research_grade,
      t.scientific_name, t.common_name_es, t.common_name_en,
      t.kingdom, t.family
    FROM public.observations o
    LEFT JOIN public.taxa t ON t.id = o.primary_taxon_id
    LEFT JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary = true
    WHERE o.id = p_id
  )
  SELECT CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'observation',
    'id',            o.id::text,
    'label',         coalesce(o.scientific_name, '—')
                     || ' · ' || to_char(o.observed_at, 'Mon DD')
                     || coalesce(' · ' || o.state_province, ''),
    'summary_text',
      'Observation of ' || coalesce(o.scientific_name, 'unknown taxon')
      || coalesce(' (' || o.common_name_en || ')', '')
      || ' on ' || to_char(o.observed_at, 'YYYY-MM-DD')
      || coalesce(' in ' || o.state_province, '')
      || CASE WHEN o.is_research_grade THEN '. Research grade.' ELSE '. Needs review.' END
      || coalesce(' Observer notes: ' || left(o.notes, 240), ''),
    'fields',        jsonb_build_object(
      'scientific_name', o.scientific_name,
      'common_name_en',  o.common_name_en,
      'common_name_es',  o.common_name_es,
      'kingdom',         o.kingdom,
      'family',          o.family,
      'observed_at',     o.observed_at,
      'state_province',  o.state_province,
      'is_research_grade', o.is_research_grade,
      'obscure_level',   o.obscure_level,
      'lat', CASE WHEN auth.uid() = o.observer_id
                  THEN ST_Y(o.location::geometry)
                  ELSE ST_Y(coalesce(o.location_obscured, o.location)::geometry) END,
      'lng', CASE WHEN auth.uid() = o.observer_id
                  THEN ST_X(o.location::geometry)
                  ELSE ST_X(coalesce(o.location_obscured, o.location)::geometry) END,
      'coords_obscured', (auth.uid() IS DISTINCT FROM o.observer_id AND o.location_obscured IS NOT NULL)
    ),
    'suggested_questions', jsonb_build_array(
      'Why is this ' || CASE WHEN o.is_research_grade THEN 'research grade' ELSE 'needs review' END || '?',
      'What other observations of this species are nearby?',
      'Tell me about ' || coalesce(o.scientific_name, 'this species') || '.'
    ),
    'related',       jsonb_build_object(
      'primary_taxon_id', o.primary_taxon_id::text,
      'observer_id',      o.observer_id::text
    )
  ) END
  FROM o;
$$;

DROP FUNCTION IF EXISTS public.chat_species_card(text);
CREATE FUNCTION public.chat_species_card(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH t AS (
    SELECT id, scientific_name, canonical_name, common_name_es, common_name_en,
           kingdom, family, nom059_status, cites_appendix, iucn_category, is_endemic_mexico,
           description_es, description_en, obscure_level
    FROM public.taxa
    WHERE id::text = p_query
       OR canonical_name ILIKE p_query
       OR scientific_name ILIKE p_query
    ORDER BY canonical_name
    LIMIT 1
  )
  SELECT CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'species',
    'id',            t.id::text,
    'label',         t.scientific_name,
    'summary_text',
      coalesce(t.scientific_name, '')
      || coalesce(' (' || t.common_name_en || ')', '')
      || ' — ' || coalesce(t.kingdom, '?') || ' / ' || coalesce(t.family, '?')
      || coalesce('. NOM-059: ' || t.nom059_status, '')
      || coalesce('. CITES: ' || t.cites_appendix, '')
      || coalesce('. IUCN: ' || t.iucn_category, '')
      || coalesce('. ' || left(t.description_en, 240), ''),
    'fields',        jsonb_build_object(
      'scientific_name',     t.scientific_name,
      'common_name_en',      t.common_name_en,
      'common_name_es',      t.common_name_es,
      'kingdom',             t.kingdom,
      'family',              t.family,
      'nom059_status',       t.nom059_status,
      'cites_appendix',      t.cites_appendix,
      'iucn_category',       t.iucn_category,
      'is_endemic_mexico',   t.is_endemic_mexico,
      'obscure_level',       t.obscure_level
    ),
    'suggested_questions', jsonb_build_array(
      'Where in Mexico is ' || t.scientific_name || ' typically observed?',
      'What does NOM-059 ' || coalesce(t.nom059_status, 'status') || ' mean?',
      'Show me recent observations of this species.'
    ),
    'related',       jsonb_build_object(
      'primary_taxon_id', t.id::text
    )
  ) END
  FROM t;
$$;

DROP FUNCTION IF EXISTS public.chat_project_card(text);
CREATE FUNCTION public.chat_project_card(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH p AS (
    SELECT id, slug, name, name_es, description, description_es,
           visibility, owner_user_id, area_km2
    FROM public.projects_with_geojson
    WHERE id::text = p_query OR slug = p_query
    LIMIT 1
  ),
  c AS (
    SELECT count(*)::int AS obs_count
    FROM public.observations o, p
    WHERE o.project_id = p.id
  )
  SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'project',
    'id',            p.id::text,
    'label',         coalesce(p.name, p.slug),
    'summary_text',
      'Project "' || coalesce(p.name, p.slug) || '"'
      || coalesce(' — ' || left(p.description, 240), '')
      || '. Visibility: ' || p.visibility
      || coalesce('. Approx ' || round(p.area_km2)::text || ' km².', '')
      || ' ' || c.obs_count || ' observations.',
    'fields',        jsonb_build_object(
      'slug',         p.slug,
      'name',         p.name,
      'name_es',      p.name_es,
      'description',    p.description,
      'description_es', p.description_es,
      'visibility',   p.visibility,
      'area_km2',     p.area_km2,
      'obs_count',    c.obs_count
    ),
    'suggested_questions', jsonb_build_array(
      'Which species are most common in this project?',
      'How many observations were added in the last 30 days?',
      'List the camera stations in this project.'
    ),
    'related',       jsonb_build_object(
      'project_id', p.id::text
    )
  ) END
  FROM p, c;
$$;

DROP FUNCTION IF EXISTS public.chat_camera_station_card(uuid);
CREATE FUNCTION public.chat_camera_station_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH s AS (
    SELECT cs.id, cs.project_id, cs.station_key, cs.name, cs.habitat,
           cs.camera_model, cs.notes, cs.coords,
           p.name AS project_name, p.slug AS project_slug
    FROM public.camera_stations cs
    LEFT JOIN public.projects p ON p.id = cs.project_id
    WHERE cs.id = p_id
  ),
  pn AS (
    SELECT coalesce(public.station_trap_nights(s.id), 0) AS trap_nights
    FROM s
  )
  SELECT CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'camera_station',
    'id',            s.id::text,
    'label',         coalesce(s.name, s.station_key),
    'summary_text',
      'Camera station ' || s.station_key
      || coalesce(' (' || s.name || ')', '')
      || coalesce(' in project "' || s.project_name || '"', '')
      || coalesce(', habitat: ' || s.habitat, '')
      || coalesce(', camera: ' || s.camera_model, '')
      || '. Trap-nights to date: ' || pn.trap_nights || '.',
    'fields',        jsonb_build_object(
      'station_key',  s.station_key,
      'name',         s.name,
      'habitat',      s.habitat,
      'camera_model', s.camera_model,
      'project_slug', s.project_slug,
      'trap_nights',  pn.trap_nights,
      'lat',          ST_Y(s.coords::geometry),
      'lng',          ST_X(s.coords::geometry)
    ),
    'suggested_questions', jsonb_build_array(
      'Which species have been detected at this station?',
      'What is the detection rate per 100 trap-nights?',
      'How long has this station been deployed?'
    ),
    'related',       jsonb_build_object(
      'project_id', s.project_id::text
    )
  ) END
  FROM s, pn;
$$;

DROP FUNCTION IF EXISTS public.chat_observer_card(uuid);
CREATE FUNCTION public.chat_observer_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH u AS (
    SELECT id, username, display_name, avatar_url, country_code,
           is_expert, expert_taxa,
           observation_count, species_count, obs_count_30d,
           last_observation_at, joined_at, karma_total
    FROM public.community_observers
    WHERE id = p_id
  )
  SELECT CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'observer',
    'id',            u.id::text,
    'label',         coalesce(u.display_name, u.username),
    'thumbnail',     u.avatar_url,
    'summary_text',
      coalesce(u.display_name, u.username)
      || coalesce(' (@' || u.username || ')', '')
      || coalesce(' from ' || u.country_code, '')
      || '. ' || u.observation_count || ' observations, '
      || u.species_count || ' species, '
      || u.karma_total || ' karma.'
      || CASE WHEN u.is_expert THEN ' Expert.' ELSE '' END,
    'fields',        jsonb_build_object(
      'username',          u.username,
      'display_name',      u.display_name,
      'country_code',      u.country_code,
      'is_expert',         u.is_expert,
      'observation_count', u.observation_count,
      'species_count',     u.species_count,
      'obs_count_30d',     u.obs_count_30d,
      'karma_total',       u.karma_total
    ),
    'suggested_questions', jsonb_build_array(
      'What species does ' || coalesce(u.display_name, u.username) || ' observe most?',
      'When were they most active?',
      'What region do they observe in?'
    ),
    'related',       jsonb_build_object(
      'observer_id', u.id::text
    )
  ) END
  FROM u;
$$;

DROP FUNCTION IF EXISTS public.chat_self_profile_card(uuid);
CREATE FUNCTION public.chat_self_profile_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH u AS (
    SELECT id, username, display_name, bio, avatar_url, preferred_lang,
           is_expert, expert_taxa, observer_license,
           observation_count, country_code, region_primary,
           karma_total, joined_at, last_observation_at
    FROM public.users
    WHERE id = p_id
      AND id = auth.uid()
  )
  SELECT CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'self_profile',
    'id',            u.id::text,
    'label',         coalesce(u.display_name, u.username, 'You'),
    'thumbnail',     u.avatar_url,
    'summary_text',
      'Your profile: ' || coalesce(u.display_name, u.username)
      || coalesce(', based in ' || u.country_code, '')
      || '. ' || u.observation_count || ' observations, '
      || u.karma_total || ' karma.'
      || coalesce(' Bio: ' || left(u.bio, 200), '')
      || ' Preferred language: ' || coalesce(u.preferred_lang, 'en') || '.',
    'fields',        jsonb_build_object(
      'username',           u.username,
      'display_name',       u.display_name,
      'preferred_lang',     u.preferred_lang,
      'country_code',       u.country_code,
      'region_primary',     u.region_primary,
      'is_expert',          u.is_expert,
      'expert_taxa',        u.expert_taxa,
      'observer_license',   u.observer_license,
      'observation_count',  u.observation_count,
      'karma_total',        u.karma_total
    ),
    'suggested_questions', jsonb_build_array(
      'How is my karma calculated?',
      'What badges am I close to earning?',
      'Show my last 10 observations.'
    ),
    'related',       jsonb_build_object(
      'observer_id', u.id::text
    )
  ) END
  FROM u;
$$;

-- Dispatcher: routes by kind. Returns NULL for unknown kinds so callers
-- can treat that as 'entity not found'.
DROP FUNCTION IF EXISTS public.chat_entity_card(text, text);
CREATE FUNCTION public.chat_entity_card(p_kind text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_kind IN ('observation','camera_station','observer','self_profile') THEN
    BEGIN
      v_uuid := p_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
  END IF;

  RETURN CASE p_kind
    WHEN 'observation'    THEN public.chat_obs_card(v_uuid)
    WHEN 'species'        THEN public.chat_species_card(p_id)
    WHEN 'project'        THEN public.chat_project_card(p_id)
    WHEN 'camera_station' THEN public.chat_camera_station_card(v_uuid)
    WHEN 'observer'       THEN public.chat_observer_card(v_uuid)
    WHEN 'self_profile'   THEN public.chat_self_profile_card(v_uuid)
    ELSE NULL
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.chat_obs_card(uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_species_card(text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_project_card(text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_camera_station_card(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_observer_card(uuid)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_self_profile_card(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_entity_card(text, text)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.chat_obs_card(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_species_card(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_project_card(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_camera_station_card(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_observer_card(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_self_profile_card(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_entity_card(text, text)    TO authenticated;

-- ── Chat tools — read-only search/list functions (M01 chat improvements) ──
-- Each function wraps one filtered query against existing tables/views.
-- SECURITY INVOKER + RLS enforces visibility; no row exposure beyond what
-- the caller already had via direct SELECT.

DROP FUNCTION IF EXISTS public.chat_find_observations(jsonb, int);
CREATE FUNCTION public.chat_find_observations(p_filters jsonb, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_owner_self    boolean := coalesce((p_filters ->> 'owner') = 'me', false);
  v_taxon_id      uuid    := nullif(p_filters ->> 'primary_taxon_id', '')::uuid;
  v_project_id    uuid    := nullif(p_filters ->> 'project_id', '')::uuid;
  v_near_obs      uuid    := nullif(p_filters ->> 'near_observation_id', '')::uuid;
  v_radius_km     numeric := coalesce((p_filters ->> 'radius_km')::numeric, 50);
  v_research_only boolean := coalesce((p_filters ->> 'research_grade')::boolean, false);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_card)
    FROM (
      SELECT jsonb_build_object(
        'id',                o.id::text,
        'scientific_name',   t.scientific_name,
        'common_name_en',    t.common_name_en,
        'observed_at',       o.observed_at,
        'state_province',    o.state_province,
        'is_research_grade', COALESCE(i.is_research_grade, false)
      ) AS row_card
      FROM public.observations o
      LEFT JOIN public.taxa t ON t.id = o.primary_taxon_id
      LEFT JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary = true
      LEFT JOIN public.observations near ON near.id = v_near_obs
      WHERE (NOT v_owner_self    OR o.observer_id = auth.uid())
        AND (v_taxon_id    IS NULL OR o.primary_taxon_id = v_taxon_id)
        AND (v_project_id  IS NULL OR o.project_id      = v_project_id)
        AND (v_near_obs    IS NULL OR ST_DWithin(o.location, near.location, v_radius_km * 1000))
        AND (NOT v_research_only OR COALESCE(i.is_research_grade, false) = true)
      ORDER BY o.observed_at DESC
      LIMIT greatest(1, least(p_limit, 50))
    ) sub
  ), '[]'::jsonb);
END;
$$;

DROP FUNCTION IF EXISTS public.chat_find_species(text, int);
CREATE FUNCTION public.chat_find_species(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',                t.id::text,
      'scientific_name',   t.scientific_name,
      'common_name_en',    t.common_name_en,
      'common_name_es',    t.common_name_es,
      'kingdom',           t.kingdom,
      'family',            t.family
    ) AS row_card
    FROM public.taxa t
    WHERE t.canonical_name    ILIKE ('%' || p_query || '%')
       OR t.scientific_name   ILIKE ('%' || p_query || '%')
       OR t.common_name_en    ILIKE ('%' || p_query || '%')
       OR t.common_name_es    ILIKE ('%' || p_query || '%')
    ORDER BY (t.scientific_name = p_query) DESC, t.canonical_name
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_projects(text, int);
CREATE FUNCTION public.chat_find_projects(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',     p.id::text,
      'slug',   p.slug,
      'name',   p.name,
      'name_es', p.name_es
    ) AS row_card
    FROM public.projects_with_geojson p
    WHERE p.name    ILIKE ('%' || p_query || '%')
       OR p.name_es ILIKE ('%' || p_query || '%')
       OR p.slug    ILIKE ('%' || p_query || '%')
    ORDER BY p.name
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_camera_stations(uuid, int);
CREATE FUNCTION public.chat_find_camera_stations(p_project_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',          cs.id::text,
      'station_key', cs.station_key,
      'name',        cs.name,
      'habitat',     cs.habitat
    ) AS row_card
    FROM public.camera_stations cs
    WHERE cs.project_id = p_project_id
    ORDER BY cs.station_key
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_observers(text, int);
CREATE FUNCTION public.chat_find_observers(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',           u.id::text,
      'username',     u.username,
      'display_name', u.display_name,
      'is_expert',    u.is_expert
    ) AS row_card
    FROM public.community_observers u
    WHERE u.username     ILIKE ('%' || p_query || '%')
       OR u.display_name ILIKE ('%' || p_query || '%')
    ORDER BY u.observation_count DESC
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

REVOKE EXECUTE ON FUNCTION public.chat_find_observations(jsonb, int)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_species(text, int)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_projects(text, int)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_camera_stations(uuid, int)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_observers(text, int)            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.chat_find_observations(jsonb, int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_species(text, int)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_projects(text, int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_camera_stations(uuid, int)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_observers(text, int)             TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Locations first-class (#914) — places table + chat_find_location RPC
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.places (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  name_local      text,
  place_type      text NOT NULL DEFAULT 'h3_cell'
                  CHECK (place_type IN ('protected_area','h3_cell','custom','community')),
  geometry        geography(Geometry,4326),
  h3_cells        text[],
  observation_count integer NOT NULL DEFAULT 0,
  observer_count    integer NOT NULL DEFAULT 0,
  top_taxa          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS places_slug_idx ON public.places(slug);
CREATE INDEX IF NOT EXISTS places_geo_idx ON public.places USING GIST(geometry);

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS places_public_read ON public.places;
CREATE POLICY places_public_read ON public.places FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.chat_find_location(p_query text, p_limit int DEFAULT 5)
RETURNS TABLE (id uuid, slug text, name text, place_type text, observation_count int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT id, slug, name, place_type, observation_count
  FROM public.places
  WHERE name ILIKE '%' || p_query || '%'
     OR slug ILIKE '%' || p_query || '%'
  ORDER BY observation_count DESC
  LIMIT p_limit;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_find_location(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_find_location(text, int) TO authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- Security Advisor remediation — 2026-05-08
-- ═══════════════════════════════════════════════════════════════════════════
-- Closes the critical + warning findings from the Supabase Database Advisor:
--
--   1. SECURITY DEFINER views (17) — flipped to security_invoker so RLS on
--      underlying tables is honoured at the caller's perspective. The views'
--      existing privacy gates (`can_see_facet()`, `hide_from_leaderboards`)
--      keep doing their job; flipping just adds RLS as a second line of
--      defence and stops the underlying-table-bypass class.
--   2. PUBLIC role EXECUTE on user-defined SECURITY DEFINER functions —
--      revoked surgically (definer-only, not all functions, so PostGIS /
--      pgcrypto / etc. stay PUBLIC-callable). The blanket grant to
--      `authenticated` upstream stays untouched. Net effect: every
--      definer function now requires an explicit role grant — anon can't
--      escalate via the "PUBLIC default ACL" path.
--   3. Function search_path — every public-schema function gets
--      `search_path = public, extensions, pg_temp` so opclasses /
--      operators from extensions resolve cleanly and a malicious schema
--      ahead of public can't shadow built-ins.
--   4. pg_trgm extension moved out of `public` into `extensions` schema.
--      pg_net keeps its own `net` schema (extension home is cosmetic).
--      PostGIS stays in public — moving post-install is high-risk for
--      negligible payoff.
--
-- Storage `media` bucket listing restriction is deliberately deferred to a
-- follow-up because R2 is the primary path; verifying Supabase Storage's
-- public-read flow under tightened RLS warrants its own dedicated PR.
-- Track at https://github.com/ArtemioPadilla/rastrum/issues (TBD).
--
-- Auth → Leaked Password Protection is a Dashboard toggle (no SQL).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Flip 17 views to security_invoker = true
-- ─────────────────────────────────────────────────────────────────────────
-- ALTER VIEW … SET (security_invoker = true) is PG15+. Idempotent — replays
-- of make db-apply are no-ops once the option is set.
ALTER VIEW public.community_observers                SET (security_invoker = true);
ALTER VIEW public.community_observers_with_centroid  SET (security_invoker = true);
ALTER VIEW public.featured_species_current           SET (security_invoker = true);
ALTER VIEW public.moderator_trust_scores             SET (security_invoker = true);
ALTER VIEW public.profile_activity_feed              SET (security_invoker = true);
ALTER VIEW public.profile_badges_visible             SET (security_invoker = true);
ALTER VIEW public.profile_calendar_buckets           SET (security_invoker = true);
ALTER VIEW public.profile_karma                      SET (security_invoker = true);
ALTER VIEW public.profile_observation_pins           SET (security_invoker = true);
ALTER VIEW public.profile_pokedex                    SET (security_invoker = true);
ALTER VIEW public.profile_stats_counts               SET (security_invoker = true);
ALTER VIEW public.profile_taxonomic_donut            SET (security_invoker = true);
ALTER VIEW public.profile_top_species                SET (security_invoker = true);
ALTER VIEW public.profile_validation_reputation      SET (security_invoker = true);
ALTER VIEW public.taxa_thumbnails                    SET (security_invoker = true);
ALTER VIEW public.user_expertise_regional            SET (security_invoker = true);
ALTER VIEW public.validation_queue                   SET (security_invoker = true);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Revoke EXECUTE from PUBLIC on user-defined SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────────
-- Postgres' default ACL grants EXECUTE on new functions to PUBLIC, which is
-- why ~50 trigger / internal helpers showed up as "Public Can Execute
-- SECURITY DEFINER Function" in the advisor. The blanket grant to
-- `authenticated` upstream (line ~563) is unaffected — `authenticated` is a
-- distinct role from PUBLIC.
--
-- Surgical: we only revoke from SECURITY DEFINER functions, not all
-- functions. PostGIS, pgcrypto, and other extension-provided functions
-- live in `public` and are PUBLIC-callable by design — sweeping them up
-- in a blanket REVOKE would break anon's ability to read views that call
-- `ST_AsGeoJSON`, `gen_random_uuid`, etc. through PostgREST.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
      r.proname, r.args
    );
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Move pg_trgm to the extensions schema
-- ─────────────────────────────────────────────────────────────────────────
-- pg_net intentionally untouched: its functions live in a self-managed
-- `net` schema regardless of where the extension is installed, so the
-- advisor "Extension in Public" warning for pg_net is cosmetic and moving
-- it adds no security value while risking noise in net._http_response
-- joins. PostGIS likewise stays in public (post-install moves are
-- industry-known anti-patterns; the geometry/geography column-type
-- references would all need rewriting).
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Pin search_path on every public function that doesn't already have one
-- ─────────────────────────────────────────────────────────────────────────
-- Includes `extensions` so pg_trgm's `similarity()`, `%` operator, and the
-- gin_trgm_ops opclass keep resolving from inside function bodies after
-- the schema move above. Idempotent — only ALTERs functions whose
-- proconfig doesn't already include a search_path entry.
-- Extension-owned functions (PostGIS, pg_trgm, etc.) are owned by the
-- extension's role on hosted Supabase, NOT by the role running the apply.
-- ALTER FUNCTION on a function you don't own raises "must be owner of
-- function …" — exactly the failure that broke the post-merge db-apply
-- run for PR #828. Skip them via pg_depend (deptype 'e' = extension).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')  -- regular functions + procedures (not aggregates)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c
        WHERE c LIKE 'search_path=%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
      r.proname, r.args
    );
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Reassert the authenticated-role blanket grant
-- ─────────────────────────────────────────────────────────────────────────
-- The REVOKE FROM PUBLIC above doesn't touch `authenticated`'s grants,
-- but reapplying the blanket grant here is defensive: any function added
-- between the line ~563 grant and this remediation block (e.g., via a
-- `CREATE OR REPLACE FUNCTION` declared above) gets re-granted explicitly.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 (#834): restrict cron-only SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────────
-- prune_old_notifications is a cron-only entry point (see cron-schedules.sql
-- 'prune_old_notifications' job). It is never called via supabase.rpc() from
-- the front-end. Restrict to service_role; revoke the blanket authenticated
-- grant that was reasserted two lines above.
--
-- Trigger functions (RETURNS trigger) are intentionally excluded: Postgres
-- prevents direct rpc() calls to trigger-returning functions regardless of
-- ACLs, so their blanket-only state is cosmetically imperfect but safe.
-- Per-function grants on them would be defensive noise.
REVOKE EXECUTE ON FUNCTION public.prune_old_notifications() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_old_notifications() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. PostGIS spatial_ref_sys — enable RLS with a permissive read policy
-- ─────────────────────────────────────────────────────────────────────────
-- Advisor flags `public.spatial_ref_sys` as a public-exposed table without
-- RLS. The data is non-sensitive SRID/projection metadata (same on every
-- PostGIS install), but our "every public table has RLS" invariant should
-- be uniform across the schema rather than carve-outs.
--
-- The table is PostGIS-owned; the apply role may or may not be able to
-- ALTER it. The DO blocks swallow insufficient_privilege so the apply
-- doesn't fail — in that case the advisor entry persists and the
-- operator falls back to dashboard-level acceptance.
DO $$
BEGIN
  ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'spatial_ref_sys is owned by a higher role; skipping RLS toggle. Mark advisor entry accepted in dashboard.';
END
$$;

DROP POLICY IF EXISTS spatial_ref_sys_world_read ON public.spatial_ref_sys;
DO $$
BEGIN
  CREATE POLICY spatial_ref_sys_world_read ON public.spatial_ref_sys
    FOR SELECT USING (true);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'apply role cannot CREATE POLICY on spatial_ref_sys; advisor entry will persist.';
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- #812 — count_distinct_observed_species() RPC
-- Returns distinct primary_taxon_id count from public observations.
-- STABLE (no side effects), SECURITY INVOKER, LANGUAGE sql.
-- GRANT to anon and authenticated.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_distinct_observed_species()
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
AS $$
  SELECT COUNT(DISTINCT primary_taxon_id)::integer
  FROM public.observations
  WHERE primary_taxon_id IS NOT NULL
    AND sync_status = 'synced'
    AND obscure_level <> 'private';
$$;

GRANT EXECUTE ON FUNCTION public.count_distinct_observed_species() TO anon, authenticated;

-- #710 — observation suggestions (location + season + not-yet-observed)
-- Returns up to 10 species the viewer could find nearby that they
-- haven't observed yet, ranked by nearby platform activity.
-- =====================================================
-- #798 — after_rain kairos trigger
-- Extends kairos_subscriptions.kind CHECK to include 'after_rain'.
-- Adds weather_snapshots table (geohash5 grid, populated by
-- enrich-environment) and recent_rainfall_12h view.
-- ─────────────────────────────────────────────────────────────────────

-- Extend the kind CHECK constraint (drop + recreate idempotently).
ALTER TABLE public.kairos_subscriptions
  DROP CONSTRAINT IF EXISTS kairos_subscriptions_kind_check;
ALTER TABLE public.kairos_subscriptions
  ADD CONSTRAINT kairos_subscriptions_kind_check
  CHECK (kind IN ('golden_hour', 'after_rain', 'migration_window', 'lunar_event'));

-- weather_snapshots: one row per (geohash5, hour-bucket).
-- Populated by enrich-environment; consumed by kairos-fire (after_rain).
CREATE TABLE IF NOT EXISTS public.weather_snapshots (
  id               bigserial PRIMARY KEY,
  geohash5         text        NOT NULL,
  precipitation_mm numeric     NOT NULL DEFAULT 0,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weather_snapshots_geohash5_recorded_at
  ON public.weather_snapshots(geohash5, recorded_at DESC);

ALTER TABLE public.weather_snapshots ENABLE ROW LEVEL SECURITY;

-- Only service_role can write snapshots; no direct user access.
GRANT SELECT ON public.weather_snapshots TO service_role;
GRANT INSERT ON public.weather_snapshots TO service_role;

-- recent_rainfall_12h: total precipitation in the last 12 h per geohash5.
-- SECURITY INVOKER so RLS on weather_snapshots applies to the caller.
DROP VIEW IF EXISTS public.recent_rainfall_12h;
CREATE VIEW public.recent_rainfall_12h
  WITH (security_invoker = true) AS
SELECT
  geohash5,
  SUM(precipitation_mm) AS total_mm,
  MAX(recorded_at)      AS latest_at
FROM public.weather_snapshots
WHERE recorded_at >= (now() - INTERVAL '12 hours')
GROUP BY geohash5;

GRANT SELECT ON public.recent_rainfall_12h TO service_role;


-- migration_windows: catalog of seasonal windows when notable taxa migrate.
CREATE TABLE IF NOT EXISTS public.migration_windows (
  id           bigserial   PRIMARY KEY,
  taxon_group  text        NOT NULL,
  start_doy    integer     NOT NULL CHECK (start_doy BETWEEN 1 AND 366),
  end_doy      integer     NOT NULL CHECK (end_doy BETWEEN 1 AND 366),
  region_code  text        NOT NULL,
  body_en      text        NOT NULL,
  body_es      text        NOT NULL,
  source_url   text,
  enabled      boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_windows_region_enabled
  ON public.migration_windows(region_code) WHERE enabled = true;

ALTER TABLE public.migration_windows ENABLE ROW LEVEL SECURITY;

-- Public read for enabled rows (anon/authenticated); writes via service_role only.
DROP POLICY IF EXISTS "migration_windows_public_read" ON public.migration_windows;
CREATE POLICY "migration_windows_public_read" ON public.migration_windows
  FOR SELECT USING (enabled = true);

GRANT SELECT ON public.migration_windows TO anon, authenticated, service_role;

-- Seed 4–8 MX migration windows.
INSERT INTO public.migration_windows
  (taxon_group, start_doy, end_doy, region_code, body_en, body_es, source_url)
VALUES
  -- Monarch butterfly southbound through Michoacán (Sep–Nov: DOY 244–319)
  ('Lepidoptera', 244, 319, 'MX-MIC',
   'Monarch migration underway in Michoacán — watch for mass roosts.',
   'Migración de monarca en Michoacán — busca dormideros masivos.',
   'https://www.learner.org/series/journey-north/monarch-butterfly/'),
  -- Monarch overwintering peak in Oaxaca valleys (Oct–Jan: DOY 274–31)
  ('Lepidoptera', 274, 31, 'MX-OAX',
   'Monarchs overwintering in Oaxaca highland forests.',
   'Monarcas invernando en bosques serranos de Oaxaca.',
   NULL),
  -- Swainson''s Hawk southbound through Veracruz (Sep–Nov: DOY 244–319)
  ('Aves', 244, 319, 'MX-VER',
   'Swainson''s Hawk migration through Veracruz — count raptors from Chichicaxtle ridge.',
   'Migración de gavilán de Swainson por Veracruz — conteo desde Chichicaxtle.',
   'https://hawkcount.org/'),
  -- Olive Ridley sea turtle nesting on Oaxaca coast (Jun–Dec: DOY 152–335)
  ('Reptilia', 152, 335, 'MX-OAX',
   'Olive Ridley nesting season on Oaxaca beaches — low-light observation only.',
   'Temporada de anidación de golfina en playas de Oaxaca — observación con luz tenue.',
   NULL)
ON CONFLICT DO NOTHING;
-- =======================================

-- ====================================================================
-- #852 — daily_challenge_for_user RPC
-- Returns ONE taxon per UTC day per user: region-filtered, rarity<=3,
-- deterministic via md5 seeding so device-refreshes get same result.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.daily_challenge_for_user(p_user_id uuid)
RETURNS TABLE (
  taxon_id        uuid,
  scientific_name text,
  common_name_en  text,
  common_name_es  text,
  kingdom         text,
  rarity_tier     int,
  thumbnail_url   text,
  why             text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_country_code text;
  v_doy          int := EXTRACT(DOY FROM CURRENT_DATE)::int;
BEGIN
  SELECT country_code INTO v_country_code
  FROM public.users WHERE id = p_user_id;

  RETURN QUERY
  SELECT
    t.id,
    t.scientific_name,
    t.common_name_en,
    t.common_name_es,
    t.kingdom,
    t.rarity_tier,
    (SELECT mf.url FROM public.media_files mf
       JOIN public.observations mo ON mo.id = mf.observation_id
       JOIN public.identifications mi ON mi.observation_id = mo.id AND mi.taxon_id = t.id AND mi.is_primary
       WHERE mf.is_primary AND mo.sync_status = 'synced'
       LIMIT 1) AS thumbnail_url,
    CASE t.kingdom
      WHEN 'Animalia' THEN COALESCE(t.common_name_es, t.scientific_name) || ' — animal de la región'
      WHEN 'Plantae'  THEN COALESCE(t.common_name_es, t.scientific_name) || ' — planta local'
      ELSE COALESCE(t.common_name_es, t.scientific_name) || ' — especie regional'
    END AS why
  FROM public.taxa t
  WHERE (t.rarity_tier IS NULL OR t.rarity_tier <= 3)  -- NULL = unclassified, treat as common
    AND (
      v_country_code IS NULL
      OR EXISTS (
        SELECT 1 FROM public.observations o
        JOIN public.identifications i ON i.observation_id = o.id AND i.taxon_id = t.id AND i.is_primary
        WHERE o.sync_status = 'synced'
          AND (o.country_code = v_country_code OR o.country_code IS NULL)
      )
    )
    AND t.id NOT IN (
      SELECT DISTINCT i2.taxon_id
      FROM public.observations o2
      JOIN public.identifications i2 ON i2.observation_id = o2.id AND i2.is_primary
      WHERE o2.observer_id = p_user_id AND i2.taxon_id IS NOT NULL
    )
  ORDER BY md5(p_user_id::text || v_doy::text || t.id::text)
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.daily_challenge_for_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.daily_challenge_for_user(uuid) TO authenticated;

-- ============================================================
-- #710 — suggest_nearby_species RPC
-- Returns up to 10 species the viewer could find nearby that
-- they haven't observed yet, ranked by nearby platform activity.
--
-- Month wrapping fix (#881): uses = ANY(ARRAY[prev,cur,next]) with
-- modular arithmetic instead of BETWEEN p_month±1 which broke at
-- January (BETWEEN 0 AND 2) and December (BETWEEN 11 AND 13).
--
-- Supporting index for the correlated photo_url subquery:
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_media_files_obs_primary
  ON public.media_files(observation_id, is_primary)
  WHERE is_primary = true;

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
      AND o.establishment_means = 'wild'  -- #942: exclude cultivated/captive/domestic species
      -- Valid values (CHECK constraint): 'wild'|'cultivated'|'captive'|'uncertain'
      -- Darwin Core establishmentMeans. All pre-2026 rows backfilled to 'wild' (schema:3078).
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
    NULL::text AS photo_url  -- #942: no stranger thumbnails (privacy + framing)
  FROM nearby n
  JOIN public.taxa t ON t.id = n.taxon_id
  ORDER BY n.nearby_count DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.suggest_nearby_species(uuid, double precision, double precision, integer, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.suggest_nearby_species(uuid, double precision, double precision, integer, integer, integer) TO authenticated;

-- ====================================================
-- #934 — taxa.rarity_tier backfill + nightly recompute
-- Tier 1 = common    (≥50 synced observations on platform)
-- Tier 2 = uncommon  (10–49 observations)
-- Tier 3 = rare      (1–9 observations)
-- Tier 4 = very rare (0 platform observations — known taxon, never recorded here)
-- ============================================================

-- One-time idempotent backfill (safe to re-run — only touches NULL rows).
DO $$
BEGIN
  UPDATE public.taxa t
  SET rarity_tier = sub.tier
  FROM (
    SELECT
      i.taxon_id,
      CASE
        WHEN COUNT(*) >= 50 THEN 1
        WHEN COUNT(*) >= 10 THEN 2
        WHEN COUNT(*) >= 1  THEN 3
        ELSE 4
      END AS tier
    FROM public.identifications i
    JOIN public.observations o ON o.id = i.observation_id
    WHERE i.is_primary AND o.sync_status = 'synced'
    GROUP BY i.taxon_id
  ) sub
  WHERE t.id = sub.taxon_id
    AND t.rarity_tier IS NULL;

  -- Taxa in the taxa table but with zero platform observations get tier 4.
  UPDATE public.taxa
  SET rarity_tier = 4
  WHERE rarity_tier IS NULL;
END $$;

-- Nightly recompute function — called by the scheduler after recompute_user_stats().
CREATE OR REPLACE FUNCTION public.recompute_taxa_rarity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE public.taxa t
  SET rarity_tier = sub.tier
  FROM (
    SELECT
      i.taxon_id,
      CASE
        WHEN COUNT(*) >= 50 THEN 1
        WHEN COUNT(*) >= 10 THEN 2
        WHEN COUNT(*) >= 1  THEN 3
        ELSE 4
      END AS tier
    FROM public.identifications i
    JOIN public.observations o ON o.id = i.observation_id
    WHERE i.is_primary AND o.sync_status = 'synced'
    GROUP BY i.taxon_id
  ) sub
  WHERE t.id = sub.taxon_id
    AND (t.rarity_tier IS NULL OR t.rarity_tier <> sub.tier);

  -- Newly added taxa with no observations yet
  UPDATE public.taxa
  SET rarity_tier = 4
  WHERE rarity_tier IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_taxa_rarity() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_taxa_rarity() TO service_role;
-- =====================================================================
-- M33: home page redesign — pulse + counts + falta-dex summary
-- See docs/superpowers/specs/2026-05-09-home-page-redesign-design.md.
-- =====================================================================

-- Marketing live-pulse counts (last 30 days). Cached at the EF layer.
CREATE OR REPLACE FUNCTION public.home_pulse_stats()
RETURNS TABLE(obs_30d int, species_30d int, active_observers_30d int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    (SELECT count(*)::int FROM observations
       WHERE sync_status='synced' AND observed_at >= now() - interval '30 days'),
    (SELECT count(DISTINCT primary_taxon_id)::int FROM observations
       WHERE sync_status='synced' AND observed_at >= now() - interval '30 days'
         AND primary_taxon_id IS NOT NULL),
    (SELECT count(DISTINCT observer_id)::int FROM observations
       WHERE sync_status='synced' AND observed_at >= now() - interval '30 days');
$$;
GRANT EXECUTE ON FUNCTION public.home_pulse_stats() TO anon, authenticated;

-- Partial index — accelerates pending_validation_count's WHERE clause.
CREATE INDEX IF NOT EXISTS idx_id_pending
  ON public.identifications (observation_id)
  WHERE is_research_grade = false AND validated_by IS NULL;

-- Returns the number of pending community IDs scoped to the caller's
-- expert kingdoms (users.expert_taxa). Capped at 99 (UI shows "99+").
-- Returns 0 for non-experts. Falls back to all taxa when expert_taxa is
-- NULL or empty so newly-onboarded experts still see the queue.
CREATE OR REPLACE FUNCTION public.pending_validation_count()
RETURNS int
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  n   int;
BEGIN
  IF uid IS NULL THEN RETURN 0; END IF;
  IF NOT has_role(uid, 'expert') THEN RETURN 0; END IF;

  SELECT LEAST(count(*), 99)::int INTO n
  FROM identifications i
  JOIN observations    o ON o.id = i.observation_id
  JOIN taxa            t ON t.id = i.taxon_id
  JOIN users           u ON u.id = uid
  WHERE i.is_research_grade = false
    AND i.validated_by IS NULL
    AND o.observer_id <> uid
    AND (u.expert_taxa IS NULL
         OR cardinality(u.expert_taxa) = 0
         OR t.kingdom = ANY(u.expert_taxa));

  RETURN COALESCE(n, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.pending_validation_count() TO authenticated;

-- Composite indexes — accelerate falta_dex_summary's two regional/owner
-- subqueries. Idempotent.
CREATE INDEX IF NOT EXISTS idx_obs_state_taxon
  ON public.observations (state_province, primary_taxon_id)
  WHERE primary_taxon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obs_observer_taxon
  ON public.observations (observer_id, primary_taxon_id)
  WHERE primary_taxon_id IS NOT NULL;

-- Returns a summary of falta-dex gaps for the caller — count of taxa
-- observed in user's region_primary but NOT yet observed by the caller,
-- capped at 999. Returns (0, NULL) for users without region_primary set.
-- Both subqueries btrim(state_province) to match the leaderboard
-- convention; the user's-own subquery filters sync_status='synced' so
-- pending drafts don't silently exclude taxa from the gap count.
CREATE OR REPLACE FUNCTION public.falta_dex_summary()
RETURNS TABLE(gap_count int, region text)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  user_region text;
BEGIN
  IF uid IS NULL THEN
    RETURN QUERY SELECT 0::int, NULL::text; RETURN;
  END IF;

  SELECT btrim(region_primary) INTO user_region FROM users WHERE id = uid;
  IF user_region IS NULL OR length(user_region) = 0 THEN
    RETURN QUERY SELECT 0::int, NULL::text; RETURN;
  END IF;

  RETURN QUERY
  SELECT
    LEAST(count(DISTINCT t.id), 999)::int AS gap_count,
    user_region                          AS region
  FROM taxa t
  WHERE t.id IN (
    SELECT DISTINCT primary_taxon_id FROM observations
    WHERE btrim(state_province) = user_region AND primary_taxon_id IS NOT NULL
  )
  AND t.id NOT IN (
    SELECT DISTINCT primary_taxon_id FROM observations
    WHERE observer_id = uid
      AND primary_taxon_id IS NOT NULL
      AND sync_status = 'synced'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.falta_dex_summary() TO authenticated;

-- ====================================================
-- #942 PR1 — Observation form redesign: schema deltas
-- Observation defaults memory + honest first-in-sector claim
-- ====================================================

-- Defaults memory: persists last habitat/weather/license per user (jsonb)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_observation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.last_observation_defaults IS
  'Remembers last-used observation defaults (habitat, weather, license) per user.
   Pre-filled on next form open. Privacy: read only by the owning user (RLS).';

-- is_first_in_sector — honest claim helper for the success state celebration
-- Returns true only when:
--   1. The sector (1 km radius) has >= 50 historical observations (honest-norms n>=50 invariant, v1.1.5)
--   2. The supplied observation is the first one in that sector on its own calendar day
-- Returns false in all other cases (including sectors with < 50 historical obs).
CREATE OR REPLACE FUNCTION public.is_first_in_sector(p_obs_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  -- Single-scan optimisation (ArtemIO review #942 PR1):
  -- One CTE scans the sector once and computes both:
  --   (a) the total neighbour count  → n>=50 honest-norms check
  --   (b) whether any neighbour shares the same calendar day
  -- The original implementation ran two separate ST_DWithin scans.
  WITH this_obs AS (
    SELECT location, observed_at
    FROM public.observations
    WHERE id = p_obs_id
      AND location IS NOT NULL
  ),
  sector_stats AS (
    SELECT
      count(*)                                                         AS total_neighbours,
      count(*) FILTER (
        WHERE date_trunc('day', o.observed_at AT TIME ZONE 'UTC')
            = date_trunc('day', t.observed_at AT TIME ZONE 'UTC')
      )                                                                AS same_day_neighbours
    FROM public.observations o, this_obs t
    WHERE o.location IS NOT NULL
      AND ST_DWithin(o.location::geography, t.location::geography, 1000)
      AND o.id != p_obs_id
  )
  SELECT
    CASE
      -- Honest-norms invariant v1.1.5: only claim "first" when the sector
      -- has enough historical data (n>=50). Below that threshold we simply
      -- return false — we cannot make a meaningful claim.
      WHEN total_neighbours < 50 THEN false
      -- Sector has enough history: first today iff no same-day neighbours.
      ELSE same_day_neighbours = 0
    END
  FROM sector_stats;
$$;

REVOKE EXECUTE ON FUNCTION public.is_first_in_sector(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_first_in_sector(uuid) TO authenticated;

-- ====================================================
-- #941 — life_stage + vital_status fields on observations
-- ====================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS life_stage text
    CHECK (life_stage IN ('adult','juvenile','subadult','nestling','egg','larva','pupa','unknown'));

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vital_status text
    CHECK (vital_status IN ('alive','dead','injured','unknown'));

COMMENT ON COLUMN public.observations.life_stage IS
  'Life stage of the observed individual. Optional. Darwin Core: lifeStage.';
COMMENT ON COLUMN public.observations.vital_status IS
  'Vital status of the observed individual. Optional. Darwin Core: occurrenceStatus extension.';



-- ====================================================
-- #873 — notify observation owner + parent comment author on new comment
-- ====================================================

CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_obs_owner uuid;
  v_parent_author uuid;
BEGIN
  -- Get observation owner
  SELECT observer_id INTO v_obs_owner FROM public.observations WHERE id = NEW.observation_id;

  -- Notify obs owner (unless they are the commenter)
  IF v_obs_owner IS NOT NULL AND v_obs_owner != NEW.author_id THEN
    -- Rate-limit: skip if we already sent a 'comment' notification for this
    -- observation to the owner in the last 30 minutes (#970)
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = v_obs_owner
        AND kind = 'comment'
        AND (payload->>'observation_id')::uuid = NEW.observation_id
        AND created_at > now() - interval '30 minutes'
    ) THEN
      INSERT INTO public.notifications (user_id, kind, payload)
      VALUES (v_obs_owner, 'comment', jsonb_build_object(
        'comment_id', NEW.id,
        'observation_id', NEW.observation_id,
        'commenter_id', NEW.author_id
      ));
    END IF;
  END IF;

  -- Notify parent comment author on reply
  IF NEW.parent_id IS NOT NULL THEN
    SELECT author_id INTO v_parent_author FROM public.observation_comments WHERE id = NEW.parent_id;
    IF v_parent_author IS NOT NULL AND v_parent_author != NEW.author_id AND v_parent_author != v_obs_owner THEN
      -- Rate-limit: skip if we already sent a 'comment' notification for this
      -- observation to the parent author in the last 30 minutes (#970)
      IF NOT EXISTS (
        SELECT 1 FROM public.notifications
        WHERE user_id = v_parent_author
          AND kind = 'comment'
          AND (payload->>'observation_id')::uuid = NEW.observation_id
          AND created_at > now() - interval '30 minutes'
      ) THEN
        INSERT INTO public.notifications (user_id, kind, payload)
        VALUES (v_parent_author, 'comment', jsonb_build_object(
          'comment_id', NEW.id,
          'observation_id', NEW.observation_id,
          'commenter_id', NEW.author_id,
          'is_reply', true
        ));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notify_on_comment ON public.observation_comments;
CREATE TRIGGER tg_notify_on_comment
  AFTER INSERT ON public.observation_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

REVOKE EXECUTE ON FUNCTION public.notify_on_comment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_on_comment() TO authenticated;
-- #875 — User-curated species lists
-- ====================================================

CREATE TABLE IF NOT EXISTS public.species_lists (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name_en text,
  name_es text,
  slug text NOT NULL,
  description_en text,
  description_es text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  cover_taxon_id uuid REFERENCES public.taxa(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS public.species_list_items (
  list_id uuid NOT NULL REFERENCES public.species_lists(id) ON DELETE CASCADE,
  taxon_id uuid NOT NULL REFERENCES public.taxa(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (length(note) <= 500),
  observation_id uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  PRIMARY KEY (list_id, taxon_id)
);

CREATE INDEX IF NOT EXISTS species_lists_user_idx ON public.species_lists(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS species_lists_public_idx ON public.species_lists(visibility, created_at DESC) WHERE visibility = 'public';

ALTER TABLE public.species_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.species_list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS species_lists_public_read ON public.species_lists;
CREATE POLICY species_lists_public_read ON public.species_lists FOR SELECT
  USING (visibility = 'public' OR (SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS species_lists_owner_write ON public.species_lists;
CREATE POLICY species_lists_owner_write ON public.species_lists FOR ALL
  TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS species_list_items_read ON public.species_list_items;
CREATE POLICY species_list_items_read ON public.species_list_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.species_lists sl
    WHERE sl.id = list_id
      AND (sl.visibility = 'public' OR (SELECT auth.uid()) = sl.user_id)
  ));

DROP POLICY IF EXISTS species_list_items_owner_write ON public.species_list_items;
CREATE POLICY species_list_items_owner_write ON public.species_list_items FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.species_lists sl WHERE sl.id = list_id AND (SELECT auth.uid()) = sl.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.species_lists sl WHERE sl.id = list_id AND (SELECT auth.uid()) = sl.user_id));

-- Slug auto-generation trigger
CREATE OR REPLACE FUNCTION public.generate_list_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_count int := 0;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug != '' THEN RETURN NEW; END IF;
  v_base := lower(regexp_replace(coalesce(NEW.name_es, NEW.name_en, 'list'), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  v_slug := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.species_lists WHERE user_id = NEW.user_id AND slug = v_slug);
    v_count := v_count + 1;
    v_slug := v_base || '-' || v_count;
  END LOOP;
  NEW.slug := v_slug;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_generate_list_slug ON public.species_lists;
CREATE TRIGGER tg_generate_list_slug BEFORE INSERT ON public.species_lists
  FOR EACH ROW EXECUTE FUNCTION public.generate_list_slug();

REVOKE EXECUTE ON FUNCTION public.generate_list_slug() FROM PUBLIC;

-- #868 — Weekly email digest for inactive users
-- Adds email_notifications_enabled + last_digest_sent_at
-- and a pg_cron schedule that fires hourly.
-- ====================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.users.email_notifications_enabled IS
  'When true, the user receives the weekly digest email. Toggled via
   /email-unsubscribe or the profile notifications settings page.';
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz;

COMMENT ON COLUMN public.users.last_digest_sent_at IS
  'Timestamp of the most recent weekly digest email sent to this user.';

-- pg_cron: fire every hour; the Edge Function computes the per-timezone
-- recipient set so each user receives the email at ~14:00 local time.
SELECT cron.schedule(
  'weekly-digest',
  '0 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    ),
    body    := '{}'::jsonb
  )$$
);

-- ============================================================
-- #866 — Streak freeze / skip-day mechanic
-- ============================================================

-- 1. New columns on user_streaks: available freezes (hard cap 2) + lifetime used count.
ALTER TABLE public.user_streaks
  ADD COLUMN IF NOT EXISTS streak_freezes_available smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_freezes_used      integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_freeze_last_used_at timestamptz;

COMMENT ON COLUMN public.user_streaks.streak_freezes_available IS
  'Freeze credits available to auto-consume on a missed day. Hard cap: 2.';
COMMENT ON COLUMN public.user_streaks.streak_freezes_used IS
  'Lifetime count of auto-consumed freezes (transparency / Fogg honesty).';
COMMENT ON COLUMN public.user_streaks.streak_freeze_last_used_at IS
  'Timestamp of the most recent freeze consumption — used for the freeze ledger in ProfileView.';

-- 2. Extend karma_events.reason CHECK to include streak_freeze_consumed.
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call',
    'pool_donation','pool_call_sponsor_drip',
    'streak_freeze_consumed'
  ));

-- 3. Updated recompute_streak: freeze grant on 7-day multiples + freeze consumption on miss.
CREATE OR REPLACE FUNCTION public.recompute_streak(p_user_id uuid)
RETURNS void AS $$
DECLARE
  qualifying_days date[];
  cur         integer := 0;
  longest     integer := 0;
  prev        date;
  d           date;
  last_q      date;
  uses_grace  boolean := false;
  -- freeze fields
  v_freezes_available smallint;
  v_freezes_used      integer;
  v_prev_current      integer;
  v_freeze_consumed   boolean := false;
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

  -- Read current streak row for freeze logic
  SELECT
    COALESCE(s.current_days, 0),
    COALESCE(s.streak_freezes_available, 0),
    COALESCE(s.streak_freezes_used, 0)
  INTO v_prev_current, v_freezes_available, v_freezes_used
  FROM public.user_streaks s
  WHERE s.user_id = p_user_id;

  -- If today's not in the list and yesterday was the most recent, streak is at risk.
  IF (CURRENT_DATE - last_q) > 1 THEN
    -- Missed day detected: try to consume a freeze before resetting.
    IF v_freezes_available > 0 AND v_prev_current > 0 THEN
      -- Consume one freeze: preserve cur from what we computed above (streak alive).
      -- cur is already 0 from the above traversal exit, but if the miss is TODAY
      -- we want to keep the previous streak alive; override cur with v_prev_current.
      cur := v_prev_current;
      v_freeze_consumed := true;
      -- Write audit row to karma_events (delta = 0, no karma change).
      INSERT INTO public.karma_events (user_id, delta, reason)
      VALUES (p_user_id, 0, 'streak_freeze_consumed');
    ELSE
      cur := 0;
    END IF;
  END IF;

  -- Freeze grant: if cur just crossed a 7-day boundary (cur % 7 == 0, cur > 0),
  -- award +1 freeze clamped at 2.
  IF cur > 0 AND cur % 7 = 0 THEN
    v_freezes_available := LEAST(
      (CASE WHEN v_freeze_consumed THEN v_freezes_available - 1 ELSE v_freezes_available END) + 1,
      2
    );
  ELSIF v_freeze_consumed THEN
    v_freezes_available := v_freezes_available - 1;
  END IF;

  INSERT INTO public.user_streaks (
    user_id, current_days, longest_days, last_qualifying_day,
    grace_used_at, streak_freezes_available, streak_freezes_used,
    streak_freeze_last_used_at, updated_at
  )
  VALUES (
    p_user_id, cur, GREATEST(longest, cur), last_q,
    CASE WHEN uses_grace THEN now() END,
    v_freezes_available,
    v_freezes_used + (CASE WHEN v_freeze_consumed THEN 1 ELSE 0 END),
    CASE WHEN v_freeze_consumed THEN now() END,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET current_days               = EXCLUDED.current_days,
        longest_days               = GREATEST(public.user_streaks.longest_days, EXCLUDED.current_days, EXCLUDED.longest_days),
        last_qualifying_day        = EXCLUDED.last_qualifying_day,
        grace_used_at              = EXCLUDED.grace_used_at,
        streak_freezes_available   = EXCLUDED.streak_freezes_available,
        streak_freezes_used        = public.user_streaks.streak_freezes_used + (CASE WHEN v_freeze_consumed THEN 1 ELSE 0 END),
        streak_freeze_last_used_at = CASE WHEN v_freeze_consumed THEN now() ELSE public.user_streaks.streak_freeze_last_used_at END,
        updated_at                 = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE EXECUTE ON FUNCTION public.recompute_streak(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_streak(uuid) TO service_role;

-- ============================================================
-- M03-ext — probable_taxa_cache layer (issue #803)
-- ============================================================
-- Pre-computed geohash5 × month suggestion cache.
-- Populated nightly by recompute-taxa-cache EF (03:00 UTC).
-- probable_taxa_at() checks cache first; falls through to live
-- query on cache miss (new cells, just-deployed).
-- ============================================================

-- geohash5 precision ≈ 4.9 km × 4.9 km cell — coarse enough to
-- aggregate many observations per cell, fine enough to reflect
-- local species composition.  A user's ±50 km search radius spans
-- ~100 geohash5 cells, so LIMIT 10 from the cache is fast.

CREATE TABLE IF NOT EXISTS public.probable_taxa_cache (
  geohash5    text        NOT NULL,
  month       int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  taxon_id    uuid        NOT NULL REFERENCES public.taxa(id) ON DELETE CASCADE,
  score       numeric     NOT NULL DEFAULT 0,   -- n_obs used for ordering
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (geohash5, month, taxon_id)
);

CREATE INDEX IF NOT EXISTS probable_taxa_cache_geohash5_month_score_idx
  ON public.probable_taxa_cache (geohash5, month, score DESC);

-- RLS: public read (anon may read suggestions), no direct write from clients.
ALTER TABLE public.probable_taxa_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "probable_taxa_cache: anon can read"
  ON public.probable_taxa_cache FOR SELECT
  USING (true);

-- Revoke direct writes from unprivileged roles.
REVOKE INSERT, UPDATE, DELETE ON public.probable_taxa_cache FROM anon, authenticated;
GRANT  SELECT                  ON public.probable_taxa_cache TO anon, authenticated;
GRANT  ALL                     ON public.probable_taxa_cache TO service_role;

-- ── recompute_probable_taxa_cache() ──────────────────────────────────────
-- Called by the nightly EF.  For every (geohash5, month) cell that has
-- qualifying observations, upserts the top-50 taxa by observation count.
-- Returns the total number of rows upserted.

CREATE OR REPLACE FUNCTION public.recompute_probable_taxa_cache()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  -- Delete stale entries older than 48 h so cells with zero recent obs
  -- are pruned over time.
  DELETE FROM public.probable_taxa_cache
  WHERE updated_at < now() - interval '48 hours';

  -- Recompute: for each (geohash5, month) with qualifying observations,
  -- take the top-50 taxa by count and upsert.
  WITH cells AS (
    SELECT
      ST_GeoHash(o.location::geometry, 5)            AS geohash5,
      EXTRACT(MONTH FROM o.observed_at AT TIME ZONE 'UTC')::int AS month,
      i.taxon_id,
      COUNT(*)::numeric                              AS score
    FROM public.observations o
    JOIN public.identifications i
      ON i.observation_id = o.id AND i.is_primary = true
    WHERE o.location   IS NOT NULL
      AND i.taxon_id   IS NOT NULL
      AND (i.is_research_grade = true OR o.primary_taxon_id IS NOT NULL)
    GROUP BY 1, 2, 3
  ),
  ranked AS (
    SELECT
      geohash5,
      month,
      taxon_id,
      score,
      ROW_NUMBER() OVER (PARTITION BY geohash5, month ORDER BY score DESC) AS rn
    FROM cells
  ),
  top50 AS (
    SELECT geohash5, month, taxon_id, score
    FROM ranked
    WHERE rn <= 50
  )
  INSERT INTO public.probable_taxa_cache (geohash5, month, taxon_id, score, updated_at)
  SELECT geohash5, month, taxon_id, score, now()
  FROM   top50
  ON CONFLICT (geohash5, month, taxon_id) DO UPDATE
    SET score      = EXCLUDED.score,
        updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_probable_taxa_cache() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_probable_taxa_cache() TO service_role;

-- ── Update probable_taxa_at() to check cache first ───────────────────────
-- Cache path: look up the caller's geohash5 + ±1 month window in
-- probable_taxa_cache.  On cache miss (empty result set) fall through to
-- the original live ST_DWithin query so new regions always work.

CREATE OR REPLACE FUNCTION public.probable_taxa_at(
  p_lat   numeric,
  p_lng   numeric,
  p_month int,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  taxon_id               uuid,
  scientific_name        text,
  common_name_es         text,
  common_name_en         text,
  slug                   text,
  thumbnail_url          text,
  n_obs                  int,
  last_seen_distance_km  numeric,
  has_observed_by_viewer boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_point    geography;
  v_viewer   uuid;
  v_months   int[];
  v_geohash5 text;
  v_cached   int := 0;
BEGIN
  -- Input validation (unchanged from original)
  IF p_lat IS NULL OR p_lng IS NULL OR p_month IS NULL THEN RETURN; END IF;
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN RETURN; END IF;
  IF p_month < 1 OR p_month > 12 THEN RETURN; END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 10;
  ELSIF p_limit > 50 THEN
    p_limit := 50;
  END IF;

  v_point    := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_viewer   := auth.uid();
  v_geohash5 := ST_GeoHash(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 5);

  -- Month window ±1 (wrap at year boundaries)
  v_months := ARRAY[
    ((p_month - 2 + 12) % 12) + 1,
    p_month,
    (p_month % 12) + 1
  ]::int[];

  -- ── Cache path ────────────────────────────────────────────────────────
  -- Check how many cached rows exist for this cell + month window.
  -- Neighbouring geohash5 cells are not queried here — the cache covers
  -- a ~5 km cell which is a good proxy for "what's near me" at the
  -- suggestion level.  Precise distance is not needed for chips.
  SELECT COUNT(*) INTO v_cached
  FROM public.probable_taxa_cache c
  WHERE c.geohash5 = v_geohash5
    AND c.month = ANY(v_months);

  IF v_cached > 0 THEN
    -- Cache hit: return from cache, join taxa + thumbnails for display fields.
    RETURN QUERY
    WITH agg AS (
      SELECT
        c.taxon_id,
        SUM(c.score)::int         AS n_obs,
        -- Distance from geohash cell centre to query point
        ROUND(
          (ST_Distance(
            ST_SetSRID(ST_PointFromGeoHash(v_geohash5), 4326)::geography,
            v_point
          ) / 1000.0)::numeric, 1
        )                         AS last_seen_distance_km
      FROM public.probable_taxa_cache c
      WHERE c.geohash5 = v_geohash5
        AND c.month = ANY(v_months)
      GROUP BY c.taxon_id
      ORDER BY n_obs DESC
      LIMIT p_limit
    )
    SELECT
      t.id                         AS taxon_id,
      t.scientific_name,
      t.common_name_es,
      t.common_name_en,
      t.slug,
      th.thumbnail_url,
      a.n_obs,
      a.last_seen_distance_km,
      CASE WHEN v_viewer IS NULL THEN NULL
           ELSE EXISTS (
             SELECT 1
             FROM public.observations obs2
             JOIN public.identifications i2
               ON i2.observation_id = obs2.id AND i2.is_primary = true
             WHERE obs2.observer_id = v_viewer
               AND i2.taxon_id = t.id
           )
      END                          AS has_observed_by_viewer
    FROM agg a
    JOIN public.taxa t   ON t.id = a.taxon_id
    LEFT JOIN public.taxa_thumbnails th ON th.taxon_id = t.id
    WHERE t.taxon_rank = 'species'
    ORDER BY a.n_obs DESC, a.last_seen_distance_km ASC;

    RETURN;
  END IF;

  -- ── Live fallback (cache miss) ────────────────────────────────────────
  -- Identical to the original query; runs when cache is empty for this cell.
  RETURN QUERY
  WITH nearby AS (
    SELECT
      i.taxon_id,
      ST_Distance(o.location, v_point) AS distance_m,
      o.observer_id
    FROM public.observations o
    JOIN public.identifications i
      ON i.observation_id = o.id AND i.is_primary = true
    WHERE o.location IS NOT NULL
      AND i.taxon_id IS NOT NULL
      AND ST_DWithin(o.location, v_point, 50000)
      AND EXTRACT(MONTH FROM o.observed_at AT TIME ZONE 'UTC')::int = ANY(v_months)
      AND (i.is_research_grade = true OR o.primary_taxon_id IS NOT NULL)
  ),
  ranked AS (
    SELECT
      n.taxon_id,
      COUNT(*)::int                  AS n_obs,
      MIN(n.distance_m) / 1000.0     AS last_seen_distance_km,
      bool_or(n.observer_id = v_viewer) AS observed_by_viewer
    FROM nearby n
    GROUP BY n.taxon_id
    ORDER BY COUNT(*) DESC, MIN(n.distance_m) ASC
    LIMIT p_limit
  )
  SELECT
    t.id                        AS taxon_id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.slug,
    th.thumbnail_url,
    r.n_obs,
    ROUND(r.last_seen_distance_km::numeric, 1) AS last_seen_distance_km,
    CASE WHEN v_viewer IS NULL THEN NULL ELSE COALESCE(r.observed_by_viewer, false) END
                                AS has_observed_by_viewer
  FROM ranked r
  JOIN public.taxa t   ON t.id = r.taxon_id
  LEFT JOIN public.taxa_thumbnails th ON th.taxon_id = t.id
  WHERE t.taxon_rank = 'species'
  ORDER BY r.n_obs DESC, r.last_seen_distance_km ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.probable_taxa_at(numeric, numeric, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.probable_taxa_at(numeric, numeric, int, int)
  TO anon, authenticated;

-- ============================================================
-- Performance indexes (issue #713)
-- ============================================================
-- Composite covering index for probable_taxa_at() hot path.
-- The function joins identifications filtered by is_primary=true
-- and taxon_id IS NOT NULL; a partial composite speeds both the
-- live query and the nightly cache-recompute.
CREATE INDEX IF NOT EXISTS idx_id_primary_taxon
  ON public.identifications (observation_id, taxon_id)
  WHERE is_primary = true AND taxon_id IS NOT NULL;

-- observations.observed_at DESC partial for synced rows — used by
-- feed queries, profile tabs, and the recompute-user-stats CTE.
CREATE INDEX IF NOT EXISTS idx_obs_synced_at
  ON public.observations (observer_id, observed_at DESC)
  WHERE sync_status = 'synced';

-- activity_events: unread notifications per target user (bell badge).
CREATE INDEX IF NOT EXISTS idx_activity_target_unread
  ON public.activity_events (target_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ============================================================
-- #550: Conservation status ETL — conservation_synced_at column
-- ============================================================
-- Add tracking column so the monthly delta job skips recently-synced rows.
ALTER TABLE public.taxa
  ADD COLUMN IF NOT EXISTS conservation_synced_at timestamptz;

-- Monthly cron: triggers the refresh-conservation-status Edge Function.
-- Runs on the 1st of each month at 03:00 UTC.
-- Requires pg_cron + pg_net extensions (already enabled in Rastrum).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh-conservation-status');
    PERFORM cron.schedule(
      'refresh-conservation-status',
      '0 3 1 * *',
      $$SELECT net.http_post(
          url    := current_setting('app.supabase_url') || '/functions/v1/refresh-conservation-status',
          headers := json_build_object('x-cron-secret', current_setting('app.cron_secret'))::jsonb,
          body   := '{}'::jsonb
      )$$
    );
  END IF;
END $$;

-- ============================================================
-- #551: Wire conservation multipliers into award_karma()
-- ============================================================
-- Extends karma_events with a conservation_source column so the admin
-- Karma view can surface which classification drove the bonus.
ALTER TABLE public.karma_events
  ADD COLUMN IF NOT EXISTS conservation_source text;

-- Extend reason CHECK to include conservation_win (for future targeted queries).
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call',
    'pool_donation','pool_call_sponsor_drip',
    'streak_freeze_consumed'
  ));

-- Replace award_karma() with conservation-multiplier-aware version.
CREATE OR REPLACE FUNCTION public.award_karma(
  p_user_id        uuid,
  p_observation_id uuid,
  p_taxon_id       uuid,
  p_outcome        text,
  p_confidence     numeric DEFAULT 0.7
)
RETURNS numeric AS $$
DECLARE
  v_rarity              public.taxon_rarity;
  v_obs_path            uuid[];
  v_matched_taxon       uuid;
  v_matched_rank        integer;
  v_streak_mult         numeric := 1.0;
  v_expertise_mult      numeric := 1.0;
  v_conf_factor         numeric;
  v_grace               boolean;
  v_user                public.users;
  v_delta               numeric;
  v_penalty_rarity      numeric;
  v_conservation_mult   numeric := 1.0;
  v_conservation_source text    := null;
  v_iucn                text;
  v_nom059              text;
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

  -- Conservation multiplier (#551): higher of IUCN vs NOM-059 wins.
  SELECT iucn_category, nom059_status
    INTO v_iucn, v_nom059
    FROM public.taxa
   WHERE id = p_taxon_id;

  DECLARE
    v_iucn_mult  numeric := 1.0;
    v_nom_mult   numeric := 1.0;
  BEGIN
    v_iucn_mult := CASE v_iucn
      WHEN 'EW' THEN 5.0
      WHEN 'CR' THEN 3.0
      WHEN 'EN' THEN 2.0
      WHEN 'VU' THEN 1.5
      WHEN 'NT' THEN 1.2
      WHEN 'DD' THEN 1.5
      ELSE 1.0
    END;
    v_nom_mult := CASE v_nom059
      WHEN 'E'  THEN 4.0
      WHEN 'P'  THEN 2.5
      WHEN 'A'  THEN 1.8
      WHEN 'Pr' THEN 1.3
      ELSE 1.0
    END;
    IF v_nom_mult > v_iucn_mult THEN
      v_conservation_mult   := v_nom_mult;
      v_conservation_source := 'NOM-059 ' || v_nom059;
    ELSIF v_iucn_mult > 1.0 THEN
      v_conservation_mult   := v_iucn_mult;
      v_conservation_source := 'IUCN ' || v_iucn;
    END IF;
  END;

  -- Delta computation.
  IF p_outcome = 'win' THEN
    v_delta := round(
      5 * v_rarity.multiplier * v_streak_mult * v_expertise_mult
        * v_conf_factor * v_conservation_mult
    );
  ELSIF p_outcome = 'loss' THEN
    IF v_grace THEN
      v_delta := 0;
    ELSE
      -- Conservation multiplier does NOT apply to loss penalty (design choice:
      -- penalising wrong IDs for rare species harder would disincentivise voting
      -- on them — noted in PR description per #551 acceptance criteria).
      v_penalty_rarity := LEAST(v_rarity.multiplier, 2.0);
      v_delta := round(-2 * v_penalty_rarity * v_conf_factor);
    END IF;
  ELSE
    RAISE EXCEPTION 'award_karma: invalid p_outcome %', p_outcome;
  END IF;

  -- Insert ledger row.
  INSERT INTO public.karma_events
    (user_id, observation_id, taxon_id, delta, reason,
     rarity_bucket, expertise_rank, conservation_source)
  VALUES
    (p_user_id, p_observation_id, p_taxon_id, v_delta,
     CASE WHEN p_outcome = 'win' THEN 'consensus_win' ELSE 'consensus_loss' END,
     v_rarity.bucket, v_matched_rank, v_conservation_source);

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
-- #558: Karma-threshold privilege gates
-- ============================================================

-- karma_thresholds table: tunable gate values without a deploy.
CREATE TABLE IF NOT EXISTS public.karma_thresholds (
  privilege       text    PRIMARY KEY,
  min_karma       numeric NOT NULL CHECK (min_karma >= 0),
  description_en  text    NOT NULL DEFAULT '',
  description_es  text    NOT NULL DEFAULT ''
);

ALTER TABLE public.karma_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS karma_thresholds_public_read ON public.karma_thresholds;
CREATE POLICY karma_thresholds_public_read ON public.karma_thresholds
  FOR SELECT USING (true);

GRANT SELECT ON public.karma_thresholds TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.karma_thresholds TO service_role;

-- Seed default thresholds (#558 acceptance criteria values).
INSERT INTO public.karma_thresholds (privilege, min_karma, description_en, description_es)
VALUES
  ('validation_suggest', 100,  'Suggest species IDs on others'' observations',
                                'Sugerir identificaciones de especie en observaciones ajenas'),
  ('observation_flag',   500,  'Flag observations for moderation',
                                'Reportar observaciones para moderación'),
  ('expert_application', 1000, 'Apply for expert status in a taxon group',
                                'Solicitar estatus de experto en un grupo taxonómico')
ON CONFLICT (privilege) DO NOTHING;

-- Helper function: check if a user has a privilege by karma.
CREATE OR REPLACE FUNCTION public.has_karma_privilege(
  p_uid       uuid,
  p_privilege text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT u.karma_total >= kt.min_karma
      FROM public.users u
      JOIN public.karma_thresholds kt ON kt.privilege = p_privilege
     WHERE u.id = p_uid
  ), false);
$$;

REVOKE EXECUTE ON FUNCTION public.has_karma_privilege(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_karma_privilege(uuid, text) TO authenticated;

-- RLS: gate validation_suggest on identifications INSERT (#558).
-- Replaces id_validator_insert with a karma-aware version.
DROP POLICY IF EXISTS "id_validator_insert" ON public.identifications;
CREATE POLICY "id_validator_insert" ON public.identifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = validated_by
    AND validated_by IS NOT NULL
    AND is_primary = false
    AND public.has_karma_privilege(auth.uid(), 'validation_suggest')
    AND EXISTS (
      SELECT 1 FROM public.observations o
      WHERE o.id = observation_id
        AND o.observer_id <> validated_by
        AND o.sync_status = 'synced'
        AND o.obscure_level IN ('none','0.1deg','0.2deg','5km')
    )
  );

-- RLS: gate observation_flag on reports INSERT (#558).
DROP POLICY IF EXISTS reports_owner_write ON public.reports;
CREATE POLICY reports_owner_write ON public.reports FOR INSERT
  WITH CHECK (
    reporter_id = auth.uid()
    AND public.has_karma_privilege(auth.uid(), 'observation_flag')
  );

-- RLS: gate expert_application on expert_applications INSERT (#558).
DROP POLICY IF EXISTS "expert_apps_insert_own" ON public.expert_applications;
CREATE POLICY "expert_apps_insert_own" ON public.expert_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_karma_privilege(auth.uid(), 'expert_application')
  );


-- #932: one-time backfill of rarity_tier from observation counts
-- Run: node scripts/backfill-rarity-tier.mjs
-- After backfill, nightly recompute via recompute-taxa-cache EF
COMMENT ON COLUMN public.taxa.rarity_tier IS '1=common(101+obs), 2=uncommon(21-100), 3=rare(6-20), 4=very_rare(1-5), NULL=no_obs';

-- ============================================================
-- v1.5: Biodiversity Trails (#191)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trails (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  name_es text,
  creator_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- waypoints: [{lat, lng, name, obs_count}]
  waypoints jsonb NOT NULL DEFAULT '[]',
  total_species int NOT NULL DEFAULT 0,
  total_observations int NOT NULL DEFAULT 0,
  distance_km numeric,
  visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trails ENABLE ROW LEVEL SECURITY;

-- Public trails are readable by anyone; owner can always read their own
CREATE POLICY trails_public_read ON public.trails
  FOR SELECT
  USING (visibility = 'public' OR (SELECT auth.uid()) = creator_id);

-- Owners can insert/update/delete their own trails
CREATE POLICY trails_owner_write ON public.trails
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = creator_id)
  WITH CHECK ((SELECT auth.uid()) = creator_id);

-- ============================================================
-- v1.5: PITs — Puntos de Información Territorial (#193)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_es text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  qr_payload text NOT NULL,
  trail_id uuid REFERENCES public.trails(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pits ENABLE ROW LEVEL SECURITY;

-- PITs are publicly readable (they link to public QR codes)
CREATE POLICY pits_public_read ON public.pits
  FOR SELECT
  USING (true);

-- Only authenticated users can create/manage PITs (future: karma gate)
CREATE POLICY pits_authenticated_write ON public.pits
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
-- #869: Birthday Naturalist badge — user-supplied birthday (month+day), private by default.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS birthday date NULL;

-- Allow self-write for birthday field.
GRANT UPDATE (birthday) ON public.users TO authenticated;

-- #869: Birthday Naturalist — fires on the user's birthday when they have ≥1 obs today.
CREATE OR REPLACE FUNCTION public.badge_eligible_birthday_observation(p_user_id uuid DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT u.id
      FROM public.users u
     WHERE u.birthday IS NOT NULL
       AND EXTRACT(MONTH FROM (now() AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date) = EXTRACT(MONTH FROM u.birthday)
       AND EXTRACT(DAY   FROM (now() AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date) = EXTRACT(DAY   FROM u.birthday)
       AND EXISTS (
         SELECT 1 FROM public.observations o
          WHERE o.observer_id = u.id
            AND o.sync_status = 'synced'
            AND (o.observed_at AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date
                = (now() AT TIME ZONE COALESCE(u.timezone, 'UTC'))::date
       )
       AND (p_user_id IS NULL OR u.id = p_user_id);
END
$$;

REVOKE EXECUTE ON FUNCTION public.badge_eligible_birthday_observation(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.badge_eligible_birthday_observation(uuid) TO service_role;

-- #735: INSTITUTIONAL ENDORSEMENT BADGES
-- Known institutions (seed data for the 20 most likely in Mexico)
CREATE TABLE IF NOT EXISTS public.institutions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_name  text NOT NULL UNIQUE,           -- 'CONANP', 'CONABIO', etc.
  long_name   text NOT NULL,
  logo_url    text,
  country     text NOT NULL DEFAULT 'MX',
  kind        text NOT NULL DEFAULT 'gov'
                CHECK (kind IN ('gov','academic','ngo','research')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin-verified institutional affiliations for experts
CREATE TABLE IF NOT EXISTS public.institutional_affiliations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  institution_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  role              text,                     -- 'Investigador', 'Técnico', etc.
  valid_from        date,
  valid_to          date,                     -- NULL means currently active
  verified_by_admin uuid REFERENCES public.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, institution_id)
);
CREATE INDEX IF NOT EXISTS idx_inst_affiliations_user
  ON public.institutional_affiliations(user_id);
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutional_affiliations ENABLE ROW LEVEL SECURITY;

-- Institutions are publicly readable
DROP POLICY IF EXISTS "institutions_public_read" ON public.institutions;
CREATE POLICY "institutions_public_read" ON public.institutions
  FOR SELECT USING (true);

-- Affiliations readable by everyone (institutional credibility is public)
DROP POLICY IF EXISTS "affiliations_public_read" ON public.institutional_affiliations;
CREATE POLICY "affiliations_public_read" ON public.institutional_affiliations
  FOR SELECT USING (true);

GRANT SELECT ON public.institutions TO authenticated, anon;
GRANT SELECT ON public.institutional_affiliations TO authenticated, anon;
-- Only service_role can insert/update (admin-verified flow)
GRANT INSERT, UPDATE, DELETE ON public.institutions TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.institutional_affiliations TO service_role;

-- Seed: 20 most common Mexican institutions in biodiversity research
INSERT INTO public.institutions (short_name, long_name, kind) VALUES
  ('CONANP',  'Comisión Nacional de Áreas Naturales Protegidas',  'gov'),
  ('CONABIO', 'Comisión Nacional para el Conocimiento y Uso de la Biodiversidad', 'gov'),
  ('UNAM',    'Universidad Nacional Autónoma de México',          'academic'),
  ('INECOL',  'Instituto de Ecología, A.C.',                      'research'),
  ('INE',     'Instituto Nacional de Ecología',                   'gov'),
  ('IPN',     'Instituto Politécnico Nacional',                   'academic'),
  ('IIB',     'Instituto de Investigaciones Biomédicas, UNAM',    'research'),
  ('IBUNAM',  'Instituto de Biología, UNAM',                      'research'),
  ('UAM',     'Universidad Autónoma Metropolitana',               'academic'),
  ('ECOSUR',  'El Colegio de la Frontera Sur',                    'research'),
  ('CICY',    'Centro de Investigación Científica de Yucatán',    'research'),
  ('CIBNOR',  'Centro de Investigaciones Biológicas del Noroeste','research'),
  ('ENCB-IPN','Escuela Nacional de Ciencias Biológicas, IPN',     'academic'),
  ('WWF-MX',  'WWF México',                                       'ngo'),
  ('PRONATURA','Pronatura México',                                 'ngo'),
  ('GEMA',    'Grupo de Ecología y Conservación de Islas',        'ngo'),
  ('CEDES',   'Centro Ecológico de Sonora',                       'gov'),
  ('UAC',     'Universidad Autónoma de Campeche',                 'academic'),
  ('UJAT',    'Universidad Juárez Autónoma de Tabasco',           'academic'),
  ('UASLP',   'Universidad Autónoma de San Luis Potosí',          'academic')
ON CONFLICT (short_name) DO NOTHING;

-- Helper view: active affiliations with institution details for a user
CREATE OR REPLACE VIEW public.user_active_affiliations AS
  SELECT
    ia.user_id,
    i.short_name   AS institution_short,
    i.long_name    AS institution_long,
    i.logo_url,
    i.kind,
    ia.role,
    ia.verified_by_admin IS NOT NULL AS is_verified
  FROM public.institutional_affiliations ia
  JOIN public.institutions i ON i.id = ia.institution_id
  WHERE ia.valid_to IS NULL OR ia.valid_to > CURRENT_DATE;

GRANT SELECT ON public.user_active_affiliations TO authenticated, anon;
-- #734: WEEKLY EXPERT-ID LOTTERY (Principle of Reciprocity)
-- Ledger of weekly lottery winners
CREATE TABLE IF NOT EXISTS public.weekly_validator_rewards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_iso      text NOT NULL,                    -- e.g. '2026-W20'
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.observations(id) ON DELETE SET NULL,
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  UNIQUE (week_iso, user_id)
CREATE INDEX IF NOT EXISTS idx_weekly_validator_rewards_user
  ON public.weekly_validator_rewards(user_id, awarded_at DESC);
ALTER TABLE public.weekly_validator_rewards ENABLE ROW LEVEL SECURITY;
-- Users can read their own rewards
DROP POLICY IF EXISTS "validator_rewards_self_read" ON public.weekly_validator_rewards;
CREATE POLICY "validator_rewards_self_read" ON public.weekly_validator_rewards
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT SELECT ON public.weekly_validator_rewards TO authenticated;

-- Extend karma_events.reason CHECK to include lottery win
-- (applied via ALTER TABLE; the original CREATE TABLE definition can't be
--  retroactively changed without a migration, so we add a constraint here)
ALTER TABLE public.karma_events
  DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events
  ADD CONSTRAINT karma_events_reason_check CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'expert_id_lottery_win'
  ));

-- pg_cron: run weekly-expert-lottery every Sunday at 18:00 UTC
-- SELECT cron.schedule('weekly-expert-lottery','0 18 * * 0',
--   $$SELECT net.http_post(url:=current_setting('app.supabase_functions_url') || '/weekly-expert-lottery',
--     headers:='{"x-cron-secret":"<secret>"}'::jsonb)$$);

-- ============================================================
-- #748: OBSERVADOR DEL MES (Principle of Recognition)
-- ============================================================

-- Featured observer per calendar month (admin-selectable or auto-picked)
CREATE TABLE IF NOT EXISTS public.featured_observers (
  month_date     date NOT NULL PRIMARY KEY,   -- first day of month, e.g. 2026-05-01
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  headline_es    text,                         -- blurb in Spanish
  headline_en    text,                         -- blurb in English
  custom_photo_url text,                       -- override avatar for the feature
  picked_by_admin uuid REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.featured_observers ENABLE ROW LEVEL SECURITY;

-- Publicly readable
DROP POLICY IF EXISTS "featured_observers_public_read" ON public.featured_observers;
CREATE POLICY "featured_observers_public_read" ON public.featured_observers
  FOR SELECT USING (true);

GRANT SELECT ON public.featured_observers TO authenticated, anon;
-- Only service_role (admin console) can insert/update
GRANT INSERT, UPDATE, DELETE ON public.featured_observers TO service_role;

-- ============================================================
-- #802: GBIF OPTION B REGIONAL BASELINE (Credibility + Reduction)
-- ============================================================

-- Per-region, per-kingdom/taxon baseline from GBIF
CREATE TABLE IF NOT EXISTS public.regional_taxa_baseline (
  id                  bigserial PRIMARY KEY,
  region_code         text NOT NULL,             -- ISO country code, e.g. 'MX'
  kingdom             text NOT NULL,             -- 'Plantae', 'Animalia', 'Fungi'
  gbif_kingdom_key    integer,
  taxon_id            uuid REFERENCES public.taxa(id) ON DELETE SET NULL,
  gbif_species_key    integer,
  occurrence_count    bigint NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'gbif_occurrence_api',
  source_dataset_doi  text,
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (region_code, kingdom)
);

CREATE INDEX IF NOT EXISTS idx_regional_baseline_region
  ON public.regional_taxa_baseline(region_code);
CREATE INDEX IF NOT EXISTS idx_regional_baseline_taxon
  ON public.regional_taxa_baseline(taxon_id)
  WHERE taxon_id IS NOT NULL;

ALTER TABLE public.regional_taxa_baseline ENABLE ROW LEVEL SECURITY;

-- Publicly readable (GBIF data is CC BY 4.0)
DROP POLICY IF EXISTS "regional_baseline_public_read" ON public.regional_taxa_baseline;
CREATE POLICY "regional_baseline_public_read" ON public.regional_taxa_baseline
  FOR SELECT USING (true);

GRANT SELECT ON public.regional_taxa_baseline TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.regional_taxa_baseline TO service_role;

-- Update falta-dex Pokédex disclaimer copy on PokedexView.astro to note GBIF.
-- The p_baseline_source parameter is added to profile_pokedex_with_missing()
-- as a no-op alias in this migration — full GBIF JOIN comes in v1.2 once the
-- per-species download job populates taxon_id rows.
COMMENT ON TABLE public.regional_taxa_baseline IS
  '#802 GBIF Option B baseline for falta-dex. Nightly ETL via sync-gbif-regional-baseline EF. '
  'v1.1: kingdom-level occurrence counts. v1.2: per-species rows via GBIF download API.';

-- pg_cron: nightly sync at 03:00 UTC
-- SELECT cron.schedule('sync-gbif-regional-baseline','0 3 * * *',
--   $$SELECT net.http_post(url:=current_setting('app.supabase_functions_url') || '/sync-gbif-regional-baseline',
--     headers:='{"x-cron-secret":"<secret>"}'::jsonb)$$);

-- ============================================================
-- #725: RASTRUM WRAPPED (Principle of Self-Monitoring)
-- ============================================================

-- Cache table for annual Wrapped stats
CREATE TABLE IF NOT EXISTS public.wrapped_cache (
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  year         smallint NOT NULL CHECK (year BETWEEN 2020 AND 2099),
  payload      jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, year)
);

ALTER TABLE public.wrapped_cache ENABLE ROW LEVEL SECURITY;

-- Users can read their own Wrapped
DROP POLICY IF EXISTS "wrapped_cache_self_read" ON public.wrapped_cache;
CREATE POLICY "wrapped_cache_self_read" ON public.wrapped_cache
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT SELECT ON public.wrapped_cache TO authenticated;
-- generate-wrapped EF uses service_role to upsert
GRANT INSERT, UPDATE, DELETE ON public.wrapped_cache TO service_role;

-- ============================================================
-- #806: DWC_EXPORT_LOG (Per-export audit log for DwC archives)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dwc_export_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exported_at timestamptz NOT NULL DEFAULT now(),
  observation_count int NOT NULL DEFAULT 0,
  file_size_bytes bigint,
  format text NOT NULL DEFAULT 'dwca' CHECK (format IN ('dwca','csv','json')),
  triggered_by text NOT NULL DEFAULT 'user' CHECK (triggered_by IN ('user','api','gbif_sync','cron'))
);

CREATE INDEX IF NOT EXISTS dwc_export_log_user_idx ON public.dwc_export_log(user_id, exported_at DESC);

ALTER TABLE public.dwc_export_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dwc_export_log_owner_read ON public.dwc_export_log;
CREATE POLICY dwc_export_log_owner_read ON public.dwc_export_log FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS dwc_export_log_service_insert ON public.dwc_export_log;
CREATE POLICY dwc_export_log_service_insert ON public.dwc_export_log FOR INSERT
  TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT ON public.dwc_export_log TO authenticated;
GRANT INSERT, UPDATE, SELECT ON public.dwc_export_log TO service_role;

COMMENT ON TABLE public.dwc_export_log IS
  '#806 Per-export audit log for DwC archives. Each row represents one export job. '
  'user_id is the observer whose records were included. For full-corpus exports '
  '(service_role), one row is inserted per unique observer_id in the archive.';

-- ============================================================
-- #811: COMMUNITY_THEMES (Community-submitted seasonal themes)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.community_themes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name_es text NOT NULL,
  name_en text NOT NULL,
  slug text UNIQUE NOT NULL,
  accent_color text NOT NULL CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  bg_gradient_from text NOT NULL CHECK (bg_gradient_from ~ '^#[0-9a-fA-F]{6}$'),
  bg_gradient_to text NOT NULL CHECK (bg_gradient_to ~ '^#[0-9a-fA-F]{6}$'),
  region text,
  active_months int[] CHECK (array_length(active_months,1) BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  votes int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_themes_status_idx ON public.community_themes(status);
CREATE INDEX IF NOT EXISTS community_themes_creator_idx ON public.community_themes(creator_id);

ALTER TABLE public.community_themes ENABLE ROW LEVEL SECURITY;

-- Public read: approved themes only
DROP POLICY IF EXISTS community_themes_public_read ON public.community_themes;
CREATE POLICY community_themes_public_read ON public.community_themes FOR SELECT USING (status = 'approved');

-- Author can read their own (any status)
DROP POLICY IF EXISTS community_themes_self_read ON public.community_themes;
CREATE POLICY community_themes_self_read ON public.community_themes FOR SELECT
  USING ((SELECT auth.uid()) = creator_id);

-- Authenticated users can submit (INSERT) their own themes
DROP POLICY IF EXISTS community_themes_owner_write ON public.community_themes;
CREATE POLICY community_themes_owner_write ON public.community_themes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = creator_id);

GRANT SELECT ON public.community_themes TO anon;
GRANT SELECT, INSERT ON public.community_themes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_themes TO service_role;

COMMENT ON TABLE public.community_themes IS
  '#811 Community-submitted seasonal themes. status=approved themes surface '
  'in SeasonalThemePicker. Moderation via admin console.';

-- ============================================================
-- #713: PERFORMANCE — Materialized Views
-- ============================================================

-- Pre-computed per-user observation aggregates.
-- Avoids expensive live COUNT(*) / COUNT(DISTINCT taxon_id) on profile pages.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_user_observation_counts AS
  SELECT
    observer_id,
    COUNT(*) AS total,
    COUNT(DISTINCT taxon_id) AS species_count,
    MAX(observed_at) AS last_observed_at
  FROM public.observations
  WHERE sync_status = 'synced'
  GROUP BY observer_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_user_obs_counts_idx
  ON public.mv_user_observation_counts(observer_id);

-- Pre-computed recent-species activity (last 30 days).
-- Avoids a full-table scan on the explore / trending-species page.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_recent_species AS
  SELECT
    taxon_id,
    COUNT(*) AS recent_count,
    MAX(observed_at) AS last_seen
  FROM public.observations
  WHERE sync_status = 'synced'
    AND observed_at > now() - interval '30 days'
  GROUP BY taxon_id
  ORDER BY recent_count DESC;

CREATE UNIQUE INDEX IF NOT EXISTS mv_recent_species_idx
  ON public.mv_recent_species(taxon_id);

-- Access grants (read-only for all authenticated + anon users)
GRANT SELECT ON public.mv_user_observation_counts TO authenticated, anon;
GRANT SELECT ON public.mv_recent_species TO authenticated, anon;

COMMENT ON MATERIALIZED VIEW public.mv_user_observation_counts IS
  '#713 Perf: refreshed by recompute-user-stats EF. Replaces live COUNT() on profile pages.';
COMMENT ON MATERIALIZED VIEW public.mv_recent_species IS
  '#713 Perf: refreshed by recompute-user-stats EF. Drives trending species on explore page.';
