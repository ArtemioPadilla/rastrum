/**
 * Pure helpers for retry-unidentified — extracted so Vitest (Node runtime)
 * can import them without resolving Deno URL specifiers in `index.ts`.
 */

/**
 * Map observation evidence_type → identify EF user_hint (#590).
 */
export function deriveHint(evidenceType: string | null | undefined): 'plant' | 'animal' | 'fungi' | 'unknown' {
  if (!evidenceType) return 'unknown';
  if (evidenceType === 'plant_observation') return 'plant';
  if (evidenceType === 'fungi_observation') return 'fungi';
  if (evidenceType === 'camera_trap') return 'animal';
  if (evidenceType === 'direct_sighting') return 'animal';
  if (evidenceType === 'tracks' || evidenceType === 'scat' || evidenceType === 'sound') return 'animal';
  return 'unknown';
}
