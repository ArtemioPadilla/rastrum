/**
 * Falta-dex (taxonomic-gap) helpers for PokedexView.
 *
 * Owns the localStorage toggle for "Show missing / Hide missing" plus
 * the count-line formatter ("X of Y species in your region"). Pulled
 * out of PokedexView.astro so it can be unit-tested without DOM.
 */

const SHOW_MISSING_KEY = 'rastrum.pokedex.showMissing';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function safeStorage(s?: StorageLike | null): StorageLike | null {
  if (s === undefined) {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }
  return s ?? null;
}

/**
 * Read the persisted "show missing" preference. Defaults to false —
 * users opt in to seeing gaps so the existing dex experience is
 * unchanged on first load. Malformed payloads also collapse to false.
 */
export function loadShowMissing(storage?: StorageLike | null): boolean {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    const v = s.getItem(SHOW_MISSING_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function saveShowMissing(value: boolean, storage?: StorageLike | null): void {
  const s = safeStorage(storage);
  if (!s) return;
  try {
    if (value) s.setItem(SHOW_MISSING_KEY, '1');
    else s.removeItem(SHOW_MISSING_KEY);
  } catch {
    /* storage may be quota-exceeded or disabled; treat as no-op */
  }
}

/**
 * Format the "X of Y species in your region" line. Pluralisation is
 * handled by the i18n template (the caller passes en or es copy with
 * `{observed}` / `{total}` placeholders). When `total` is 0 or the
 * region pool is unknown, the function falls back to a region-less
 * count line.
 */
export interface CountLabels {
  /** Template like "{observed} of {total} species in your region" */
  template: string;
  /** Fallback like "{observed} species observed" (no region/total). */
  fallback: string;
}

export function formatRegionCount(
  observed: number,
  total: number | null,
  labels: CountLabels,
): string {
  const safeObserved = Math.max(0, observed | 0);
  if (total == null || total <= 0) {
    return labels.fallback.replaceAll('{observed}', String(safeObserved));
  }
  // Total in the pool can lag behind the user's observed count (a brand-
  // new species the user just logged isn't in the regional pool yet).
  // Clamp denominator so we never show "12 of 8".
  const safeTotal = Math.max(safeObserved, total | 0);
  return labels.template
    .replaceAll('{observed}', String(safeObserved))
    .replaceAll('{total}', String(safeTotal));
}
