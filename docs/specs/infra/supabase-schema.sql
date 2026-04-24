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

-- Auto-create user profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
