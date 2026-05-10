/**
 * Filter helpers for ContextualSpeciesChips "not in dex yet" toggle.
 * Pure functions — no Supabase, no DOM. Testable in isolation.
 */

export interface ChipRow {
  taxon_id: string;
  scientific_name: string;
  has_observed_by_viewer: boolean | null;
  [key: string]: unknown;
}

/**
 * Filter chip rows.
 * Generic over any row type with `has_observed_by_viewer` — accepts ProbableTaxon directly.
 * @param chips - Full chip list from probable_taxa_at() RPC
 * @param newOnly - When true, return only species with has_observed_by_viewer === false
 *                  (null = viewer unknown → excluded when filtering)
 */
export function filterChipsByDex<T extends { has_observed_by_viewer: boolean | null }>(chips: T[], newOnly: boolean): T[] {
  if (!newOnly) return chips;
  return chips.filter(c => c.has_observed_by_viewer === false);
}
