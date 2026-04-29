/**
 * PR14 enforcement gate for the four irreversible ops listed in
 * IRREVERSIBLE_OPS. When the `enforce_two_person_irreversible` feature
 * flag is enabled, the dispatcher MUST reject direct calls to those
 * ops UNLESS the call is being invoked from proposal.approve — which
 * marks its inner dispatch with the internal-only `_via_proposal`
 * field on the payload.
 *
 * Rolled out behind a feature flag so flipping it without prior
 * coordination doesn't break existing admin workflows. Operators
 * enable the flag once they trust the Proposals queue is being used.
 */
import { isIrreversibleOp } from './irreversible.ts';

export type EnforcementResult =
  | { allowed: true }
  | { allowed: false; code: 'direct_irreversible_call_forbidden'; reason: string };

/**
 * Pure decision: should this dispatch be allowed?
 *
 * - If the flag is off → always allowed (preserves the existing direct
 *   call path).
 * - If the op is not in IRREVERSIBLE_OPS → allowed (only the four
 *   highest-risk ops are gated).
 * - If the payload is marked `_via_proposal: true` → allowed (the
 *   approver is executing the underlying op).
 * - Otherwise → forbidden, with an HTTP 403 code.
 */
export function checkIrreversibleEnforcement(
  op: string,
  payload: unknown,
  flagEnabled: boolean,
): EnforcementResult {
  if (!flagEnabled) return { allowed: true };
  if (!isIrreversibleOp(op)) return { allowed: true };
  if (isViaProposal(payload)) return { allowed: true };
  return {
    allowed: false,
    code: 'direct_irreversible_call_forbidden',
    reason:
      `${op} is irreversible and the enforce_two_person_irreversible flag is enabled. ` +
      'File a proposal via proposal.create and have a second admin call proposal.approve.',
  };
}

function isViaProposal(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const v = (payload as { _via_proposal?: unknown })._via_proposal;
  return v === true;
}

/**
 * Strip the internal-only `_via_proposal` marker before passing the
 * payload to the underlying handler's Zod schema (which is `strict()`
 * in some handlers and would reject unknown keys).
 */
export function stripViaProposal<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const copy: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete copy._via_proposal;
  return copy as T;
}
