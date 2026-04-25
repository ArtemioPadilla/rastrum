/**
 * Cascade engine — decides which registered identifiers to call for a
 * given observation, in what order, until one returns a result above the
 * accept threshold.
 *
 * The default policy:
 *   1. Filter to plugins that match (media, taxa).
 *   2. Sort by (license cost ascending, confidence_ceiling descending).
 *      Free plugins go first; among equally-licensed ones, the one with
 *      the higher confidence ceiling goes first.
 *   3. Call them in order, passing earlier candidates forward as context.
 *   4. Stop on the first result whose confidence ≥ ACCEPT_THRESHOLD,
 *      or fall through to the next.
 *
 * The cascade returns the BEST result seen across all attempts (so we
 * always have something to write into identifications, even at low
 * confidence). Callers can inspect the returned result's confidence and
 * route accordingly (e.g. mark `status = 'needs_review'` when low).
 */
import { registry } from './registry';
import type { IDResult, IdentifyInput, MediaKind } from './types';

export const ACCEPT_THRESHOLD = 0.7;

const LICENSE_COST: Record<string, number> = {
  'free': 0,
  'free-nc': 1,
  'free-quota': 2,
  'byo-key': 3,
  'paid': 4,
};

export interface CascadeOptions {
  media: MediaKind;
  /** Hint such as 'Plantae' / 'Animalia.Aves' */
  taxa?: string;
  /** Override sort order — lets the UI offer a manual "use this first" choice. */
  preferred?: string[];
  /** Skip identifiers entirely (e.g. user disabled them in profile). */
  excluded?: string[];
}

export interface CascadeResult {
  best: IDResult | null;
  attempts: Array<{ id: string; ok: boolean; result?: IDResult; error?: string }>;
}

export async function runCascade(input: IdentifyInput, opts: CascadeOptions): Promise<CascadeResult> {
  let candidates = registry.findFor({ media: opts.media, taxa: opts.taxa });
  if (opts.excluded?.length) {
    candidates = candidates.filter(c => !opts.excluded!.includes(c.id));
  }

  const preferIdx = (id: string) => opts.preferred?.indexOf(id) ?? -1;
  candidates.sort((a, b) => {
    const pa = preferIdx(a.id), pb = preferIdx(b.id);
    if (pa !== -1 || pb !== -1) {
      // preferred items first, in declared order
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    const ca = LICENSE_COST[a.capabilities.license] ?? 5;
    const cb = LICENSE_COST[b.capabilities.license] ?? 5;
    if (ca !== cb) return ca - cb;
    const ka = a.capabilities.confidence_ceiling ?? 1;
    const kb = b.capabilities.confidence_ceiling ?? 1;
    return kb - ka;
  });

  const attempts: CascadeResult['attempts'] = [];
  let best: IDResult | null = null;
  const priorCandidates: Array<Pick<IDResult, 'scientific_name' | 'confidence'>> = [];

  for (const plugin of candidates) {
    const av = await plugin.isAvailable();
    if (!av.ready) {
      attempts.push({ id: plugin.id, ok: false, error: av.reason + (av.message ? `: ${av.message}` : '') });
      continue;
    }
    try {
      const result = await plugin.identify({ ...input, prior_candidates: priorCandidates });
      attempts.push({ id: plugin.id, ok: true, result });
      // Always cap to the plugin's ceiling.
      const ceiling = plugin.capabilities.confidence_ceiling ?? 1;
      if (result.confidence > ceiling) result.confidence = ceiling;
      if (!best || result.confidence > best.confidence) best = result;
      priorCandidates.push({ scientific_name: result.scientific_name, confidence: result.confidence });
      if (result.confidence >= ACCEPT_THRESHOLD) break;   // good enough
    } catch (e) {
      attempts.push({ id: plugin.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { best, attempts };
}
