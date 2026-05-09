/**
 * Impact deep-link filter parser.
 *
 * `/profile/observations?filter=<key>` is a forward-compat URL contract
 * shipped by the impact page (`/profile/impact`). The 5 cards each
 * deep-link into the observation list filtered by the corresponding
 * predicate so the cause→effect chain is honest: clicking a card lands
 * on the rows the metric was computed from.
 *
 * SQL predicates (mirrored in `list_user_impact_obs`):
 *   mapped            location IS NOT NULL
 *   research_grade    primary identifications.is_research_grade = true
 *   expert_confirmed  any identification.validated_by has 'expert' role
 *   in_project        project_id IS NOT NULL
 *   sensitive         taxon nom059_status IN ('E','P','A','Pr')
 *                     OR    iucn_category IN ('CR','EN','VU','NT')
 */
export const IMPACT_FILTERS = [
  'mapped',
  'research_grade',
  'expert_confirmed',
  'in_project',
  'sensitive',
] as const;

export type ImpactFilter = typeof IMPACT_FILTERS[number];

export function isImpactFilter(value: string | null | undefined): value is ImpactFilter {
  return typeof value === 'string' && (IMPACT_FILTERS as ReadonlyArray<string>).includes(value);
}

export type ParsedImpactFilter =
  | { kind: 'none' }
  | { kind: 'recognized'; value: ImpactFilter }
  | { kind: 'unknown'; raw: string };

/**
 * Parse the `filter` query param into a discriminated union.
 * - `none` when absent or empty.
 * - `recognized` when the value matches one of `IMPACT_FILTERS`.
 * - `unknown` when present but not a recognized value — the UI should
 *   render a subtle "filter not recognized" pill and fall back to the
 *   all-obs view (honest UX, not silent failure).
 */
export function parseImpactFilter(input: URLSearchParams | string | null | undefined): ParsedImpactFilter {
  if (input == null) return { kind: 'none' };
  const params = typeof input === 'string'
    ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
    : input;
  const raw = params.get('filter');
  if (raw == null || raw === '') return { kind: 'none' };
  if (isImpactFilter(raw)) return { kind: 'recognized', value: raw };
  return { kind: 'unknown', raw };
}
