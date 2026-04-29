/**
 * Catalogue of "irreversible" admin actions that benefit from the
 * two-person rule. Used by proposal-create to validate that a proposal
 * is being filed for an op that's actually in the catalogue, and by the
 * console UI to decide whether the "Require approval" toggle is shown.
 *
 * Adding to this set is forward-compatible — existing direct-call paths
 * are not blocked. v1 ships with the four highest-risk ops; v2 may
 * tighten enforcement to require proposals for these ops.
 */
export const IRREVERSIBLE_OPS = [
  'role.revoke',
  'user.ban',
  'observation.hide',
  'badge.revoke',
] as const;

export type IrreversibleOp = (typeof IRREVERSIBLE_OPS)[number];

export function isIrreversibleOp(op: string): op is IrreversibleOp {
  return (IRREVERSIBLE_OPS as readonly string[]).includes(op);
}
