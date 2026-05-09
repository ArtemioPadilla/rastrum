import { getSupabase } from './supabase';

export interface SpeciesSuggestion {
  taxon_id: string;
  scientific_name: string;
  common_name_es: string | null;
  common_name_en: string | null;
  kingdom: string | null;
  class: string | null;
  nearby_count: number;
  photo_url: string | null;
}

export async function fetchSuggestions(
  userId: string,
  lat: number,
  lng: number,
  opts?: { limit?: number; radiusKm?: number }
): Promise<SpeciesSuggestion[]> {
  const month = new Date().getMonth() + 1;
  const { data, error } = await getSupabase().rpc('suggest_nearby_species', {
    p_user_id: userId,
    p_lat: lat,
    p_lng: lng,
    p_month: month,
    p_radius_km: opts?.radiusKm ?? 50,
    p_limit: opts?.limit ?? 10,
  });
  if (error) throw error;
  return (data ?? []) as SpeciesSuggestion[];
}
