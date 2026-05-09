import { getSupabase } from './supabase';

export interface DailyChallenge {
  taxon_id: string;
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
  kingdom: string | null;
  rarity_tier: number | null;
  thumbnail_url: string | null;
  why: string | null;
}

let _cache: { challenge: DailyChallenge | null; utcDay: string } | null = null;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchDailyChallenge(userId: string): Promise<DailyChallenge | null> {
  const day = todayUtc();
  if (_cache && _cache.utcDay === day) return _cache.challenge;
  const { data, error } = await getSupabase().rpc('daily_challenge_for_user', { p_user_id: userId });
  if (error) { _cache = { challenge: null, utcDay: day }; return null; }
  const challenge = data?.[0] ?? null;
  _cache = { challenge, utcDay: day };
  return challenge;
}
