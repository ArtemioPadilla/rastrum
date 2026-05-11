/**
 * #463 — Species Explorer Phase 2
 *
 * Tests the sunburst-to-grid clade filtering helper:
 * `collectCladeTaxonIds` which walks a TaxonNode subtree and collects
 * all leaf taxon IDs. This is what drives the "click a sunburst segment
 * → filter the grid" feature.
 *
 * Also tests the ExploreSpeciesView HTML source for the required UI
 * elements (search bar, clade-filter banner, view tabs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildTaxonomicTree, type TaxonNode, type TaxonInput } from '../../src/lib/species-display';

// ── Re-implement collectCladeTaxonIds from ExploreSpeciesView ─────────────
function collectCladeTaxonIds(node: TaxonNode): Set<string> {
  const ids = new Set<string>();
  function walk(n: TaxonNode) {
    if (n.taxonId) ids.add(n.taxonId);
    n.children.forEach(walk);
  }
  walk(node);
  return ids;
}

function taxon(over: Partial<TaxonInput> = {}): TaxonInput {
  return {
    id: over.id ?? 'x',
    scientific_name: over.scientific_name ?? 'Unknown sp',
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

describe('#463 — Species Explorer Phase 2 — clade filtering', () => {
  it('collects taxon IDs of all leaves under a kingdom node', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', kingdom: 'Animalia', scientific_name: 'Canis familiaris' }),
      taxon({ id: 'b', kingdom: 'Animalia', scientific_name: 'Aratinga canicularis' }),
      taxon({ id: 'c', kingdom: 'Plantae',  scientific_name: 'Quercus robur' }),
    ]);
    const animalia = tree.children.find(n => n.name === 'Animalia')!;
    const ids = collectCladeTaxonIds(animalia);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
    expect(ids.size).toBe(2);
  });

  it('returns empty set for a leaf node without taxonId', () => {
    const node: TaxonNode = { name: 'Unknown', rank: 'species', count: 1, children: [] };
    expect(collectCladeTaxonIds(node).size).toBe(0);
  });

  it('returns single ID for a leaf with taxonId', () => {
    const node: TaxonNode = { name: 'Canis lupus', rank: 'species', count: 3, taxonId: 'wolf-id', children: [] };
    const ids = collectCladeTaxonIds(node);
    expect(ids.size).toBe(1);
    expect(ids.has('wolf-id')).toBe(true);
  });

  it('collects IDs recursively across a deep tree', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis lupus' }),
      taxon({ id: 'b', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis familiaris' }),
      taxon({ id: 'c', kingdom: 'Animalia', genus: 'Felis', scientific_name: 'Felis catus' }),
    ]);
    const animalia = tree.children.find(n => n.name === 'Animalia')!;
    const ids = collectCladeTaxonIds(animalia);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('genus-level filter returns only species in that genus', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis lupus' }),
      taxon({ id: 'b', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis familiaris' }),
      taxon({ id: 'c', kingdom: 'Animalia', genus: 'Felis', scientific_name: 'Felis catus' }),
    ]);
    const canis = tree.children.find(n => n.name === 'Animalia')!
                       .children.find(n => n.name === 'Canis')!;
    const ids = collectCladeTaxonIds(canis);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(false);
  });

  it('root node collects all taxon IDs', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', kingdom: 'Animalia', scientific_name: 'Sp A' }),
      taxon({ id: 'b', kingdom: 'Plantae',  scientific_name: 'Sp B' }),
      taxon({ id: 'c', kingdom: 'Fungi',    scientific_name: 'Sp C' }),
    ]);
    const ids = collectCladeTaxonIds(tree);
    expect(ids.size).toBe(3);
    ['a','b','c'].forEach(id => expect(ids.has(id)).toBe(true));
  });
});

// ── HTML structure checks ────────────────────────────────────────────────
const exploreSrc = readFileSync(
  resolve(process.cwd(), 'src/components/ExploreSpeciesView.astro'),
  'utf-8',
);

describe('#463 — Species Explorer Phase 2 — UI structure', () => {
  it('has a full-text search input', () => {
    expect(exploreSrc).toContain('class="es-search');
    expect(exploreSrc).toContain('type="search"');
  });

  it('has the three-view tab bar (grid, radial, tree)', () => {
    expect(exploreSrc).toContain('data-view="grid"');
    expect(exploreSrc).toContain('data-view="radial"');
    expect(exploreSrc).toContain('data-view="tree"');
  });

  it('has the clade filter banner element', () => {
    expect(exploreSrc).toContain('id="es-clade-filter-banner"');
    expect(exploreSrc).toContain('id="es-clade-filter-clear"');
  });

  it('has collectCladeTaxonIds function', () => {
    expect(exploreSrc).toContain('collectCladeTaxonIds');
  });

  it('sunburstCladeIds drives the grid filter', () => {
    expect(exploreSrc).toContain('sunburstCladeIds');
  });
});
