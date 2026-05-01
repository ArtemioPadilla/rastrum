import { describe, it, expect } from 'vitest';
import {
  createBulkState, toggleOne, toggleAll, isAllSelected,
  selectedCount, getSelectedIds, clearSelection, updateAllIds,
} from '../../src/lib/console-bulk';

describe('console-bulk', () => {
  it('toggleOne adds and removes IDs', () => {
    const state = createBulkState();
    state.allIds = ['a', 'b', 'c'];
    toggleOne(state, 'a');
    expect(selectedCount(state)).toBe(1);
    toggleOne(state, 'a');
    expect(selectedCount(state)).toBe(0);
  });

  it('toggleAll selects all then deselects all', () => {
    const state = createBulkState();
    state.allIds = ['a', 'b', 'c'];
    toggleAll(state);
    expect(isAllSelected(state)).toBe(true);
    expect(getSelectedIds(state).sort()).toEqual(['a', 'b', 'c']);
    toggleAll(state);
    expect(selectedCount(state)).toBe(0);
  });

  it('updateAllIds prunes stale selections', () => {
    const state = createBulkState();
    state.allIds = ['a', 'b', 'c'];
    toggleAll(state);
    updateAllIds(state, ['b', 'c', 'd']);
    expect(getSelectedIds(state).sort()).toEqual(['b', 'c']);
  });

  it('clearSelection empties the set', () => {
    const state = createBulkState();
    state.allIds = ['a', 'b'];
    toggleAll(state);
    clearSelection(state);
    expect(selectedCount(state)).toBe(0);
  });
});
