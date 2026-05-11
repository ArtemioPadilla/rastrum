/**
 * #681 — Radial dendrogram layout math tests.
 *
 * The radial dendrogram lays leaves at evenly-spaced angles around a circle.
 * Parent nodes receive the average angle of their first and last child.
 * This file tests the layout math independently of the DOM/SVG.
 */
import { describe, it, expect } from 'vitest';
import { buildTaxonomicTree, taxonomicDepth, type TaxonNode, type TaxonInput } from '../../src/lib/species-display';

// ── Re-implement the layout helpers from ExploreSpeciesView ──────────────

type RadialNode = TaxonNode & { _angle: number; _depth: number };

function assignRadialLayout(tree: TaxonNode): { leaves: RadialNode[]; maxDepth: number } {
  const leaves: RadialNode[] = [];
  function collectLeaves(n: TaxonNode) {
    if (!n.children.length) leaves.push(n as RadialNode);
    else n.children.forEach(collectLeaves);
  }
  collectLeaves(tree);

  const TOTAL = Math.max(1, leaves.length);
  leaves.forEach((leaf, i) => { leaf._angle = (i / TOTAL) * 2 * Math.PI; });

  function assignAngles(n: TaxonNode, depth: number): number {
    const rn = n as RadialNode;
    rn._depth = depth;
    if (!n.children.length) return rn._angle;
    const childAngles = n.children.map(c => assignAngles(c, depth + 1));
    rn._angle = (childAngles[0] + childAngles[childAngles.length - 1]) / 2;
    return rn._angle;
  }
  assignAngles(tree, 0);

  const maxDepth = taxonomicDepth(tree);
  return { leaves, maxDepth };
}

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

describe('#681 — radial dendrogram layout', () => {
  it('assigns unique angles to all leaves', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', scientific_name: 'Aa bb' }),
      taxon({ id: 'b', scientific_name: 'Cc dd' }),
      taxon({ id: 'c', scientific_name: 'Ee ff' }),
    ]);
    const { leaves } = assignRadialLayout(tree);
    const angles = leaves.map(l => l._angle);
    // All angles distinct
    const unique = new Set(angles.map(a => a.toFixed(6)));
    expect(unique.size).toBe(leaves.length);
  });

  it('leaf angles span [0, 2π) without overlap', () => {
    const taxa = Array.from({ length: 10 }, (_, i) =>
      taxon({ id: String(i), scientific_name: `Species${i} x` })
    );
    const tree = buildTaxonomicTree(taxa);
    const { leaves } = assignRadialLayout(tree);
    const sorted = [...leaves].sort((a, b) => a._angle - b._angle);
    expect(sorted[0]._angle).toBeGreaterThanOrEqual(0);
    expect(sorted[sorted.length - 1]._angle).toBeLessThan(2 * Math.PI);
    // Spacing between adjacent leaves should be uniform (equal-angle distribution)
    const gap = sorted[1]._angle - sorted[0]._angle;
    for (let i = 2; i < sorted.length; i++) {
      expect(sorted[i]._angle - sorted[i - 1]._angle).toBeCloseTo(gap, 5);
    }
  });

  it('root node is at depth 0', () => {
    const tree = buildTaxonomicTree([taxon()]);
    assignRadialLayout(tree);
    expect((tree as RadialNode)._depth).toBe(0);
  });

  it('leaf nodes are at maxDepth', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', kingdom: 'Animalia', genus: 'Canis', scientific_name: 'Canis familiaris' }),
    ]);
    const { maxDepth } = assignRadialLayout(tree);
    function collectLeaves(n: TaxonNode): RadialNode[] {
      if (!n.children.length) return [n as RadialNode];
      return n.children.flatMap(collectLeaves);
    }
    const leaves = collectLeaves(tree);
    for (const leaf of leaves) {
      expect(leaf._depth).toBe(maxDepth);
    }
  });

  it('parent angle is midpoint of first and last child angles', () => {
    const tree = buildTaxonomicTree([
      taxon({ id: 'a', genus: 'Canis', scientific_name: 'Canis familiaris' }),
      taxon({ id: 'b', genus: 'Canis', scientific_name: 'Canis lupus' }),
    ]);
    assignRadialLayout(tree);
    // Root has one child (genus Canis); Canis angle should be avg of its two leaves
    const genus = tree.children[0] as RadialNode;
    const leafA  = genus.children[0] as RadialNode;
    const leafB  = genus.children[1] as RadialNode;
    const expected = (leafA._angle + leafB._angle) / 2;
    expect(genus._angle).toBeCloseTo(expected, 10);
  });

  it('single-leaf tree: leaf angle is 0', () => {
    const tree = buildTaxonomicTree([taxon()]);
    const { leaves } = assignRadialLayout(tree);
    expect(leaves[0]._angle).toBe(0);
  });

  it('deeply nested taxa have correct depth order', () => {
    const tree = buildTaxonomicTree([
      taxon({
        kingdom: 'Animalia', phylum: 'Chordata', class: 'Aves',
        order: 'Psittaciformes', family: 'Psittacidae', genus: 'Aratinga',
        scientific_name: 'Aratinga canicularis',
      }),
    ]);
    assignRadialLayout(tree);
    // Root(0) → Animalia(1) → Chordata(2) → Aves(3) → Psitt(4) → Psittacidae(5) → Aratinga(6) → species(7)
    const md = taxonomicDepth(tree);
    expect(md).toBe(7);
    function findByName(n: TaxonNode, name: string): TaxonNode | null {
      if (n.name === name) return n;
      for (const c of n.children) { const f = findByName(c, name); if (f) return f; }
      return null;
    }
    const animalia = findByName(tree, 'Animalia') as RadialNode | null;
    expect(animalia?._depth).toBe(1);
    const species = findByName(tree, 'Aratinga canicularis') as RadialNode | null;
    expect(species?._depth).toBe(7);
  });
});
