import { describe, it, expect } from 'vitest';
import {
  formatDistance,
  formatPill,
  speciesHref,
  type NearbySimilarRow,
  type NearbySimilarCopy,
} from '../../src/lib/nearby-similar';

const enCopy: NearbySimilarCopy = {
  title: 'Nearby similar species',
  subtitle: 'Spotted within 5 km in the last 90 days',
  seen_n_times: 'seen {n}×',
  seen_once: 'seen once',
  n_km_away: '{n} km away',
  n_m_away: '{n} m away',
  view_species: 'View species',
  empty_state: '',
};

const esCopy: NearbySimilarCopy = {
  ...enCopy,
  seen_n_times: 'vista {n}×',
  seen_once: 'vista una vez',
  n_km_away: 'a {n} km',
  n_m_away: 'a {n} m',
  view_species: 'Ver especie',
};

function row(over: Partial<NearbySimilarRow> = {}): NearbySimilarRow {
  return {
    taxon_id: 't-1',
    scientific_name: 'Salvia elegans',
    common_name_en: 'Pineapple sage',
    common_name_es: 'Mirto',
    slug: 'salvia-elegans',
    obs_count: 1,
    last_observed_at: '2026-04-01T00:00:00Z',
    distance_m: 800,
    ...over,
  };
}

describe('formatDistance', () => {
  it('renders sub-km in metres, rounded to integer', () => {
    expect(formatDistance(800, enCopy)).toBe('800 m away');
    expect(formatDistance(800.4, enCopy)).toBe('800 m away');
    expect(formatDistance(123.7, enCopy)).toBe('124 m away');
  });

  it('renders 1–10 km with one decimal', () => {
    expect(formatDistance(1200, enCopy)).toBe('1.2 km away');
    expect(formatDistance(3800, enCopy)).toBe('3.8 km away');
    expect(formatDistance(9999, enCopy)).toBe('10.0 km away');
  });

  it('renders >= 10 km as integer km', () => {
    expect(formatDistance(10000, enCopy)).toBe('10 km away');
    expect(formatDistance(45123, enCopy)).toBe('45 km away');
  });

  it('respects ES copy', () => {
    expect(formatDistance(1200, esCopy)).toBe('a 1.2 km');
    expect(formatDistance(450, esCopy)).toBe('a 450 m');
  });

  it('returns empty string for invalid distances', () => {
    expect(formatDistance(NaN, enCopy)).toBe('');
    expect(formatDistance(-100, enCopy)).toBe('');
  });
});

describe('formatPill', () => {
  it('singular for obs_count = 1', () => {
    expect(formatPill(row({ obs_count: 1, distance_m: 1200 }), enCopy))
      .toBe('seen once · 1.2 km away');
  });

  it('plural for obs_count > 1', () => {
    expect(formatPill(row({ obs_count: 3, distance_m: 4800 }), enCopy))
      .toBe('seen 3× · 4.8 km away');
  });

  it('renders Spanish copy', () => {
    expect(formatPill(row({ obs_count: 2, distance_m: 800 }), esCopy))
      .toBe('vista 2× · a 800 m');
  });
});

describe('speciesHref', () => {
  it('uses slug when present (en)', () => {
    expect(speciesHref(row({ slug: 'salvia-elegans' }), 'en'))
      .toBe('/en/explore/species/salvia-elegans');
  });

  it('uses slug when present (es)', () => {
    expect(speciesHref(row({ slug: 'salvia-elegans' }), 'es'))
      .toBe('/es/explorar/especies/salvia-elegans');
  });

  it('falls back to ?taxon=<uuid> when slug is null', () => {
    const r = row({ slug: null, taxon_id: 'abc-123' });
    expect(speciesHref(r, 'en')).toBe('/en/explore/species/?taxon=abc-123');
    expect(speciesHref(r, 'es')).toBe('/es/explorar/especies/?taxon=abc-123');
  });

  it('encodes special characters in slug', () => {
    expect(speciesHref(row({ slug: 'café-au-lait' }), 'en'))
      .toBe('/en/explore/species/' + encodeURIComponent('café-au-lait'));
  });
});
