import { describe, it, expect } from 'vitest';
import {
  parseChips,
  serializeChips,
  filterByChips,
  type ChipsState,
  type SpeciesRow,
} from '../../src/lib/species-filters';

describe('parseChips', () => {
  it('returns defaults for empty querystring', () => {
    expect(parseChips('')).toEqual<ChipsState>({
      endemic: false,
      nom059: false,
      rare: false,
      kingdom: null,
    });
  });

  it('parses a fully-populated state', () => {
    expect(parseChips('?endemic=1&nom059=1&rare=1&kingdom=Animalia')).toEqual<ChipsState>({
      endemic: true, nom059: true, rare: true, kingdom: 'Animalia',
    });
  });

  it('drops unknown kingdom values silently', () => {
    expect(parseChips('?kingdom=NotAKingdom').kingdom).toBeNull();
  });

  it('treats truthy variants of endemic correctly', () => {
    expect(parseChips('?endemic=true').endemic).toBe(true);
    expect(parseChips('?endemic=0').endemic).toBe(false);
  });
});

describe('serializeChips', () => {
  it('returns empty string for default state', () => {
    expect(serializeChips({ endemic: false, nom059: false, rare: false, kingdom: null })).toBe('');
  });

  it('round-trips through parseChips', () => {
    const s: ChipsState = { endemic: true, nom059: false, rare: true, kingdom: 'Plantae' };
    expect(parseChips(serializeChips(s))).toEqual(s);
  });
});

describe('filterByChips', () => {
  const rows: SpeciesRow[] = [
    { taxon_id: 'a', kingdom: 'Animalia', endemic_mx: true,  nom059_status: null,        rarity_bucket: 2 },
    { taxon_id: 'b', kingdom: 'Plantae',  endemic_mx: false, nom059_status: 'A', rarity_bucket: 4 },
    { taxon_id: 'c', kingdom: 'Animalia', endemic_mx: false, nom059_status: null,        rarity_bucket: 1 },
    { taxon_id: 'd', kingdom: 'Fungi',    endemic_mx: false, nom059_status: null,        rarity_bucket: 5 },
  ];

  it('returns all when no chips active', () => {
    expect(filterByChips(rows, { endemic: false, nom059: false, rare: false, kingdom: null })).toHaveLength(4);
  });

  it('endemic chip keeps only endemic species', () => {
    const out = filterByChips(rows, { endemic: true, nom059: false, rare: false, kingdom: null });
    expect(out.map(r => r.taxon_id)).toEqual(['a']);
  });

  it('rare chip keeps rarity_bucket >= 4', () => {
    const out = filterByChips(rows, { endemic: false, nom059: false, rare: true, kingdom: null });
    expect(out.map(r => r.taxon_id).sort()).toEqual(['b', 'd']);
  });

  it('combines chips with AND', () => {
    const out = filterByChips(rows, { endemic: true, nom059: false, rare: false, kingdom: 'Animalia' });
    expect(out.map(r => r.taxon_id)).toEqual(['a']);
  });

  it('kingdom filter only', () => {
    const out = filterByChips(rows, { endemic: false, nom059: false, rare: false, kingdom: 'Plantae' });
    expect(out.map(r => r.taxon_id)).toEqual(['b']);
  });
});
