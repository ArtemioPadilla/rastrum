/**
 * Weather helpers for kairos-fire — reads recent rainfall from
 * `weather_snapshots` (populated by enrich-environment).
 *
 * Used by: kairos-fire (after_rain trigger)
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

interface WeatherSnapshotRow {
  geohash5: string;
  precipitation_mm: number;
  recorded_at: string;
}

/**
 * Return total rainfall in mm at a geohash-5 cell in the last `sinceMs`
 * milliseconds, reading from `weather_snapshots`.
 *
 * Returns null when no snapshot is available or the most recent row is
 * stale (older than 24 h).
 */
export async function getRecentRainfallMm(
  db: SupabaseClient,
  geohash5: string,
  since: Date,
): Promise<number | null> {
  const { data, error } = await db
    .from('weather_snapshots')
    .select('geohash5, precipitation_mm, recorded_at')
    .eq('geohash5', geohash5)
    .gte('recorded_at', since.toISOString())
    .order('recorded_at', { ascending: false })
    .limit(100)
    .returns<WeatherSnapshotRow[]>();

  if (error || !data || data.length === 0) return null;

  // Guard: if the most recent snapshot is stale (> 24 h old), skip silently.
  const latestAt = new Date(data[0].recorded_at).getTime();
  const now = Date.now();
  if (now - latestAt > 24 * 60 * 60 * 1_000) return null;

  return data.reduce((sum, row) => sum + (row.precipitation_mm ?? 0), 0);
}
