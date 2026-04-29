/**
 * Pure-function precondition checks for the proposal-approve handler.
 *
 * Extracted into _shared so the same logic can be unit-tested from Vitest
 * without pulling in any Deno-only globals (esm.sh URL imports, etc.).
 * The proposal-approve handler imports these and throws on the first
 * failed precondition.
 */

export class SelfApprovalForbiddenError extends Error {
  code = 'self_approval_forbidden' as const;
  constructor() {
    super('proposer cannot approve their own proposal');
  }
}

export class ProposalNotPendingError extends Error {
  code = 'proposal_not_pending' as const;
  constructor(public actualStatus: string) {
    super(`proposal is ${actualStatus}, not pending`);
  }
}

export class ProposalExpiredError extends Error {
  code = 'proposal_expired' as const;
  constructor() {
    super('proposal has expired');
  }
}

export interface ProposalRowLike {
  proposer_id: string;
  status: string;
  expires_at: string;
}

/**
 * Throws on any precondition failure. The dispatcher converts thrown
 * Errors to HTTP 500 responses with the message body; the .code property
 * is preserved for receivers that want to distinguish failure modes.
 */
export function assertProposalApprovable(
  proposal: ProposalRowLike,
  approverId: string,
  now: Date = new Date(),
): void {
  if (proposal.proposer_id === approverId) {
    throw new SelfApprovalForbiddenError();
  }
  if (proposal.status !== 'pending') {
    throw new ProposalNotPendingError(proposal.status);
  }
  if (new Date(proposal.expires_at).getTime() <= now.getTime()) {
    throw new ProposalExpiredError();
  }
}
