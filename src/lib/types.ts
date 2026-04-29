/**
 * Domain types — see docs/specs/modules/02-observation.md and
 * docs/specs/modules/04-auth.md.
 *
 * Changes here should be kept in sync with the SQL schema at
 * docs/specs/infra/supabase-schema.sql.
 */

/**
 * Discriminated union for observation ownership. Guest observations live in
 * Dexie only — the sync engine refuses to upload rows whose kind is 'guest'.
 * See docs/specs/modules/04-auth.md § Guest Mode.
 */
export type ObserverRef =
  | { kind: 'user'; id: string /* uuid, FK users.id */ }
  | { kind: 'guest'; localId: string /* local-only, never synced as-is */ };

export type HabitatType =
  | 'forest_pine_oak'
  | 'cloud_forest'
  | 'tropical_dry_forest'
  | 'riparian'
  | 'wetland'
  | 'grassland'
  | 'agricultural'
  | 'urban'
  | 'coastal'
  | 'reef'
  | 'scrubland'
  | 'cave';

export type WeatherTag =
  | 'sunny'
  | 'cloudy'
  | 'overcast'
  | 'light_rain'
  | 'heavy_rain'
  | 'fog'
  | 'storm';

export type EvidenceType =
  | 'direct_sighting' | 'track' | 'scat' | 'burrow' | 'nest'
  | 'feather' | 'bone' | 'sound' | 'camera_trap';

export type IDSource =
  | 'plantnet'
  | 'claude_haiku'
  | 'claude_sonnet'
  | 'onnx_offline'
  | 'human';

export type SyncStatus = 'pending' | 'synced' | 'error' | 'draft';

export type ObscureLevel = 'none' | '0.1deg' | '0.2deg' | '5km' | 'full';

export interface MediaFile {
  id: string;
  mediaType: 'photo' | 'audio' | 'video';
  blob?: Blob; // present in Dexie pre-upload
  url?: string; // R2 URL once uploaded
  mimeType?: string;
  sizeBytes?: number;
}

export interface Observation {
  id: string;
  observerRef: ObserverRef;
  createdAt: string; // ISO 8601 UTC

  photos: MediaFile[];
  primaryPhotoIndex: number;

  location: {
    lat: number;
    lng: number;
    accuracyM: number;
    altitudeM: number | null;
    capturedFrom: 'gps' | 'exif' | 'manual';
  };

  identification: {
    scientificName: string;
    commonNameEs: string | null;
    commonNameEn: string | null;
    taxonId: string | null;
    confidence: number;
    source: IDSource;
    status: 'pending' | 'accepted' | 'needs_review';
  };

  habitat: HabitatType | null;
  weather: WeatherTag | null;
  evidenceType: EvidenceType;
  notes: string | null;

  // Env enrichment, filled post-submission (v1.0+)
  moonPhase: string | null;
  moonIllumination: number | null;
  precipitation24hMm: number | null;
  ndviValue: number | null;
  phenologicalSeason: string | null;

  syncStatus: SyncStatus;
  syncedAt: string | null;
  appVersion: string;
  deviceOs: string | null;
}

/** Profile row as stored in public.users. Snake-cased to match Postgres. */
export interface UserProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  preferred_lang: 'es' | 'en' | 'zap' | 'mix' | 'nah' | 'myn' | 'tzo' | 'tze';
  is_expert: boolean;
  expert_taxa: string[] | null;
  observer_license: 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0';
  observation_count: number;
  profile_public: boolean;
  /** Module 25 v1.2.0: per-facet privacy matrix. JSONB column. */
  profile_privacy?: Record<string, string> | null;
  /** Module 25 v1.2.0: timestamp recorded when user dismisses the privacy intro banner. */
  dismissed_privacy_intro_at?: string | null;
  gamification_opt_in: boolean;
  streak_digest_opt_in: boolean;
  region_primary: string | null;
  /** Module 28 community discovery: ISO-3166 alpha-2. NULL if undeclared. */
  country_code?: string | null;
  /** Module 28: 'auto' if last set by recompute_user_stats; 'user' once edited via Profile → Edit. */
  country_code_source?: 'auto' | 'user';
  /** Module 28: opt-out of leaderboards + community page. Defaults false. */
  hide_from_leaderboards?: boolean;
  /** PR14: IANA timezone (e.g. 'America/Mexico_City'). NULL = treat as UTC. */
  timezone?: string | null;
  joined_at: string;
  last_observation_at: string | null;
  stats_cached_at: string | null;
  stats_json: UserStats | null;
  created_at: string;
  updated_at: string;
}

/** Stats roll-up stored in public.users.stats_json. Refreshed by Edge Function. */
export interface UserStats {
  total_observations: number;
  research_grade_count: number;
  species_count: number;
  kingdom_breakdown: { Plantae: number; Animalia: number; Fungi: number };
  first_observation_at: string | null;
  last_observation_at: string | null;
  top_families: Array<{ family: string; count: number }>;
  regions: Array<{ state_province: string; count: number }>;
  streak_days: number;
  streak_best: number;
}

/**
 * Row shape returned by the public.validation_queue view.
 * See docs/specs/modules/22-community-validation.md.
 */
export interface ValidationQueueRow {
  observation_id: string;
  observer_id: string;
  observed_at: string;
  state_province: string | null;
  habitat: string | null;
  obscure_level: 'none' | '0.1deg' | '0.2deg' | '5km' | 'full';
  primary_id_id: string | null;
  current_scientific_name: string | null;
  current_confidence: number | null;
  is_research_grade: boolean | null;
  suggestion_count: number;
  distinct_voter_count: number;
}

export type UserRole = 'admin' | 'moderator' | 'expert' | 'researcher';
export * from './types.social';
