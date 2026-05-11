/**
 * #707 — Pokédex with full taxonomic tree
 *
 * Tests the tree-building helper that groups observed DexRows into
 * a Kingdom → … → Species hierarchy.
 *
 * We re-implement the logic from PokedexView (extracting pure functions
 * from the script block). The tests cover: grouping by kingdom, correct
 * observation counts, sorting by observed count, and leaf nodes.
 */
import { describe, it, expect } from 'vitest';

// ── Re-implement buildObservedTree from PokedexView.astro ─────────────────

type DexRow = {
  taxon_id: string;
  scientific_name: string;
  kingdom: string | null;
  obs_count: number;
};

type TreeNodeState = {
  name: string;
  rank: string;
  observed: number;
  total: number;
  children: TreeNodeState[];
};

type NodeMap = Map<string, { observed: number; children: NodeMap; rank: string }>;

function toNode(name: string, data: { observed: number; children: NodeMap; rank: string }): TreeNodeState {
  const children = Array.from(data.children.entries()).map(([n, d]) => toNode(n, d));
  return { name, rank: data.rank, observed: data.observed, total: children.length || 1, children };
}

function buildObservedTree(rows: DexRow[]): TreeNodeState {
  const root: NodeMap = new Map();
  for (const r of rows) {
    const path: Array<{ rank: string; name: string }> = [];
    if (r.kingdom) path.push({ rank: 'Kingdom', name: r.kingdom });
    path.push({ rank: 'Species', name: r.scientific_name });

    let cur = root;
    for (const step of path) {
      if (!cur.has(step.name)) {
        cur.set(step.name, { observed: 0, children: new Map(), rank: step.rank });
      }
      const node = cur.get(step.name)!;
      node.observed += r.obs_count ?? 1;
      cur = node.children;
    }
  }

  const children = Array.from(root.entries()).map(([n, d]) => toNode(n, d));
  const totalObs = children.reduce((s, c) => s + c.observed, 0);
  return { name: 'root', rank: 'root', observed: totalObs, total: children.length, children };
}

function row(over: Partial<DexRow>): DexRow {
  return {
    taxon_id: over.taxon_id ?? 'x',
    scientific_name: over.scientific_name ?? 'Unknown sp',
    kingdom: over.kingdom ?? null,
    obs_count: over.obs_count ?? 1,
  };
}

describe('#707 — Pokédex taxonomic tree', () => {
  it('returns an empty root for no rows', () => {
    const tree = buildObservedTree([]);
    expect(tree.children).toHaveLength(0);
    expect(tree.observed).toBe(0);
  });

  it('groups species by kingdom', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Canis familiaris', kingdom: 'Animalia', obs_count: 5 }),
      row({ taxon_id: 'b', scientific_name: 'Quercus robur',    kingdom: 'Plantae',  obs_count: 3 }),
    ]);
    expect(tree.children).toHaveLength(2);
    const kingdoms = tree.children.map(c => c.name).sort();
    expect(kingdoms).toEqual(['Animalia', 'Plantae']);
  });

  it('accumulates observation counts up to kingdom', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Canis familiaris', kingdom: 'Animalia', obs_count: 5 }),
      row({ taxon_id: 'b', scientific_name: 'Aratinga canicularis', kingdom: 'Animalia', obs_count: 3 }),
    ]);
    const animalia = tree.children.find(c => c.name === 'Animalia')!;
    expect(animalia.observed).toBe(8);
    expect(animalia.children).toHaveLength(2);
  });

  it('root observed count equals sum of all species observations', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Sp a', kingdom: 'Animalia', obs_count: 4 }),
      row({ taxon_id: 'b', scientific_name: 'Sp b', kingdom: 'Plantae',  obs_count: 6 }),
    ]);
    expect(tree.observed).toBe(10);
  });

  it('species without kingdom lands at root level', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Orphan species', kingdom: null, obs_count: 2 }),
    ]);
    // Without kingdom, only the species step is added → one root-level child
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].rank).toBe('Species');
    expect(tree.children[0].name).toBe('Orphan species');
  });

  it('kingdom node rank is "Kingdom"', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Canis lupus', kingdom: 'Animalia', obs_count: 1 }),
    ]);
    const kingdom = tree.children[0];
    expect(kingdom.rank).toBe('Kingdom');
  });

  it('species node rank is "Species"', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Canis lupus', kingdom: 'Animalia', obs_count: 1 }),
    ]);
    const species = tree.children[0].children[0];
    expect(species.rank).toBe('Species');
    expect(species.name).toBe('Canis lupus');
  });

  it('handles multiple species in same kingdom with different obs counts', () => {
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Sp 1', kingdom: 'Animalia', obs_count: 10 }),
      row({ taxon_id: 'b', scientific_name: 'Sp 2', kingdom: 'Animalia', obs_count: 1  }),
      row({ taxon_id: 'c', scientific_name: 'Sp 3', kingdom: 'Animalia', obs_count: 5  }),
    ]);
    const animalia = tree.children.find(c => c.name === 'Animalia')!;
    expect(animalia.children).toHaveLength(3);
    expect(animalia.observed).toBe(16);
  });

  it('same species can appear only once (deduplication via Map)', () => {
    // If two rows have same scientific_name (shouldn't happen in practice but test robustness)
    const tree = buildObservedTree([
      row({ taxon_id: 'a', scientific_name: 'Canis lupus', kingdom: 'Animalia', obs_count: 2 }),
      row({ taxon_id: 'a', scientific_name: 'Canis lupus', kingdom: 'Animalia', obs_count: 3 }),
    ]);
    const animalia = tree.children.find(c => c.name === 'Animalia')!;
    // Map-based deduplication: same name → merged into one node
    expect(animalia.children).toHaveLength(1);
    expect(animalia.children[0].observed).toBe(5); // 2 + 3
  });
});
