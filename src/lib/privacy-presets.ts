/**
 * Module 25 — privacy preset definitions and detection helper.
 *
 * Pure TypeScript: no DOM, no Supabase. Imported by PrivacyMatrix.astro
 * for runtime preset application + by privacy-presets.test.ts for the
 * unit suite. Keep this module side-effect-free so the test runner
 * doesn't pull in browser globals.
 */

export type PrivacyLevel = 'public' | 'signed_in' | 'private';

export type PrivacyFacetKey =
  | 'profile'
  | 'real_name'
  | 'bio'
  | 'location'
  | 'stats_counts'
  | 'observation_map'
  | 'calendar_heatmap'
  | 'taxonomic_donut'
  | 'top_species'
  | 'streak'
  | 'badges'
  | 'activity_feed'
  | 'validation_rep'
  | 'obs_list'
  | 'watchlist'
  | 'goals'
  | 'karma_total'
  | 'expertise'
  | 'pokedex';

export type PrivacyMatrix = Record<PrivacyFacetKey, PrivacyLevel>;

export type PresetKey = 'open_scientist' | 'researcher' | 'private_observer';

export const FACET_KEYS: PrivacyFacetKey[] = [
  'profile', 'real_name', 'bio', 'location',
  'stats_counts', 'observation_map', 'calendar_heatmap', 'taxonomic_donut',
  'top_species', 'streak', 'badges', 'activity_feed',
  'validation_rep', 'obs_list', 'watchlist', 'goals',
  'karma_total', 'expertise', 'pokedex',
];

/**
 * Default matrix (also the JSONB default in supabase-schema.sql).
 * Single source of truth for the SQL DEFAULT and the client default.
 */
export const DEFAULT_MATRIX: PrivacyMatrix = {
  profile:          'public',
  real_name:        'signed_in',
  bio:              'public',
  location:         'signed_in',
  stats_counts:     'public',
  observation_map:  'public',
  calendar_heatmap: 'public',
  taxonomic_donut:  'public',
  top_species:      'public',
  streak:           'signed_in',
  badges:           'public',
  activity_feed:    'signed_in',
  validation_rep:   'public',
  obs_list:         'public',
  watchlist:        'private',
  goals:            'private',
  karma_total:      'public',
  expertise:        'public',
  pokedex:          'public',
};

const OPEN_SCIENTIST: PrivacyMatrix = {
  profile:          'public',
  real_name:        'public',
  bio:              'public',
  location:         'public',
  stats_counts:     'public',
  observation_map:  'public',
  calendar_heatmap: 'public',
  taxonomic_donut:  'public',
  top_species:      'public',
  streak:           'public',
  badges:           'public',
  activity_feed:    'public',
  validation_rep:   'public',
  obs_list:         'public',
  watchlist:        'private',
  goals:            'private',
  karma_total:      'public',
  expertise:        'public',
  pokedex:          'public',
};

const RESEARCHER: PrivacyMatrix = {
  profile:          'public',
  real_name:        'signed_in',
  bio:              'public',
  location:         'signed_in',
  stats_counts:     'public',
  observation_map:  'public',
  calendar_heatmap: 'public',
  taxonomic_donut:  'public',
  top_species:      'public',
  streak:           'signed_in',
  badges:           'public',
  activity_feed:    'signed_in',
  validation_rep:   'public',
  obs_list:         'public',
  watchlist:        'private',
  goals:            'private',
  karma_total:      'public',
  expertise:        'public',
  pokedex:          'public',
};

const PRIVATE_OBSERVER: PrivacyMatrix = {
  profile:          'signed_in',
  real_name:        'private',
  bio:              'private',
  location:         'private',
  stats_counts:     'private',
  observation_map:  'private',
  calendar_heatmap: 'private',
  taxonomic_donut:  'private',
  top_species:      'private',
  streak:           'private',
  badges:           'private',
  activity_feed:    'private',
  validation_rep:   'private',
  obs_list:         'private',
  watchlist:        'private',
  goals:            'private',
  karma_total:      'private',
  expertise:        'private',
  pokedex:          'private',
};

export const PRESETS: Record<PresetKey, PrivacyMatrix> = {
  open_scientist:   OPEN_SCIENTIST,
  researcher:       RESEARCHER,
  private_observer: PRIVATE_OBSERVER,
};

export function applyPreset(preset: PresetKey): PrivacyMatrix {
  return { ...PRESETS[preset] };
}

/**
 * Coerces a stored matrix that might miss new keys (older row from
 * before a facet was added) by filling each blank with DEFAULT_MATRIX.
 */
export function normalizeMatrix(raw: Partial<Record<string, string>> | null | undefined): PrivacyMatrix {
  const out: PrivacyMatrix = { ...DEFAULT_MATRIX };
  if (!raw) return out;
  for (const key of FACET_KEYS) {
    const v = raw[key];
    if (v === 'public' || v === 'signed_in' || v === 'private') {
      out[key] = v;
    }
  }
  return out;
}

function matricesEqual(a: PrivacyMatrix, b: PrivacyMatrix): boolean {
  for (const key of FACET_KEYS) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Detects whether a matrix matches one of the known presets exactly.
 * Returns 'custom' if it doesn't.
 */
export function detectPreset(matrix: PrivacyMatrix): PresetKey | 'custom' {
  for (const key of Object.keys(PRESETS) as PresetKey[]) {
    if (matricesEqual(matrix, PRESETS[key])) return key;
  }
  return 'custom';
}

/**
 * Nuclear option: every facet private except `profile = signed_in`,
 * so other validators can still see the account exists when reviewing
 * community votes (matches the behaviour described in the spec).
 */
export function nuclearPrivateMatrix(): PrivacyMatrix {
  return { ...PRIVATE_OBSERVER };
}
