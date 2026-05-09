/**
 * Submit-time outlier alert for observations far from the known range
 * (issue #742, M22-range).
 *
 * The check has two pure functions and one DB-touching helper. Pure
 * functions are unit-tested; the DB helper is exercised by the form
 * integration test.
 *
 * Architectural notes:
 *  • Threshold default = 50 km. Tuned for v1: small enough to catch
 *    accidental "wrong country" submissions, large enough to ignore
 *    range-edge variance. Override via the threshold param if a future
 *    spec wants per-taxon tuning.
 *  • NULL distance = "no signal" (no range data for this taxon yet);
 *    the caller MUST treat this as "do not show modal", never as
 *    "in range".
 *  • The check is fire-and-forget for soft UX: any DB error degrades
 *    silently to "no alert". Submissions are never blocked.
 *  • Taxon resolution: scientific_name → taxa.id is best-effort. If
 *    we can't resolve, we skip the check (NULL).
 */
import { getSupabase } from './supabase';

export const DEFAULT_OUTLIER_THRESHOLD_KM = 50;

export type OutlierVerdict =
  | { kind: 'no_signal' }                        // no range data for this taxon
  | { kind: 'in_range';  distanceKm: number }   // distance ≤ threshold
  | { kind: 'outlier';   distanceKm: number };  // distance > threshold

/**
 * Pure: classify a distance against a threshold.
 * Returns 'no_signal' for NULL/undefined, 'in_range' for ≤ threshold,
 * 'outlier' for > threshold.
 */
export function classifyOutlier(
  distanceKm: number | null | undefined,
  thresholdKm: number = DEFAULT_OUTLIER_THRESHOLD_KM,
): OutlierVerdict {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) {
    return { kind: 'no_signal' };
  }
  if (distanceKm <= thresholdKm) return { kind: 'in_range', distanceKm };
  return { kind: 'outlier', distanceKm };
}

/**
 * Pure: format the distance for display in the modal copy. Rounds to
 * the nearest 10 km for distances ≥ 100 km (avoids false precision
 * like "3,419.27 km"); otherwise rounds to the nearest km.
 */
export function formatDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return '0';
  if (distanceKm >= 100) {
    return String(Math.round(distanceKm / 10) * 10);
  }
  return String(Math.round(distanceKm));
}

/**
 * Best-effort taxon-id lookup by exact `scientific_name` match. Returns
 * NULL on any failure (RLS, network, no row). Callers must treat NULL
 * as "skip the check", not as an error.
 */
export async function resolveTaxonIdByName(scientificName: string): Promise<string | null> {
  if (!scientificName || !scientificName.trim()) return null;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('taxa')
      .select('id')
      .eq('scientific_name', scientificName.trim())
      .maybeSingle();
    const row = data as { id?: string } | null;
    return typeof row?.id === 'string' ? row.id : null;
  } catch {
    return null;
  }
}

/**
 * Distance from `(lat, lng)` to the nearest edge of the taxon's known
 * range (km), via the `taxon_range_distance_km(uuid, numeric, numeric)`
 * RPC. Returns NULL when the taxon has no range data yet, when the RPC
 * fails (e.g., schema not yet applied), or when inputs are invalid.
 */
export async function fetchTaxonRangeDistanceKm(
  taxonId: string,
  lat: number,
  lng: number,
): Promise<number | null> {
  if (!taxonId) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('taxon_range_distance_km', {
      p_taxon_id: taxonId,
      p_lat: lat,
      p_lng: lng,
    });
    if (error) return null;
    const n = typeof data === 'number' ? data : Number(data);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * One-shot orchestrator: resolves the taxon, queries the RPC,
 * classifies the result. Returns the verdict object for the caller.
 *
 * The form passes either a `taxonId` (preferred — comes from the
 * cascade when available) OR a `scientificName` to look up. If both
 * are NULL/empty, returns `{ kind: 'no_signal' }` immediately.
 */
export async function checkOutlier(input: {
  taxonId?: string | null;
  scientificName?: string | null;
  lat: number;
  lng: number;
  thresholdKm?: number;
}): Promise<OutlierVerdict> {
  let id = input.taxonId ?? null;
  if (!id && input.scientificName) {
    id = await resolveTaxonIdByName(input.scientificName);
  }
  if (!id) return { kind: 'no_signal' };
  const distance = await fetchTaxonRangeDistanceKm(id, input.lat, input.lng);
  return classifyOutlier(distance, input.thresholdKm);
}
