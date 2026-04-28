/**
 * Pure helpers for the module-25 v1.2.1 profile widgets.
 *
 * Kept side-effect-free so the calendar/donut/top-species math can be
 * unit-tested without a Supabase round-trip or DOM.
 */

export type FacetKey =
  | 'profile'
  | 'real_name'
  | 'bio'
  | 'location'
  | 'stats_counts'
  | 'observation_map'
  | 'calendar_heatmap'
  | 'taxonomic_donut'
  | 'top_species'
  | 'streak'
  | 'badges'
  | 'activity_feed'
  | 'validation_rep'
  | 'obs_list'
  | 'watchlist'
  | 'goals'
  | 'karma_total'
  | 'expertise'
  | 'pokedex';

export type FacetLevel = 'public' | 'signed_in' | 'private';

export type ViewerKind = 'self' | 'signed_in' | 'anonymous';

export type FacetMatrix = Partial<Record<FacetKey, FacetLevel>>;

/**
 * Mirror of the SQL `can_see_facet()` result for a given matrix entry,
 * implemented client-side as a UX hint. Server-side gating still lives in
 * `public.can_see_facet()`; this helper only decides *visual* affordances
 * (e.g. whether to render the "Only you see this" pill on owner views).
 */
export function canSeeFacet(matrix: FacetMatrix, facet: FacetKey, viewer: ViewerKind): boolean {
  if (viewer === 'self') return true;
  const level = matrix[facet] ?? 'public';
  if (level === 'public') return true;
  if (level === 'signed_in') return viewer === 'signed_in';
  return false;
}

/**
 * Returns true when the owner's view of a facet is hidden from at least
 * one visitor class — used by the owner-only pill on `/profile/`.
 */
export function isOwnerOnlyFacet(matrix: FacetMatrix, facet: FacetKey): boolean {
  const level = matrix[facet] ?? 'public';
  return level !== 'public';
}

/* ------------------------------------------------------------------------- */
/* Calendar heatmap                                                           */
/* ------------------------------------------------------------------------- */

export interface CalendarBucket {
  bucket_date: string; // ISO yyyy-mm-dd
  daily_count: number;
}

export interface CalendarCell {
  date: string;
  count: number;
  /** 0..4 graded intensity bucket; 0 = empty, 4 = densest. */
  intensity: 0 | 1 | 2 | 3 | 4;
  weekIndex: number; // column 0..52
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat)
}

/** Snap a date to UTC midnight (yyyy-mm-dd). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build 53-week × 7-day grid ending on `endDate`. Cells that aren't in the
 * data map default to 0. Intensity buckets are quartile-ish (linear thirds
 * of the max + an empty bucket).
 */
export function buildCalendarGrid(buckets: CalendarBucket[], endDate: Date = new Date()): CalendarCell[] {
  const dataByDay = new Map<string, number>();
  for (const b of buckets) dataByDay.set(b.bucket_date, b.daily_count);

  const cells: CalendarCell[] = [];
  const TOTAL_CELLS = 53 * 7;
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));

  // Walk back from the end date the right number of days so the *last* week
  // (column 52) ends on the row matching today's day-of-week.
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (TOTAL_CELLS - 1));

  let max = 0;
  for (const [, n] of dataByDay) if (n > max) max = n;

  for (let i = 0; i < TOTAL_CELLS; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const date = isoDay(d);
    const count = dataByDay.get(date) ?? 0;

    let intensity: CalendarCell['intensity'] = 0;
    if (max > 0 && count > 0) {
      const ratio = count / max;
      intensity = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    }

    cells.push({
      date,
      count,
      intensity,
      weekIndex: Math.floor(i / 7),
      dayOfWeek: d.getUTCDay(),
    });
  }

  return cells;
}

/* ------------------------------------------------------------------------- */
/* Taxonomic donut                                                            */
/* ------------------------------------------------------------------------- */

export interface DonutSlice {
  kingdom: string;
  obs_count: number;
  /** 0..1 share of total. */
  share: number;
  /** SVG arc start/end in degrees, 0 = top, clockwise. */
  startDeg: number;
  endDeg: number;
}

export function donutFromCounts(rows: Array<{ kingdom: string; obs_count: number }>): DonutSlice[] {
  const total = rows.reduce((acc, r) => acc + r.obs_count, 0);
  if (total === 0) return [];
  let cursor = 0;
  return rows.map((r) => {
    const share = r.obs_count / total;
    const startDeg = cursor;
    const endDeg = cursor + share * 360;
    cursor = endDeg;
    return { kingdom: r.kingdom, obs_count: r.obs_count, share, startDeg, endDeg };
  });
}

/** Polar→cartesian for SVG arc rendering. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Build SVG path d="…" for a donut slice. */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startDeg: number, endDeg: number): string {
  const sweep = endDeg - startDeg;
  const large = sweep > 180 ? 1 : 0;
  const o1 = polar(cx, cy, rOuter, startDeg);
  const o2 = polar(cx, cy, rOuter, endDeg);
  const i1 = polar(cx, cy, rInner, endDeg);
  const i2 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${i2.x} ${i2.y}`,
    'Z',
  ].join(' ');
}

/* ------------------------------------------------------------------------- */
/* Top-species cap                                                            */
/* ------------------------------------------------------------------------- */

export interface TopSpeciesRow {
  taxon_id: string;
  scientific_name: string;
  obs_count: number;
  thumbnail_url: string | null;
}

export const TOP_SPECIES_CAP = 12;

export function capTopSpecies(rows: TopSpeciesRow[], cap: number = TOP_SPECIES_CAP): TopSpeciesRow[] {
  return rows.slice(0, Math.max(0, cap));
}

/* ------------------------------------------------------------------------- */
/* Activity-feed grouping                                                     */
/* ------------------------------------------------------------------------- */

export interface ActivityRow {
  event_id: string;
  event_kind: string;
  created_at: string;
  payload?: unknown;
  subject_id?: string | null;
}

export interface ActivityGroup {
  /** Bucket label key — caller localises. */
  bucketKey: 'this_week' | 'last_week' | 'older';
  bucketDate: string; // first day of the bucket, yyyy-mm-dd
  rows: ActivityRow[];
}

export function groupActivityByWeek(rows: ActivityRow[], now: Date = new Date()): ActivityGroup[] {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayOfWeek = startOfDay.getUTCDay();
  const startOfThisWeek = new Date(startOfDay);
  startOfThisWeek.setUTCDate(startOfDay.getUTCDate() - dayOfWeek);
  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setUTCDate(startOfThisWeek.getUTCDate() - 7);

  const groups: Record<ActivityGroup['bucketKey'], ActivityGroup> = {
    this_week: { bucketKey: 'this_week', bucketDate: isoDay(startOfThisWeek), rows: [] },
    last_week: { bucketKey: 'last_week', bucketDate: isoDay(startOfLastWeek), rows: [] },
    older:     { bucketKey: 'older',     bucketDate: '1970-01-01',           rows: [] },
  };

  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t >= startOfThisWeek.getTime()) groups.this_week.rows.push(r);
    else if (t >= startOfLastWeek.getTime()) groups.last_week.rows.push(r);
    else groups.older.rows.push(r);
  }

  return [groups.this_week, groups.last_week, groups.older].filter((g) => g.rows.length > 0);
}

/* ------------------------------------------------------------------------- */
/* Privacy presets — temporary inline copy until v1.2.0's                    */
/* `src/lib/privacy-presets.ts` lands. TODO(v1.2.1 cleanup): delete this     */
/* block and re-export from `src/lib/privacy-presets.ts`.                     */
/* ------------------------------------------------------------------------- */

export type PresetKey = 'open_scientist' | 'researcher' | 'private_observer';

export const PRIVACY_PRESETS: Record<PresetKey, FacetMatrix> = {
  open_scientist: {
    profile: 'public', real_name: 'public', bio: 'public', location: 'public',
    stats_counts: 'public', observation_map: 'public', calendar_heatmap: 'public',
    taxonomic_donut: 'public', top_species: 'public', streak: 'public',
    badges: 'public', activity_feed: 'public', validation_rep: 'public',
    obs_list: 'public', watchlist: 'private', goals: 'private',
    karma_total: 'public', expertise: 'public', pokedex: 'public',
  },
  researcher: {
    profile: 'public', real_name: 'signed_in', bio: 'public', location: 'signed_in',
    stats_counts: 'public', observation_map: 'public', calendar_heatmap: 'public',
    taxonomic_donut: 'public', top_species: 'public', streak: 'signed_in',
    badges: 'public', activity_feed: 'signed_in', validation_rep: 'public',
    obs_list: 'public', watchlist: 'private', goals: 'private',
    karma_total: 'public', expertise: 'public', pokedex: 'public',
  },
  private_observer: {
    profile: 'signed_in', real_name: 'private', bio: 'private', location: 'private',
    stats_counts: 'private', observation_map: 'private', calendar_heatmap: 'private',
    taxonomic_donut: 'private', top_species: 'private', streak: 'private',
    badges: 'private', activity_feed: 'private', validation_rep: 'private',
    obs_list: 'private', watchlist: 'private', goals: 'private',
    karma_total: 'private', expertise: 'private', pokedex: 'private',
  },
};
