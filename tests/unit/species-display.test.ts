import { describe, it, expect } from 'vitest';
import { pillForSpecies, type SpeciesPillInput, type Pill } from '../../src/lib/species-display';

describe('pillForSpecies', () => {
  it('returns rarity pill when rarity_bucket >= 4', () => {
    const input: SpeciesPillInput = { rarity_bucket: 5, endemic_mx: true, nom059_status: 'amenazada' };
    expect(pillForSpecies(input)).toEqual<Pill>({ kind: 'rarity-rare', label: 'rarity_5', tone: 'amber' });
  });

  it('returns endemic pill when endemic and not rare', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: true, nom059_status: null })).toEqual<Pill>({
      kind: 'endemic', label: 'endemic_mx', tone: 'lime',
    });
  });

  it('returns nom059 pill when threatened and not rare and not endemic', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: false, nom059_status: 'amenazada' })).toEqual<Pill>({
      kind: 'nom059', label: 'nom059', tone: 'orange',
    });
  });

  it('returns notable pill for rarity_bucket=3', () => {
    expect(pillForSpecies({ rarity_bucket: 3, endemic_mx: false, nom059_status: null })).toEqual<Pill>({
      kind: 'rarity-notable', label: 'rarity_3', tone: 'amber-light',
    });
  });

  it('returns null for plain common species', () => {
    expect(pillForSpecies({ rarity_bucket: 1, endemic_mx: false, nom059_status: null })).toBeNull();
  });

  it('treats null rarity_bucket as bucket=1', () => {
    expect(pillForSpecies({ rarity_bucket: null, endemic_mx: false, nom059_status: null })).toBeNull();
  });

  it('rarity beats endemic and nom059', () => {
    expect(pillForSpecies({ rarity_bucket: 5, endemic_mx: true, nom059_status: 'peligro_extincion' })?.kind).toBe('rarity-rare');
  });
});
