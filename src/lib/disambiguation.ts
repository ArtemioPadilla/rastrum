/**
 * Cascade disambiguation — issue #615.
 *
 * When the cascade returns two candidates with nearly identical
 * confidence, the user is left to pick blindly. This module owns the
 * gap-rule detection and the LLM-prompt cache lookup that powers the
 * disambiguation banner. The banner UI (DisambiguationBanner.astro)
 * consumes this module's pure helpers; the LLM call itself routes
 * through the existing `identify` Edge Function so BYO/sponsor/pool
 * resolution stays unified.
 *
 * Thresholds live in `public.cascade_config` so they can be tuned
 * without a deploy. The hard-coded fallbacks below match the seeded
 * defaults (0.15 / 0.30) and act as the offline / first-load fallback.
 */
import { getSupabase } from './supabase';

export const DEFAULT_GAP_THRESHOLD = 0.15;
export const DEFAULT_MIN_CONFIDENCE = 0.30;

export interface CandidateLike {
  scientific_name: string;
  confidence: number;
}

export interface DisambiguationThresholds {
  gap: number;
  floor: number;
}

export interface DisambiguationCheck {
  trigger: boolean;
  top1?: CandidateLike;
  top2?: CandidateLike;
  reason?: 'no_alternates' | 'gap_too_wide' | 'below_floor' | 'same_taxon';
}

/**
 * Decide whether to show the disambiguation banner. Pure — give it the
 * cascade's best + alternates and the configured thresholds, get back
 * a verdict.
 *
 * Trigger when ALL of:
 *   - At least two candidates exist
 *   - top1.scientific_name !== top2.scientific_name
 *   - (top1.confidence - top2.confidence) < gap
 *   - top1.confidence >= floor AND top2.confidence >= floor
 */
export function shouldDisambiguate(
  best: CandidateLike | null,
  alternates: CandidateLike[],
  thresholds: DisambiguationThresholds = { gap: DEFAULT_GAP_THRESHOLD, floor: DEFAULT_MIN_CONFIDENCE },
): DisambiguationCheck {
  if (!best || alternates.length === 0) {
    return { trigger: false, reason: 'no_alternates' };
  }
  const top2 = alternates.find(a => a.scientific_name && a.scientific_name !== best.scientific_name);
  if (!top2) return { trigger: false, reason: 'same_taxon' };

  if (best.confidence < thresholds.floor || top2.confidence < thresholds.floor) {
    return { trigger: false, top1: best, top2, reason: 'below_floor' };
  }
  if ((best.confidence - top2.confidence) >= thresholds.gap) {
    return { trigger: false, top1: best, top2, reason: 'gap_too_wide' };
  }
  return { trigger: true, top1: best, top2 };
}

/**
 * Canonical taxon-pair key — sorts alphabetically so (A, B) and
 * (B, A) collide on the same cache row. Trimmed to defend against
 * accidental whitespace from upstream parsers.
 */
export function canonicalPair(a: string, b: string): { taxon_a: string; taxon_b: string } {
  const ta = a.trim();
  const tb = b.trim();
  return ta <= tb
    ? { taxon_a: ta, taxon_b: tb }
    : { taxon_a: tb, taxon_b: ta };
}

/**
 * Read the active thresholds from `cascade_config`. Falls back to the
 * hard-coded defaults on any error — the gap rule is best-effort, not
 * a security gate. Cached for the page lifetime to avoid re-hitting
 * PostgREST on every cascade run.
 */
let _thresholdsCache: DisambiguationThresholds | null = null;
export async function loadThresholds(): Promise<DisambiguationThresholds> {
  if (_thresholdsCache) return _thresholdsCache;
  const fallback: DisambiguationThresholds = {
    gap: DEFAULT_GAP_THRESHOLD,
    floor: DEFAULT_MIN_CONFIDENCE,
  };
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cascade_config')
      .select('key, value')
      .in('key', ['disambiguation_gap_threshold', 'disambiguation_min_confidence']);
    if (error || !Array.isArray(data)) {
      _thresholdsCache = fallback;
      return fallback;
    }
    const rows = data as Array<{ key: string; value: number }>;
    const out: DisambiguationThresholds = { ...fallback };
    for (const row of rows) {
      if (row.key === 'disambiguation_gap_threshold' && Number.isFinite(row.value)) {
        out.gap = Number(row.value);
      } else if (row.key === 'disambiguation_min_confidence' && Number.isFinite(row.value)) {
        out.floor = Number(row.value);
      }
    }
    _thresholdsCache = out;
    return out;
  } catch {
    _thresholdsCache = fallback;
    return fallback;
  }
}

/** Test-only — clears the in-memory thresholds cache. */
export function _resetThresholdsCacheForTests(): void {
  _thresholdsCache = null;
}

export interface CachedPrompt {
  prompt_en: string;
  prompt_es: string;
}

export interface FetchedPrompt extends CachedPrompt {
  cached: boolean;
  fallback?: boolean;
  reason?: string;
}

/**
 * Resolve a diagnostic prompt for a taxon pair. Hits the public cache
 * first; on miss, asks the `identify` Edge Function in disambiguate
 * mode (which routes through the existing BYO/sponsor/pool credential
 * chain). The EF returns a static fallback if no credential resolves
 * — never throws on credential exhaustion.
 *
 * `clientAnthropicKey` is forwarded so anonymous BYO callers work
 * without a Supabase session.
 */
export async function fetchDisambiguationPrompt(
  a: string,
  b: string,
  opts: { clientAnthropicKey?: string } = {},
): Promise<FetchedPrompt> {
  const taxonA = a.trim();
  const taxonB = b.trim();
  if (!taxonA || !taxonB || taxonA === taxonB) {
    return {
      prompt_en: 'These two species look very similar. A clearer photo of distinguishing features will help.',
      prompt_es: 'Estas dos especies se parecen mucho. Una foto más clara de los rasgos distintivos ayudará.',
      cached: false,
      fallback: true,
      reason: 'invalid_pair',
    };
  }

  const cached = await lookupCachedPrompt(taxonA, taxonB);
  if (cached) {
    return { ...cached, cached: true };
  }

  const supabase = getSupabase();
  const body: Record<string, unknown> = {
    observation_id: 'disambiguate-only',
    image_url: 'about:blank',
    mode: 'disambiguate',
    taxon_a: taxonA,
    taxon_b: taxonB,
  };
  if (opts.clientAnthropicKey) {
    body.client_keys = { anthropic: opts.clientAnthropicKey };
  }
  const { data, error } = await supabase.functions.invoke('identify', { body });
  if (error || !data) {
    return {
      prompt_en: 'Two close candidates. A clearer close-up of distinguishing features will help separate them.',
      prompt_es: 'Dos candidatos cercanos. Un primer plano más claro de los rasgos distintivos ayudará a diferenciarlos.',
      cached: false,
      fallback: true,
      reason: 'invoke_failed',
    };
  }
  const row = data as { prompt_en?: string; prompt_es?: string; cached?: boolean; fallback?: boolean; reason?: string };
  return {
    prompt_en: row.prompt_en ?? '',
    prompt_es: row.prompt_es ?? '',
    cached: !!row.cached,
    fallback: !!row.fallback,
    reason: row.reason,
  };
}

/**
 * Look up a cached LLM-generated diagnostic prompt for this taxon pair.
 * Returns null when the cache misses; the caller then asks the EF to
 * generate one and inserts the row.
 */
export async function lookupCachedPrompt(a: string, b: string): Promise<CachedPrompt | null> {
  const { taxon_a, taxon_b } = canonicalPair(a, b);
  if (!taxon_a || !taxon_b || taxon_a === taxon_b) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('taxon_pair_disambiguations')
      .select('prompt_en, prompt_es')
      .eq('taxon_a', taxon_a)
      .eq('taxon_b', taxon_b)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { prompt_en: string; prompt_es: string };
    return { prompt_en: row.prompt_en, prompt_es: row.prompt_es };
  } catch {
    return null;
  }
}
