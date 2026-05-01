/**
 * Shared bulk-selection helpers for console entity browsers.
 * Each browser instantiates its own BulkState; the helpers manage
 * the checkbox UI and provide the selected IDs for bulk actions.
 */

export interface BulkState {
  selected: Set<string>;
  allIds: string[];
}

export function createBulkState(): BulkState {
  return { selected: new Set(), allIds: [] };
}

export function toggleOne(state: BulkState, id: string): void {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
}

export function toggleAll(state: BulkState): void {
  if (state.selected.size === state.allIds.length) {
    state.selected.clear();
  } else {
    state.allIds.forEach(id => state.selected.add(id));
  }
}

export function isAllSelected(state: BulkState): boolean {
  return state.allIds.length > 0 && state.selected.size === state.allIds.length;
}

export function selectedCount(state: BulkState): number {
  return state.selected.size;
}

export function getSelectedIds(state: BulkState): string[] {
  return [...state.selected];
}

export function clearSelection(state: BulkState): void {
  state.selected.clear();
}

export function updateAllIds(state: BulkState, ids: string[]): void {
  state.allIds = ids;
  // Remove any selected IDs that are no longer in the list
  for (const id of state.selected) {
    if (!ids.includes(id)) state.selected.delete(id);
  }
}
