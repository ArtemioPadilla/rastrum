/**
 * Seasonal + regional theme variants — issue #731.
 *
 * MX has dramatic ecological seasons that are *the* context for what users
 * observe. The theme tints chrome accents and a homepage hero illustration
 * to subtly reflect (current month, user region). All swaps go through a
 * small set of CSS variables on the `<html>` element so changes are
 * flicker-free and never trigger a layout reflow.
 *
 * Resolution order, applied by `resolveSeasonalTheme()`:
 *   1. Manual override in `localStorage[STORAGE_KEY]` (any of the 4 ids
 *      below, or `'auto'`).
 *   2. (Auto) the (now, region) lookup in `pickSeasonalTheme()`.
 *
 * Out-of-scope for v1: per-illustrator themes / community submissions /
 * sound themes (see issue #731 "Out of scope" section).
 */

export type SeasonalThemeId = 'default' | 'monarca' | 'lluvias' | 'secas';
export type SeasonalThemeChoice = SeasonalThemeId | 'auto';

/** localStorage key for the user's manual override (or `'auto'`). */
export const STORAGE_KEY = 'rastrum.theme.seasonal';

/** Region keys — MX-Centro is the v1 default; future v1.1 may extend. */
export type RegionKey = 'MX-Centro' | 'MX-Norte' | 'MX-Sur' | 'default';

const ALL_THEMES: ReadonlySet<SeasonalThemeId> = new Set([
  'default',
  'monarca',
  'lluvias',
  'secas',
]);

/**
 * Month → theme mapping for MX-Centro (the v1 default region).
 *
 * - **monarca** (Oct–Mar): the eastern monarch overwintering season — orange
 *   and amber accents.
 * - **secas** (Apr–May): late dry season — warm earth tones.
 * - **lluvias** (Jun–Sep): rainy season — deeper greens, water motif.
 *
 * Note: Oct–Mar wraps the year. The function uses month numbers (1–12, NOT
 * Date.getMonth()'s 0–11) for readability — wrap conversion at the call
 * site.
 */
const MX_CENTRO_BY_MONTH: Record<number, SeasonalThemeId> = {
  1:  'monarca',  // Jan
  2:  'monarca',  // Feb
  3:  'monarca',  // Mar — overwintering monarchs leave late Mar; theme sticks
  4:  'secas',    // Apr — peak dry
  5:  'secas',    // May — last dry month
  6:  'lluvias',  // Jun — rains start
  7:  'lluvias',  // Jul
  8:  'lluvias',  // Aug
  9:  'lluvias',  // Sep — rains end
  10: 'monarca',  // Oct — monarchs arrive
  11: 'monarca',  // Nov
  12: 'monarca',  // Dec
};

/**
 * Pick the seasonal theme for `now` in `region`. Pure / deterministic —
 * unit-tested.
 *
 * `now` defaults to `new Date()`. `region` defaults to `'MX-Centro'`. For
 * v1, `MX-Norte` and `MX-Sur` fall back to MX-Centro's mapping; we'll
 * differentiate them in v1.1 once we have eco-region data.
 */
export function pickSeasonalTheme(
  now: Date = new Date(),
  region: RegionKey = 'MX-Centro',
): SeasonalThemeId {
  const month = now.getMonth() + 1;
  switch (region) {
    case 'MX-Centro':
    case 'MX-Norte':
    case 'MX-Sur':
      return MX_CENTRO_BY_MONTH[month] ?? 'default';
    case 'default':
    default:
      return 'default';
  }
}

/**
 * Coerce arbitrary string input (e.g. from localStorage or a country code)
 * into a `RegionKey`. Anything outside the MX-* set falls through to
 * `'default'` — that keeps the `default` (emerald) theme on for non-MX
 * users in v1.
 */
export function regionFromUserProfile(input: string | null | undefined): RegionKey {
  if (!input) return 'MX-Centro';
  const upper = input.toUpperCase();
  if (upper === 'MX' || upper.startsWith('MX-CENTRO') || upper === 'CDMX') return 'MX-Centro';
  if (upper.startsWith('MX-NORTE')) return 'MX-Norte';
  if (upper.startsWith('MX-SUR'))   return 'MX-Sur';
  if (upper.startsWith('MX'))       return 'MX-Centro';
  return 'default';
}

/**
 * Read the manual override stored in localStorage. Returns `'auto'` (the
 * default) if no override is set or the value is malformed.
 */
export function readStoredChoice(storage: Pick<Storage, 'getItem'> = localStorage): SeasonalThemeChoice {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return 'auto';
    if (raw === 'auto') return 'auto';
    if (ALL_THEMES.has(raw as SeasonalThemeId)) return raw as SeasonalThemeId;
    return 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Resolve the *applied* theme by combining the stored manual override
 * with the (now, region) auto pick. Pure / unit-tested.
 */
export function resolveSeasonalTheme(opts: {
  choice: SeasonalThemeChoice;
  now?: Date;
  region?: RegionKey;
}): SeasonalThemeId {
  if (opts.choice !== 'auto') return opts.choice;
  return pickSeasonalTheme(opts.now, opts.region);
}

/**
 * Apply the theme by setting a `data-season` attribute on `<html>`. CSS
 * variables defined in BaseLayout's inline stylesheet match against
 * `[data-season=…]` so the swap is flicker-free.
 */
export function applySeasonalTheme(
  theme: SeasonalThemeId,
  doc: Pick<Document, 'documentElement'> = document,
): void {
  doc.documentElement.setAttribute('data-season', theme);
}

// ---------------------------------------------------------------------------
// #811 — Community themes
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

/** A row from the `community_themes` table (approved only for public reads). */
export interface CommunityTheme {
  id: string;
  creator_id: string | null;
  name_es: string;
  name_en: string;
  slug: string;
  accent_color: string;
  bg_gradient_from: string;
  bg_gradient_to: string;
  region: string | null;
  active_months: number[] | null;
  status: 'pending' | 'approved' | 'rejected';
  votes: number;
  created_at: string;
}

/** Validates a hex colour string — guards against CSS injection. */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Sanitise a community theme submission before INSERT.
 * Throws if any required colour field is not a valid 6-digit hex string.
 * Returns a cleaned-up object safe to pass to Supabase.
 */
export function sanitiseCommunityThemeInput(input: {
  name_es: string;
  name_en: string;
  slug: string;
  accent_color: string;
  bg_gradient_from: string;
  bg_gradient_to: string;
  region?: string | null;
  active_months?: number[] | null;
}): typeof input {
  const colorFields = ['accent_color', 'bg_gradient_from', 'bg_gradient_to'] as const;
  for (const field of colorFields) {
    if (!isValidHexColor(input[field])) {
      throw new Error(
        `Invalid color value for "${field}": must be a 6-digit hex string (e.g. #ff6b00).`,
      );
    }
  }
  // Slug: allow only lowercase alphanumeric + hyphen
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    throw new Error(`Invalid slug "${input.slug}": only lowercase letters, digits, and hyphens allowed.`);
  }
  return input;
}

/**
 * Fetch approved community themes from Supabase.
 * Results are cached in sessionStorage for 24 h to reduce API calls.
 *
 * Falls back to an empty array on any error so the UI degrades gracefully.
 */
const CT_CACHE_KEY = 'rastrum.community_themes.cache';
const CT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function loadCommunityThemes(
  supabase: SupabaseClient,
  { bypassCache = false } = {},
): Promise<CommunityTheme[]> {
  // Try cache first (browser only)
  if (!bypassCache && typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(CT_CACHE_KEY);
      if (raw) {
        const cached: { ts: number; themes: CommunityTheme[] } = JSON.parse(raw);
        if (Date.now() - cached.ts < CT_CACHE_TTL_MS) {
          return cached.themes;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const { data, error } = await supabase
    .from('community_themes')
    .select('id, creator_id, name_es, name_en, slug, accent_color, bg_gradient_from, bg_gradient_to, region, active_months, status, votes, created_at')
    .eq('status', 'approved')
    .order('votes', { ascending: false });

  if (error) {
    console.error('[seasonal-theme] loadCommunityThemes error:', error.message);
    return [];
  }

  const themes = (data ?? []) as CommunityTheme[];

  // Store in sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(CT_CACHE_KEY, JSON.stringify({ ts: Date.now(), themes }));
    } catch {
      // Ignore quota errors
    }
  }

  return themes;
}
