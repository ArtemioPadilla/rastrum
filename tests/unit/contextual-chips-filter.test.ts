import { describe, it, expect } from 'vitest';
import { filterChipsByDex } from '../../src/lib/contextual-chips-filter';

const mockChips = [
  { taxon_id: 'a', scientific_name: 'Sp A', has_observed_by_viewer: false },
  { taxon_id: 'b', scientific_name: 'Sp B', has_observed_by_viewer: true },
  { taxon_id: 'c', scientific_name: 'Sp C', has_observed_by_viewer: false },
  { taxon_id: 'd', scientific_name: 'Sp D', has_observed_by_viewer: null },
];

describe('filterChipsByDex', () => {
  it('returns all chips when newOnly=false', () => {
    expect(filterChipsByDex(mockChips, false)).toHaveLength(4);
  });

  it('returns only unobserved chips when newOnly=true', () => {
    const result = filterChipsByDex(mockChips, true);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.taxon_id)).toEqual(['a', 'c']);
  });

  it('treats null has_observed_by_viewer as unobserved (anon user)', () => {
    const anon = [{ taxon_id: 'x', scientific_name: 'Sp X', has_observed_by_viewer: null }];
    expect(filterChipsByDex(anon, true)).toHaveLength(0); // null = viewer unknown, don't claim "new"
  });

  it('returns empty array if all are observed', () => {
    const allObserved = mockChips.map(c => ({ ...c, has_observed_by_viewer: true }));
    expect(filterChipsByDex(allObserved, true)).toHaveLength(0);
  });
});
