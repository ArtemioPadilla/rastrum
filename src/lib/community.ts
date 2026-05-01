/**
 * Community discovery query client.
 *
 * Reads `community_observers` (anon-safe) for the default list.
 * Switches to `community_observers_with_centroid` (auth-only) +
 * `community_observers_nearby(...)` RPC when filters.nearby is set.
 *
 * The Nearby RPC is the only viable path because PostgREST does not
 * expose `<->` / `ST_DWithin` directly. The RPC reads the centroid
 * view, so the SQL-layer authentication gate (no GRANT to anon)
 * fires regardless of the UI sign-in check.
 */
import { getSupabase } from './supabase';
import type { CommunityFilters, CommunitySort } from './community-url';

export interface CommunityObserver {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string | null;
  expert_taxa: string[] | null;
  is_expert: boolean;
  observation_count: number;
  species_count: number;
  obs_count_7d: number;
  obs_count_30d: number;
  last_observation_at: string | null;
  joined_at: string;
}

export const COMMUNITY_PAGE_SIZE = 20;

/**
 * Build a public-profile URL for a community observer card.
 *
 * The canonical public profile route is `/{lang}/u/?username=<handle>`
 * (querystring), NOT `/{lang}/u/<handle>/` (path segment) — the
 * path-segment form 404s in production. See PR #72 for the prior
 * regression on PublicProfileViewV2; this regressed in CommunityCard
 * + CommunityView's renderRow before being caught by user feedback.
 */
export function publicProfileHref(profileBase: string, handle: string): string {
  return `${profileBase}/?username=${encodeURIComponent(handle)}`;
}

function sortColumn(s: CommunitySort): string {
  // Nearby uses ORDER BY distance in SQL; the view query falls back
  // to observation_count for the (rare) case the caller asks for
  // distance without nearby=true.
  return s === 'distance' ? 'observation_count' : s;
}

export async function loadCommunity(filters: CommunityFilters): Promise<{
  rows: CommunityObserver[];
  total: number;
}> {
  if (filters.nearby) return loadCommunityNearby(filters);

  const supabase = getSupabase();
  let q = supabase
    .from('community_observers')
    .select('*', { count: 'exact' });

  if (filters.country)         q = q.eq('country_code', filters.country);
  if (filters.experts)         q = q.eq('is_expert', true);
  if (filters.taxa.length > 0) q = q.contains('expert_taxa', filters.taxa);

  q = q.order(sortColumn(filters.sort), { ascending: false, nullsFirst: false });

  const from = (filters.page - 1) * COMMUNITY_PAGE_SIZE;
  const to = from + COMMUNITY_PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: (data ?? []) as CommunityObserver[],
    total: count ?? 0,
  };
}

async function loadCommunityNearby(filters: CommunityFilters): Promise<{
  rows: CommunityObserver[];
  total: number;
}> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('community_observers_nearby', {
    p_radius_m: 200_000,
    p_limit: COMMUNITY_PAGE_SIZE,
    p_offset: (filters.page - 1) * COMMUNITY_PAGE_SIZE,
    p_country: filters.country,
    p_taxa: filters.taxa.length > 0 ? filters.taxa : null,
    p_experts: filters.experts,
  });
  if (error) throw error;
  const rows = (data ?? []) as CommunityObserver[];
  return { rows, total: rows.length };
}

/**
 * GPS-based Nearby — calls community_observers_nearby_at(lat, lng).
 * Coords come from navigator.geolocation; never persisted server-side.
 * Same auth gate as the centroid path (RPC reads the auth-only view).
 */
export async function loadCommunityNearbyAt(
  filters: CommunityFilters,
  lat: number,
  lng: number,
): Promise<{ rows: CommunityObserver[]; total: number }> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('community_observers_nearby_at', {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: 200_000,
    p_limit: COMMUNITY_PAGE_SIZE,
    p_offset: (filters.page - 1) * COMMUNITY_PAGE_SIZE,
    p_country: filters.country,
    p_taxa: filters.taxa.length > 0 ? filters.taxa : null,
    p_experts: filters.experts,
  });
  if (error) throw error;
  const rows = (data ?? []) as CommunityObserver[];
  return { rows, total: rows.length };
}

/**
 * Fetch the viewer's own centroid from the auth-only view, used to
 * decide whether to render the "log an observation" empty state vs
 * a meaningful Nearby list.
 *
 * Returns false when the viewer is anonymous (the centroid view is
 * not granted to anon), or has no observations yet.
 */
export async function viewerHasCentroid(): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('community_observers_with_centroid')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  return data != null;
}

/**
 * Viewer metadata used by the empty-state explainer + country CTA.
 * Returns nulls in unconfigured / anon envs — non-fatal.
 */
export interface ViewerCommunityMeta {
  signedIn: boolean;
  profilePublic: boolean | null;
  countryCode: string | null;
}

export async function loadViewerCommunityMeta(): Promise<ViewerCommunityMeta> {
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { signedIn: false, profilePublic: null, countryCode: null };
    // TODO(#251): migrate to profile_privacy matrix check (v1.1)
    const { data } = await supabase
      .from('users')
      .select('profile_public, country_code')
      .eq('id', user.id)
      .maybeSingle();
    return {
      signedIn: true,
      profilePublic: (data?.profile_public as boolean | undefined) ?? null,
      countryCode: (data?.country_code as string | null | undefined) ?? null,
    };
  } catch {
    return { signedIn: false, profilePublic: null, countryCode: null };
  }
}

export interface IsoCountry {
  code: string;
  name: string;
}

export async function loadIsoCountries(lang: 'en' | 'es'): Promise<IsoCountry[]> {
  const supabase = getSupabase();
  const col = lang === 'es' ? 'name_es' : 'name_en';
  const { data, error } = await supabase
    .from('iso_countries')
    .select(`code, ${col}`)
    .order(col, { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, string>>).map((row) => ({
    code: row.code,
    name: row[col],
  }));
}
