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

export type IDSource =
  | 'plantnet'
  | 'claude_haiku'
  | 'claude_sonnet'
  | 'onnx_offline'
  | 'human';

export type SyncStatus = 'pending' | 'synced' | 'error';

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

/** Profile row as stored in public.users. */
export interface UserProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  preferredLang: 'es' | 'en' | 'zap' | 'mix' | 'nah' | 'myn' | 'tzo' | 'tze';
  isExpert: boolean;
  expertTaxa: string[] | null;
  observerLicense: 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0';
  observationCount: number;
  createdAt: string;
  updatedAt: string;
}
