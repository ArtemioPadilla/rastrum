/**
 * Unit test for the proposal-approve precondition guards.
 *
 * The guard helper lives in supabase/functions/admin/_shared/proposal-guards.ts
 * and has zero Deno-only imports — same pattern as csv.ts and
 * webhook-signature.ts. The Edge handler imports + calls
 * assertProposalApprovable() before doing any database work.
 *
 * Coverage:
 *   1. Proposer trying to approve their own proposal → SelfApprovalForbiddenError.
 *   2. The error carries a stable .code = 'self_approval_forbidden' that
 *      receivers can switch on.
 *   3. Approving a non-pending proposal throws the right error type.
 *   4. Approving an expired proposal throws the right error type.
 *   5. Happy path: different approver_id + pending + future expiry → no throw.
 */
import { describe, it, expect } from 'vitest';
import {
  assertProposalApprovable,
  SelfApprovalForbiddenError,
  ProposalNotPendingError,
  ProposalExpiredError,
} from '../../supabase/functions/admin/_shared/proposal-guards';

const proposerId = '00000000-0000-0000-0000-0000000000a1';
const approverId = '00000000-0000-0000-0000-0000000000a2';
const farFuture  = new Date(Date.now() + 60_000).toISOString();
const farPast    = new Date(Date.now() - 60_000).toISOString();

describe('assertProposalApprovable', () => {
  it('throws SelfApprovalForbiddenError when approver = proposer', () => {
    const err = (() => {
      try {
        assertProposalApprovable(
          { proposer_id: proposerId, status: 'pending', expires_at: farFuture },
          proposerId,
        );
      } catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(SelfApprovalForbiddenError);
    expect((err as SelfApprovalForbiddenError).code).toBe('self_approval_forbidden');
  });

  it('throws ProposalNotPendingError on already-rejected proposal', () => {
    const err = (() => {
      try {
        assertProposalApprovable(
          { proposer_id: proposerId, status: 'rejected', expires_at: farFuture },
          approverId,
        );
      } catch (e) { return e; }
    })();
    expect(err).toBeInstanceOf(ProposalNotPendingError);
    expect((err as ProposalNotPendingError).actualStatus).toBe('rejected');
  });

  it('throws ProposalNotPendingError on already-executed proposal', () => {
    expect(() => {
      assertProposalApprovable(
        { proposer_id: proposerId, status: 'executed', expires_at: farFuture },
        approverId,
      );
    }).toThrow(ProposalNotPendingError);
  });

  it('throws ProposalExpiredError when expires_at is in the past', () => {
    expect(() => {
      assertProposalApprovable(
        { proposer_id: proposerId, status: 'pending', expires_at: farPast },
        approverId,
      );
    }).toThrow(ProposalExpiredError);
  });

  it('does not throw when approver differs, proposal is pending, and expiry is in the future', () => {
    expect(() => {
      assertProposalApprovable(
        { proposer_id: proposerId, status: 'pending', expires_at: farFuture },
        approverId,
      );
    }).not.toThrow();
  });

  it('checks self-approval before status (proposer_id wins)', () => {
    // If we ever flip the order, a self-approval on an already-rejected
    // proposal would surface as ProposalNotPending — masking the more
    // important policy violation.
    expect(() => {
      assertProposalApprovable(
        { proposer_id: proposerId, status: 'rejected', expires_at: farFuture },
        proposerId,
      );
    }).toThrow(SelfApprovalForbiddenError);
  });
});
