import { describe, it, expect } from 'vitest';
import {
  pillForSpecies,
  deriveGenus,
  colorForName,
  type SpeciesPillInput,
  type Pill,
} from '../../src/lib/species-display';

describe('pillForSpecies', () => {
  it('returns rarity pill when rarity_bucket >= 4', () => {
    const input: SpeciesPillInput = { rarity_bucket: 5, endemic_mx: true, nom059_status: 'A' };
    expect(pillForSpecies(input)).toEqual<Pill>({ kind: 'rarity-rare', label: 'rarity_5', tone: 'amber' });
  });

  it('returns endemic pill when endemic and not rare', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: true, nom059_status: null })).toEqual<Pill>({
      kind: 'endemic', label: 'endemic_mx', tone: 'lime',
    });
  });

  it('returns nom059 pill when threatened and not rare and not endemic', () => {
    expect(pillForSpecies({ rarity_bucket: 2, endemic_mx: false, nom059_status: 'A' })).toEqual<Pill>({
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
    expect(pillForSpecies({ rarity_bucket: 5, endemic_mx: true, nom059_status: 'E' })?.kind).toBe('rarity-rare');
  });
});

describe('deriveGenus', () => {
  it('extracts genus from a standard binomial', () => {
    expect(deriveGenus('Aratinga canicularis')).toBe('Aratinga');
    expect(deriveGenus('Canis familiaris')).toBe('Canis');
    expect(deriveGenus('Heliocarpus terebinthinaceus')).toBe('Heliocarpus');
  });

  it('handles single-word genus-only entries', () => {
    expect(deriveGenus('Quercus')).toBe('Quercus');
  });

  it('rejects abbreviations and noise', () => {
    expect(deriveGenus('sp.')).toBeNull();
    expect(deriveGenus('Gerbera spp.')).toBe('Gerbera');
    expect(deriveGenus('cf. Aratinga')).toBeNull();
  });

  it('rejects hybrids with × prefix', () => {
    expect(deriveGenus('×Citrofortunella mitis')).toBeNull();
  });

  it('rejects all-lowercase or all-uppercase', () => {
    expect(deriveGenus('aratinga canicularis')).toBeNull();
    expect(deriveGenus('ARATINGA canicularis')).toBeNull();
  });

  it('handles whitespace gracefully', () => {
    expect(deriveGenus('   Aratinga canicularis  ')).toBe('Aratinga');
    expect(deriveGenus('')).toBeNull();
    expect(deriveGenus('   ')).toBeNull();
  });

  it('rejects 1-letter "names"', () => {
    expect(deriveGenus('A canicularis')).toBeNull();
  });
});

describe('colorForName', () => {
  it('returns a parseable HSL string', () => {
    expect(colorForName('Aratinga')).toMatch(/^hsl\(\d+, 62%, 52%\)$/);
  });

  it('is stable for the same input', () => {
    expect(colorForName('Canis')).toBe(colorForName('Canis'));
  });

  it('produces different hues for different inputs (most of the time)', () => {
    const names = ['Aratinga', 'Canis', 'Quercus', 'Gerbera', 'Heliocarpus', 'Eysenhardtia', 'Columbina', 'Alamania'];
    const hues = new Set(names.map(colorForName));
    // 8 distinct names → expect at least 6 distinct hues (golden-ratio
    // distribution makes collisions on small sets very unlikely).
    expect(hues.size).toBeGreaterThanOrEqual(6);
  });

  it('handles empty string without crashing', () => {
    expect(colorForName('')).toMatch(/^hsl\(0, 62%, 52%\)$/);
  });
});
