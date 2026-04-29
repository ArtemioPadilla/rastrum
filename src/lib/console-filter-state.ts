/**
 * Shared helpers for URL-state-driven filter controls in console views.
 * Each view calls readFilterState() on mount to restore filters from the URL,
 * and writeFilterState() on change to update the URL without a full navigation.
 *
 * Key conventions:
 *   q       — text search query
 *   status  — status select value
 *   type    — target type select value
 *   reason  — reason/category select value
 *   op      — audit log operation
 *   actor   — audit log actor id/username
 *   target  — audit log target_type
 *   since   — time window (7d, 30d, 90d, all)
 *   days    — numeric day window (7, 14, 30)
 *   filter  — generic single-key boolean toggle (active/all etc.)
 *   scope   — expert validation scope (my/all)
 *   verified — boolean checkbox
 */

export type FilterState = Record<string, string>;

export function readFilterState(): FilterState {
  const params = new URLSearchParams(window.location.search);
  const state: FilterState = {};
  params.forEach((value, key) => {
    state[key] = value;
  });
  return state;
}

export function writeFilterState(state: FilterState): void {
  const url = new URL(window.location.href);
  const keep = ['role'];
  const existing = new URLSearchParams(url.search);
  const next = new URLSearchParams();
  keep.forEach(k => {
    const v = existing.get(k);
    if (v !== null) next.set(k, v);
  });
  Object.entries(state).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) {
      next.set(k, v);
    }
  });
  url.search = next.toString();
  history.replaceState({}, '', url.toString());
}

export function applyFilterStateToForm(
  state: FilterState,
  fieldMap: Record<string, string>,
): void {
  Object.entries(fieldMap).forEach(([stateKey, elementId]) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const val = state[stateKey];
    if (val === undefined) return;
    if (el instanceof HTMLSelectElement) {
      el.value = val;
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = val === 'true' || val === '1';
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = val;
    }
  });
}
