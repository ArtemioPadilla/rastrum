/**
 * M07 / #745 — Peer norms helper.
 *
 * Fetches a percentage from the `peer_norm_pct(scope, country, key)` SQL
 * function and renders the result in a small bar next to license / privacy
 * options.
 *
 * Honest copy: when n < `MIN_N_THRESHOLD` we return `null` for `pct` so the
 * UI can fall back to "datos insuficientes" / "not enough data" — a noisy
 * 1-of-2 sample is worse than no number at all.
 */

import { getSupabase } from './supabase';

export const MIN_N_THRESHOLD = 50;

export type PeerNormScope = 'license' | `privacy:${string}`;

export interface PeerNormResult {
  /** Percentage 0-100, or null when below the n threshold. */
  pct: number | null;
  /** Observers/observations matching the key. */
  n: number;
  /** Total observers/observations across all keys for that scope. */
  total: number;
}

interface PeerNormRow {
  pct: number | string | null;
  n: number | string | null;
  total: number | string | null;
}

const cache = new Map<string, Promise<PeerNormResult>>();

function cacheKey(scope: string, country: string | null, key: string): string {
  return `${scope}::${country ?? ''}::${key}`;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch the peer-norm percentage for one option. Per-key results are cached
 * for the lifetime of the page (the SQL views refresh weekly, so a single
 * tab session can safely reuse them).
 */
export function fetchPeerNorm(
  scope: PeerNormScope,
  country: string | null,
  key: string,
): Promise<PeerNormResult> {
  const ck = cacheKey(scope, country, key);
  const hit = cache.get(ck);
  if (hit) return hit;

  const promise = doFetch(scope, country, key);
  cache.set(ck, promise);
  return promise;
}

async function doFetch(
  scope: PeerNormScope,
  country: string | null,
  key: string,
): Promise<PeerNormResult> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('peer_norm_pct', {
      p_scope: scope,
      p_country: country,
      p_key: key,
    });
    if (error || !data) return { pct: null, n: 0, total: 0 };
    const row: PeerNormRow = Array.isArray(data) ? data[0] : data;
    if (!row) return { pct: null, n: 0, total: 0 };
    const n = toNum(row.n);
    const total = toNum(row.total);
    const rawPct = toNum(row.pct);
    return {
      pct: total >= MIN_N_THRESHOLD ? rawPct : null,
      n,
      total,
    };
  } catch {
    return { pct: null, n: 0, total: 0 };
  }
}

/**
 * Render the bar's HTML. Pure function so it can be unit-tested without a
 * DOM. Returns the inner HTML for a `<span data-peer-norm-bar>` host.
 */
export function renderPeerNormHtml(
  result: PeerNormResult,
  copy: { withPct: (pct: string) => string; insufficient: string },
): string {
  if (result.pct === null) {
    return `<span class="text-xs text-zinc-400 dark:text-zinc-300 italic">${escapeHtml(copy.insufficient)}</span>`;
  }
  const pctRounded = Math.round(result.pct * 10) / 10;
  const widthPct = Math.max(0, Math.min(100, result.pct));
  const label = copy.withPct(pctRounded.toString());
  return `
    <span class="inline-flex items-center gap-2">
      <span class="inline-block w-16 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" aria-hidden="true">
        <span class="block h-full bg-emerald-500 dark:bg-emerald-400" style="width: ${widthPct}%"></span>
      </span>
      <span class="text-xs text-zinc-600 dark:text-zinc-400">${escapeHtml(label)}</span>
    </span>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Test-only: clear the in-memory cache. */
export function _resetPeerNormCacheForTests(): void {
  cache.clear();
}
