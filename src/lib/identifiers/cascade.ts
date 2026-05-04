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
import { isFilteredFrameError } from './errors';

export const ACCEPT_THRESHOLD = 0.7;

const LICENSE_COST: Record<string, number> = {
  'free': 0,
  'free-nc': 1,
  'free-quota': 2,
  'byo-key': 3,
  'paid': 4,
};

/**
 * Live attempt event — fired by runCascade for each plugin's lifecycle
 * transitions when `onAttempt` is supplied. Lets the UI render the cascade
 * decision tree in real time (#592).
 *
 * State transitions:
 *   skipped — isAvailable returned ready=false (no key, no download, etc.)
 *   starting — about to call plugin.identify
 *   accepted — confidence ≥ ACCEPT_THRESHOLD (cascade stops after this)
 *   rejected — ran but below threshold; cascade continues
 *   failed — threw an unrecognized error
 *   filtered — threw FilteredFrameError; cascade hard-stops
 */
export type CascadeAttemptState =
  | 'skipped' | 'starting' | 'accepted' | 'rejected' | 'failed' | 'filtered';

export interface CascadeAttemptEvent {
  id: string;
  state: CascadeAttemptState;
  result?: IDResult;
  error?: string;
  reason?: string;
}

export interface CascadeOptions {
  media: MediaKind;
  /** Hint such as 'Plantae' / 'Animalia.Aves' */
  taxa?: string;
  /** Override sort order — lets the UI offer a manual "use this first" choice. */
  preferred?: string[];
  /** Skip identifiers entirely (e.g. user disabled them in profile). */
  excluded?: string[];
  /** Live event hook — fires for every plugin lifecycle transition (#592). */
  onAttempt?: (event: CascadeAttemptEvent) => void;
}

export interface CascadeResult {
  best: IDResult | null;
  attempts: Array<{ id: string; ok: boolean; result?: IDResult; error?: string }>;
  /**
   * Set when a plugin threw `FilteredFrameError` — the cascade stopped
   * because the frame doesn't contain anything to identify (empty / human
   * / vehicle). Callers should mark the row `status='needs_review'` and
   * preserve the source + label in raw_response.
   */
  filtered?: { source: string; label: 'empty' | 'human' | 'vehicle'; raw?: unknown };
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
  // Bbox forwarded from a prior plugin (today: only MegaDetector
  // attaches `animal_bbox` to its fall-through error). Subsequent
  // plugins receive this as IdentifyInput.mediaCrop and may pre-crop
  // before running inference for a ×3-5 accuracy bump on small
  // subjects in distant camera-trap frames.
  let mediaCrop: IdentifyInput['mediaCrop'] = input.mediaCrop;

  for (const plugin of candidates) {
    const av = await plugin.isAvailable();
    if (!av.ready) {
      const reason = av.reason + (av.message ? `: ${av.message}` : '');
      attempts.push({ id: plugin.id, ok: false, error: reason });
      opts.onAttempt?.({ id: plugin.id, state: 'skipped', reason: av.reason });
      continue;
    }
    try {
      opts.onAttempt?.({ id: plugin.id, state: 'starting' });
      const result = await plugin.identify({
        ...input,
        prior_candidates: priorCandidates,
        mediaCrop,
      });
      attempts.push({ id: plugin.id, ok: true, result });
      const ceiling = plugin.capabilities.confidence_ceiling ?? 1;
      if (result.confidence > ceiling) result.confidence = ceiling;
      if (!best || result.confidence > best.confidence) best = result;
      priorCandidates.push({ scientific_name: result.scientific_name, confidence: result.confidence });
      if (result.confidence >= ACCEPT_THRESHOLD) {
        opts.onAttempt?.({ id: plugin.id, state: 'accepted', result });
        break;
      }
      opts.onAttempt?.({ id: plugin.id, state: 'rejected', result });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      attempts.push({ id: plugin.id, ok: false, error: errMsg });
      if (isFilteredFrameError(e)) {
        opts.onAttempt?.({ id: plugin.id, state: 'filtered', reason: e.filtered_label });
        return {
          best: null,
          attempts,
          filtered: { source: e.source, label: e.filtered_label, raw: e.raw },
        };
      }
      opts.onAttempt?.({ id: plugin.id, state: 'failed', error: errMsg });
      const errBbox = (e as { animal_bbox?: number[] }).animal_bbox;
      if (Array.isArray(errBbox) && errBbox.length === 4) {
        mediaCrop = {
          bbox: errBbox as [number, number, number, number],
          source: plugin.id,
        };
      }
    }
  }

  return { best, attempts };
}
