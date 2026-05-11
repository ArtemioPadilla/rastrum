/**
 * Helpers for the "Mi impacto ecológico" page (issue #728).
 *
 * The metric values come from the SQL function `compute_user_impact()` which
 * returns a JSONB envelope. These helpers are pure formatting / locale
 * concerns kept out of the Astro frontmatter so they can be unit-tested.
 *
 * #806: Extended with `loadUserExportHistory()` to query the new
 * `dwc_export_log` table and return an accurate per-export list.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserImpact {
  transect_km: number;
  research_grade: number;
  expert_confirmed: number;
  in_research: number;
  sensitive_seen: number;
  computed_at: string;
}

export function isUserImpact(value: unknown): value is UserImpact {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.transect_km === 'number' &&
    typeof v.research_grade === 'number' &&
    typeof v.expert_confirmed === 'number' &&
    typeof v.in_research === 'number' &&
    typeof v.sensitive_seen === 'number'
  );
}

/**
 * Round a transect-equivalent km figure for display:
 *   • zero stays zero
 *   • <1 km → 1 decimal ("0.4 km")
 *   • <10 km → 1 decimal ("3.7 km")
 *   • ≥10 km → integer ("12 km")
 *
 * The heuristic itself is wildly approximate, so we don't show three-decimal
 * precision that suggests false certainty.
 */
export function formatTransectKm(value: number, lang: 'en' | 'es' = 'en'): string {
  if (!Number.isFinite(value) || value <= 0) {
    return lang === 'es' ? '0 km' : '0 km';
  }
  if (value < 10) {
    return `${value.toFixed(1)} km`;
  }
  return `${Math.round(value)} km`;
}

/**
 * Locale-aware integer formatter for count cards. Uses Intl.NumberFormat so
 * larger values pick up the thousands separator the user expects.
 */
export function formatCount(value: number, lang: 'en' | 'es' = 'en'): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  const fmt = new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US');
  return fmt.format(Math.floor(value));
}

// ---------------------------------------------------------------------------
// #806 — Export history
// ---------------------------------------------------------------------------

export interface DwcExportLogRow {
  id: string;
  exported_at: string;
  observation_count: number;
  file_size_bytes: number | null;
  format: 'dwca' | 'csv' | 'json';
  triggered_by: 'user' | 'api' | 'gbif_sync' | 'cron';
}

/**
 * Load the most recent DwC export log rows for `userId`.
 *
 * Returns an empty array on any error so the UI can show a graceful empty
 * state rather than throwing.
 */
export async function loadUserExportHistory(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<DwcExportLogRow[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('dwc_export_log')
    .select('id, exported_at, observation_count, file_size_bytes, format, triggered_by')
    .eq('user_id', userId)
    .order('exported_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[impact] loadUserExportHistory error:', error.message);
    return [];
  }
  return (data ?? []) as DwcExportLogRow[];
}
