/**
 * explore-map-filters.test.ts — unit tests for ExploreMapView filter logic
 * (issue #670).
 *
 * Tests the pure client-side filter functions that would live in
 * ExploreMapView.astro's <script> block and ExploreMap.astro's
 * applyAllFilters function.
 *
 * We extract the filter predicate logic into testable pure functions here.
 */
import { describe, it, expect } from 'vitest';

// ── Types (mirror ExploreMapView types) ────────────────────────────────────

interface ExploreFilters {
  taxon:    string;
  dateFrom: string;
  dateTo:   string;
  observer: string;
}

interface FeatureProperties {
  id:               string;
  species:          string;
  date:             string;
  observer_handle?: string;
  observed_month?:  number | null;
  pending?:         boolean;
  kingdom?:         string;
}

// ── Filter predicate (extracted from ExploreMap.astro logic) ───────────────

function matchesFilters(
  props: FeatureProperties,
  filters: ExploreFilters,
  activeMonth: number | null = null,
): boolean {
  const { taxon, dateFrom, dateTo, observer } = filters;
  const taxonLc    = taxon.toLowerCase();
  const observerLc = observer.startsWith('@') ? observer.slice(1).toLowerCase() : observer.toLowerCase();
  const fromMs     = dateFrom ? Date.parse(dateFrom) : null;
  const toMs       = dateTo   ? Date.parse(dateTo)   : null;

  // Month filter
  if (activeMonth !== null) {
    const m = props.observed_month;
    if (typeof m !== 'number' || m !== activeMonth) return false;
  }

  // Taxon filter
  if (taxonLc && !props.species.toLowerCase().includes(taxonLc)) return false;

  // Date range filter
  if (fromMs !== null || toMs !== null) {
    const ms = props.date ? Date.parse(props.date) : null;
    if (ms === null) return false;
    if (fromMs !== null && ms < fromMs) return false;
    if (toMs   !== null && ms > toMs  ) return false;
  }

  // Observer filter
  if (observerLc && !(props.observer_handle ?? '').toLowerCase().includes(observerLc)) return false;

  return true;
}

// ── URL param helpers ──────────────────────────────────────────────────────

function filtersToParams(f: ExploreFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.taxon)    p.set('taxon',    f.taxon);
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo)   p.set('dateTo',   f.dateTo);
  if (f.observer) p.set('observer', f.observer);
  return p;
}

function paramsToFilters(p: URLSearchParams): ExploreFilters {
  return {
    taxon:    p.get('taxon')    ?? '',
    dateFrom: p.get('dateFrom') ?? '',
    dateTo:   p.get('dateTo')   ?? '',
    observer: p.get('observer') ?? '',
  };
}

function countActive(f: ExploreFilters): number {
  return [f.taxon, f.dateFrom, f.dateTo, f.observer].filter(Boolean).length;
}

// ── Test fixtures ──────────────────────────────────────────────────────────

const OBS_QUERCUS: FeatureProperties = {
  id:              'obs-1',
  species:         'Quercus robur',
  date:            '2026-03-15',
  observer_handle: 'artemio',
  observed_month:  2,  // 0-indexed (UTC month)
};

const OBS_JAGUAR: FeatureProperties = {
  id:              'obs-2',
  species:         'Panthera onca',
  date:            '2026-07-04',
  observer_handle: 'pame',
  observed_month:  6,
};

const OBS_PENDING: FeatureProperties = {
  id:              'obs-3',
  species:         'Unknown',
  date:            '',
  pending:         true,
  observed_month:  null,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ExploreMapView — matchesFilters: no filters', () => {
  const empty: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: '' };

  it('passes all observations when no filters are set', () => {
    expect(matchesFilters(OBS_QUERCUS, empty)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  empty)).toBe(true);
  });
});

describe('ExploreMapView — matchesFilters: taxon', () => {
  it('matches taxon case-insensitively', () => {
    const f: ExploreFilters = { taxon: 'quercus', dateFrom: '', dateTo: '', observer: '' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(false);
  });

  it('matches partial scientific name', () => {
    const f: ExploreFilters = { taxon: 'Panthera', dateFrom: '', dateTo: '', observer: '' };
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(true);
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(false);
  });
});

describe('ExploreMapView — matchesFilters: date range', () => {
  it('passes observation within date range', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '2026-01-01', dateTo: '2026-06-30', observer: '' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(false);
  });

  it('passes observation on exact boundary dates', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '2026-03-15', dateTo: '2026-03-15', observer: '' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(true);
  });

  it('rejects observation with empty date when date filter is active', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '2026-01-01', dateTo: '', observer: '' };
    expect(matchesFilters(OBS_PENDING, f)).toBe(false);
  });

  it('only dateFrom set — rejects older observations', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '2026-05-01', dateTo: '', observer: '' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(false);  // March < May
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(true);   // July >= May
  });
});

describe('ExploreMapView — matchesFilters: observer', () => {
  it('matches observer handle case-insensitively', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: 'ARTEMIO' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(false);
  });

  it('strips leading @ before matching', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: '@pame' };
    expect(matchesFilters(OBS_JAGUAR,  f)).toBe(true);
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(false);
  });

  it('matches partial handle', () => {
    const f: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: 'arte' };
    expect(matchesFilters(OBS_QUERCUS, f)).toBe(true);
  });
});

describe('ExploreMapView — matchesFilters: month (TimeSlider)', () => {
  const empty: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: '' };

  it('respects activeMonth filter', () => {
    expect(matchesFilters(OBS_QUERCUS, empty, 2)).toBe(true);  // March = month index 2
    expect(matchesFilters(OBS_QUERCUS, empty, 5)).toBe(false);
  });

  it('null activeMonth passes all months', () => {
    expect(matchesFilters(OBS_QUERCUS, empty, null)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  empty, null)).toBe(true);
  });

  it('observation with null observed_month fails when activeMonth set', () => {
    expect(matchesFilters(OBS_PENDING, empty, 2)).toBe(false);
  });
});

describe('ExploreMapView — matchesFilters: combined', () => {
  it('all filters applied together — correct intersection', () => {
    const f: ExploreFilters = {
      taxon:    'quercus',
      dateFrom: '2026-01-01',
      dateTo:   '2026-12-31',
      observer: 'artemio',
    };
    expect(matchesFilters(OBS_QUERCUS, f, null)).toBe(true);
    expect(matchesFilters(OBS_JAGUAR,  f, null)).toBe(false);
  });
});

// ── URL param round-trip ───────────────────────────────────────────────────

describe('ExploreMapView — URL param round-trip', () => {
  it('encodes and decodes filters via URLSearchParams', () => {
    const original: ExploreFilters = {
      taxon:    'Quercus',
      dateFrom: '2026-01-01',
      dateTo:   '2026-12-31',
      observer: 'artemio',
    };
    const params = filtersToParams(original);
    const decoded = paramsToFilters(params);
    expect(decoded).toEqual(original);
  });

  it('empty filters produce no URL params', () => {
    const empty: ExploreFilters = { taxon: '', dateFrom: '', dateTo: '', observer: '' };
    const params = filtersToParams(empty);
    expect(params.toString()).toBe('');
  });

  it('countActive returns correct count', () => {
    expect(countActive({ taxon: 'q', dateFrom: '', dateTo: '', observer: '' })).toBe(1);
    expect(countActive({ taxon: 'q', dateFrom: '2026-01-01', dateTo: '', observer: 'a' })).toBe(3);
    expect(countActive({ taxon: '', dateFrom: '', dateTo: '', observer: '' })).toBe(0);
  });
});
