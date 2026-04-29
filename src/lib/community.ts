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
