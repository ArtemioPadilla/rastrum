import { describe, it, expect } from 'vitest';
import {
  pillForSpecies,
  deriveGenus,
  colorForName,
  buildTaxonomicTree,
  taxonomicDepth,
  type SpeciesPillInput,
  type Pill,
  type TaxonInput,
} from '../../src/lib/species-display';

function taxon(over: Partial<TaxonInput> = {}): TaxonInput {
  return {
    id: over.id ?? 'a',
    scientific_name: over.scientific_name ?? 'Aratinga canicularis',
    kingdom: over.kingdom ?? null,
    phylum: over.phylum ?? null,
    class: over.class ?? null,
    order: over.order ?? null,
    family: over.family ?? null,
    genus: over.genus ?? null,
    slug: over.slug ?? null,
    observation_count: over.observation_count ?? 1,
  };
}

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

describe('buildTaxonomicTree', () => {
  it('returns a root with no children for an empty input', () => {
    const tree = buildTaxonomicTree([]);
    expect(tree.rank).toBe('root');
    expect(tree.children).toHaveLength(0);
    expect(tree.count).toBe(0);
  });

  it('skips null ranks and only descends through populated levels', () => {
    const tree = buildTaxonomicTree([taxon({ id: 'x', scientific_name: 'Foo bar' })]);
    expect(tree.children).toHaveLength(1);
    const species = tree.children[0];
    expect(species.rank).toBe('species');
    expect(species.name).toBe('Foo bar');
    expect(species.taxonId).toBe('x');
  });

  it('groups species by populated genus', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', scientific_name: 'Canis familiaris', genus: 'Canis' }),
      taxon({ id: 'b', scientific_name: 'Canis latrans',    genus: 'Canis' }),
      taxon({ id: 'c', scientific_name: 'Aratinga canicularis', genus: 'Aratinga' }),
    ]);
    expect(tree.children).toHaveLength(2);
    const canis = tree.children.find(c => c.name === 'Canis')!;
    expect(canis.rank).toBe('genus');
    expect(canis.children).toHaveLength(2);
    expect(canis.count).toBe(2);
  });

  it('builds a deep lineage when all ranks are populated', () => {
    const tree = buildTaxonomicTree([taxon({
      kingdom: 'Animalia', phylum: 'Chordata', class: 'Mammalia',
      order: 'Carnivora', family: 'Canidae', genus: 'Canis',
      scientific_name: 'Canis familiaris', observation_count: 5,
    })]);
    expect(taxonomicDepth(tree)).toBe(7);
    expect(tree.count).toBe(5);
    expect(tree.children[0].kingdom).toBe('Animalia');
  });

  it('aggregates observation counts up the tree', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', scientific_name: 'X y', genus: 'X', observation_count: 3 }),
      taxon({ id: 'b', scientific_name: 'X z', genus: 'X', observation_count: 2 }),
    ]);
    expect(tree.count).toBe(5);
    expect(tree.children[0].count).toBe(5);
  });
});

describe('taxonomicDepth', () => {
  it('returns 0 for a leaf', () => {
    const tree = buildTaxonomicTree([]);
    expect(taxonomicDepth(tree)).toBe(0);
  });

  it('returns 1 for root → species (sparse data)', () => {
    const tree = buildTaxonomicTree([taxon()]);
    expect(taxonomicDepth(tree)).toBe(1);
  });

  it('handles asymmetric trees (uses the deepest branch)', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', scientific_name: 'Solo species' }),
      taxon({ id: 'b', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis familiaris' }),
    ]);
    expect(taxonomicDepth(tree)).toBe(3);
  });
});
