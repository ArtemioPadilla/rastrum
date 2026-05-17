/**
 * Pure mapper: cascade IdentifyAttempt[] + run context → CardVmInput.
 * The cascade has no per-attempt timestamp, so all trace rows share
 * ctx.now (acceptable v1 — buildAuditTrace sorts stably). No DOM/network.
 */
import type { IdentifyAttempt } from './identify-cascade-client';
import type { CardVmInput } from './observe-card-vm';
import type { IdResult } from './observe-card-state';
import type { IdAttempt } from './observe-audit-trace';

const CEILING: Record<string, number> = {
  onnx_efficientnet_lite0: 0.4,
  camera_trap_megadetector: 0.4,
  webllm_phi35_vision: 0.35,
  phi_vision: 0.35,
  onnx_gemma4_vision: 0.35,
  speciesnet: 0.85,
};
function ceilingFor(source: string): number {
  return CEILING[source] ?? 1; // cloud / uncapped / unknown
}

const CLOUD_SOURCES = new Set<string>(['plantnet', 'claude_haiku', 'claude_sonnet']);
function isCloud(source: string): boolean {
  return CLOUD_SOURCES.has(source);
}

export interface AttemptsToVmContext {
  observerAffirmed: boolean;
  reviewRequested: boolean;
  online: boolean;
  hasOnDeviceModel: boolean;
  /** ISO timestamp applied to every trace row (cascade has no per-attempt time). */
  now: string;
}

export function attemptsToCardVmInput(
  attempts: IdentifyAttempt[],
  ctx: AttemptsToVmContext,
): CardVmInput {
  const usable = attempts.filter((a) => !a.error && a.scientific_name);
  const bestOf = (pred: (s: string) => boolean): IdResult | null => {
    const pool = usable.filter((a) => pred(a.source));
    if (pool.length === 0) return null;
    const b = pool.reduce((m, a) => (a.confidence > m.confidence ? a : m));
    return {
      scientificName: b.scientific_name as string,
      confidence: b.confidence,
      source: b.source,
      confidenceCeiling: ceilingFor(b.source),
    };
  };
  const provisional = bestOf((s) => !isCloud(s));
  const cloud = bestOf((s) => isCloud(s));
  const primarySource = cloud?.source ?? provisional?.source ?? null;

  const trace: IdAttempt[] = attempts.map((a) => ({
    source: a.source,
    where: isCloud(a.source) ? 'cloud' : 'device',
    scientificName: a.error ? null : a.scientific_name,
    confidence: a.confidence,
    isPrimary: !a.error && !!a.scientific_name && a.source === primarySource,
    createdAt: ctx.now,
  }));

  return {
    provisional,
    cloud,
    observerAffirmed: ctx.observerAffirmed,
    reviewRequested: ctx.reviewRequested,
    online: ctx.online,
    hasOnDeviceModel: ctx.hasOnDeviceModel,
    attempts: trace,
  };
}
