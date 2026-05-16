/**
 * Pure resolver for the "observer affirmation is sovereign" rule. The
 * machine never overrides an explicit human identification. See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md.
 */
export interface SovereigntyInput {
  observerAffirmed: boolean;
  cloudArrived: boolean;
}

export type SovereigntyAction = 'upgrade-primary' | 'parallel-suggestion' | 'none';

export function resolveSovereignty(input: SovereigntyInput): SovereigntyAction {
  if (!input.cloudArrived) return 'none';
  return input.observerAffirmed ? 'parallel-suggestion' : 'upgrade-primary';
}
