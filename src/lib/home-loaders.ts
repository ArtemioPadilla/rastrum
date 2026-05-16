import type { SupabaseClient } from '@supabase/supabase-js';
import type { HeroInputs } from './home-hero';
import { pickCardImageUrl } from './media-url';

type Client = SupabaseClient;

export async function loadInboxCount(c: Client, userId: string): Promise<number> {
  try {
    const { count, error } = await c.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) return 0;
    return count ?? 0;
  } catch { return 0; }
}

export async function loadValidateCount(c: Client): Promise<number> {
  try {
    const { data, error } = await c.rpc('pending_validation_count');
    if (error) return 0;
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

export async function loadFaltaDexCount(c: Client): Promise<{ count: number; region: string | null }> {
  try {
    const { data, error } = await c.rpc('falta_dex_summary');
    if (error || !data || !Array.isArray(data) || data.length === 0) return { count: 0, region: null };
    const row = data[0] as { gap_count?: number; region?: string | null };
    return { count: row.gap_count ?? 0, region: row.region ?? null };
  } catch { return { count: 0, region: null }; }
}

export interface WatchlistHit {
  taxonName: string;
  distanceKm: number;
  obsId: string;
  observedAt: string;
}

// v1 deferred — no `watchlist_alerts` table or matcher RPC yet. Returning
// null lets the hero cascade fall through to the next priority. Revisit in
// v1.1 once a watchlist-match RPC ships.
export async function loadWatchlistHit(_c: Client, _userId: string): Promise<WatchlistHit | null> {
  return null;
}

export interface StreakSnap { currentDays: number; lastObsLocalDay: string | null; freezesAvailable: number; freezesUsed: number; freezeLastUsedAt: string | null; }

export async function loadStreak(c: Client, userId: string): Promise<StreakSnap | null> {
  try {
    const { data, error } = await c.from('user_streaks')
      .select('current_days, last_qualifying_day, streak_freezes_available, streak_freezes_used, streak_freeze_last_used_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      current_days: number;
      last_qualifying_day: string | null;
      streak_freezes_available: number | null;
      streak_freezes_used: number | null;
      streak_freeze_last_used_at: string | null;
    };
    return {
      currentDays: row.current_days,
      lastObsLocalDay: row.last_qualifying_day,
      freezesAvailable: row.streak_freezes_available ?? 0,
      freezesUsed: row.streak_freezes_used ?? 0,
      freezeLastUsedAt: row.streak_freeze_last_used_at ?? null,
    };
  } catch { return null; }
}

export async function loadHeroInputs(c: Client, userId: string, now: Date): Promise<HeroInputs> {
  const [streak, watchlistHit, pendingIdsCount, profile] = await Promise.all([
    loadStreak(c, userId),
    loadWatchlistHit(c, userId),
    loadValidateCount(c),
    (async () => {
      try {
        const { data } = await c.from('users')
          .select('timezone, expert_taxa')
          .eq('id', userId)
          .maybeSingle();
        return data as { timezone: string | null; expert_taxa: string[] | null } | null;
      } catch { return null; }
    })(),
  ]);
  return {
    streak,
    watchlistHit,
    pendingIdsCount,
    expertTaxonGroup: profile?.expert_taxa?.[0] ?? null,
    now,
    userTimezone: profile?.timezone ?? 'UTC',
  };
}

export interface RecentObs {
  id: string; observedAt: string; stateProvince: string | null;
  scientificName: string | null; commonName: string | null;
  photoUrl: string | null;
}

export async function loadRecent(
  c: Client,
  lang: 'en' | 'es',
  country: string | null,
): Promise<{ rows: RecentObs[]; usedLocalScope: boolean }> {
  // !inner turns the implicit LEFT JOIN into INNER JOIN, which means the
  // .eq('observer.country_code', country) actually filters parent rows.
  // Without !inner, PostgREST silently no-ops the embedded-resource filter.
  const select = `
    id, observed_at, state_province,
    observer:users!observer_id!inner(country_code),
    identifications(scientific_name, is_primary, confidence,
                    taxa(common_name_es, common_name_en)),
    media_files(url, thumbnail_url, is_primary, media_type, deleted_at)
  `;
  let usedLocalScope = false;
  let rows: RecentObs[] = [];
  if (country) {
    try {
      const { data } = await c.from('observations').select(select)
        .eq('sync_status', 'synced')
        .eq('observer.country_code', country)
        .order('observed_at', { ascending: false }).limit(3);
      // Strict 3-row threshold: if local has < 3 we fall back to global so
      // the strip stays visually balanced (3 cards) rather than mixing 1-2
      // local with global filler.
      if (data && data.length === 3) {
        usedLocalScope = true;
        rows = (data as unknown as RawObs[]).map(toRecent(lang));
      }
    } catch { /* fall through */ }
  }
  if (rows.length < 3) {
    try {
      const { data } = await c.from('observations').select(select)
        .eq('sync_status', 'synced')
        .order('observed_at', { ascending: false }).limit(3);
      rows = (data as unknown as RawObs[] ?? []).map(toRecent(lang));
      usedLocalScope = false;
    } catch { rows = []; }
  }
  return { rows, usedLocalScope };
}

interface RawObs {
  id: string; observed_at: string; state_province: string | null;
  observer: { country_code: string | null } | null;
  identifications: Array<{ scientific_name: string | null; is_primary: boolean | null; confidence: number | null; taxa: { common_name_en: string | null; common_name_es: string | null } | null }> | null;
  media_files: Array<{ url: string | null; thumbnail_url: string | null; is_primary: boolean | null; media_type: string | null; deleted_at: string | null }> | null;
}

function toRecent(lang: 'en' | 'es') {
  return (r: RawObs): RecentObs => {
    const idents = r.identifications ?? [];
    const primary = idents.find(i => i.is_primary) ?? [...idents].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const photoMedia = (r.media_files ?? []).filter(
      m => m.deleted_at == null && (!m.media_type || m.media_type === 'photo'),
    );
    const photo = pickCardImageUrl(photoMedia.find(m => m.is_primary))
      ?? pickCardImageUrl(photoMedia.find(m => pickCardImageUrl(m)))
      ?? null;
    return {
      id: r.id,
      observedAt: r.observed_at,
      stateProvince: r.state_province,
      scientificName: primary?.scientific_name ?? null,
      commonName: lang === 'es'
        ? (primary?.taxa?.common_name_es ?? primary?.taxa?.common_name_en ?? null)
        : (primary?.taxa?.common_name_en ?? primary?.taxa?.common_name_es ?? null),
      photoUrl: photo,
    };
  };
}
