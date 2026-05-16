/**
 * Pure card-state selector for the observe progressive result card.
 * No DOM / network. See
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */

// Must match ACCEPT_THRESHOLD in src/lib/identifiers/cascade.ts. The
// canonical value is asserted equal by the test (parity guard); declared
// locally so this module stays dependency-free.
const ACCEPT_THRESHOLD = 0.7;

export interface IdResult {
  scientificName: string;
  confidence: number;
  source: string;
  /** The source's confidence ceiling from the identifier registry. */
  confidenceCeiling: number;
}

export interface CardStateInput {
  provisional: IdResult | null;
  cloud: IdResult | null;
  observerAffirmed: boolean;
  online: boolean;
  hasOnDeviceModel: boolean;
}

export type CardState = 'S0' | 'S1a' | 'S1b' | 'S2' | 'S2prime' | 'S3';

function isAuthoritative(r: IdResult): boolean {
  return r.confidenceCeiling >= ACCEPT_THRESHOLD && r.confidence >= ACCEPT_THRESHOLD;
}

export function resolveCardState(input: CardStateInput): CardState {
  const { provisional, cloud, observerAffirmed, online, hasOnDeviceModel } = input;
  if (cloud) {
    if (observerAffirmed) return 'S2prime';
    // S2 only when the cloud upgrades a provisional that was NOT already
    // authoritative. An already-authoritative provisional (e.g. SpeciesNet
    // 0.85) stays collapsed — a later cloud result must not un-collapse it.
    if (provisional && !isAuthoritative(provisional)) return 'S2';
    return isAuthoritative(cloud) ? 'S1a' : 'S1b';
  }
  if (provisional) {
    return isAuthoritative(provisional) ? 'S1a' : 'S1b';
  }
  if (!online && !hasOnDeviceModel) {
    return 'S3';
  }
  return 'S0';
}
