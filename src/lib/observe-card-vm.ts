/**
 * Pure composer: ties the three card resolvers into one view model the
 * DOM render layer consumes. No DOM / network / i18n (the render layer
 * localizes static chrome; sourceLabel is data). See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */
import { resolveCardState, type IdResult, type CardState } from './observe-card-state';
import { resolveSovereignty, type SovereigntyAction } from './observe-sovereignty';
import { buildAuditTrace, type IdAttempt, type TraceEntry } from './observe-audit-trace';

export interface CardVmInput {
  provisional: IdResult | null;
  cloud: IdResult | null;
  observerAffirmed: boolean;
  reviewRequested: boolean;
  online: boolean;
  hasOnDeviceModel: boolean;
  attempts: IdAttempt[];
}

export interface CardViewModel {
  state: CardState;
  sovereignty: SovereigntyAction;
  reviewRequested: boolean;
  trace: TraceEntry[];
  /** Scientific name the card displays, or null when nothing resolved. */
  headline: string | null;
  /** Data label "source · NN%", or null when nothing resolved. */
  sourceLabel: string | null;
}

function labelFor(r: IdResult): string {
  return `${r.source} · ${Math.round(r.confidence * 100)}%`;
}

export function buildCardViewModel(input: CardVmInput): CardViewModel {
  const state = resolveCardState({
    provisional: input.provisional,
    cloud: input.cloud,
    observerAffirmed: input.observerAffirmed,
    online: input.online,
    hasOnDeviceModel: input.hasOnDeviceModel,
  });
  const sovereignty = resolveSovereignty({
    observerAffirmed: input.observerAffirmed,
    cloudArrived: input.cloud !== null,
  });
  const trace = buildAuditTrace(input.attempts);

  const primary: IdResult | null =
    input.observerAffirmed && input.provisional
      ? input.provisional
      : input.cloud ?? input.provisional;

  return {
    state,
    sovereignty,
    reviewRequested: input.reviewRequested,
    trace,
    headline: primary ? primary.scientificName : null,
    sourceLabel: primary ? labelFor(primary) : null,
  };
}
