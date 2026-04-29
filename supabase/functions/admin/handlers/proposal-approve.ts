import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';
import { insertAuditRow } from '../_shared/audit.ts';
import { assertProposalApprovable } from '../_shared/proposal-guards.ts';

const Payload = z.object({
  proposalId: z.string().uuid(),
  notes:      z.string().max(2000).optional(),
});
type Payload = z.infer<typeof Payload>;

// Inverse of AUDIT_OP_BY_ACTION in proposal-create. Resolves the persisted
// audit_op enum value back to the action key registered in HANDLERS[].
const ACTION_BY_AUDIT_OP: Record<string, string> = {
  role_revoke:      'role.revoke',
  user_ban:         'user.ban',
  observation_hide: 'observation.hide',
  badge_revoke:     'badge.revoke',
};

export const proposalApproveHandler: ActionHandler<Payload> = {
  op: 'proposal_approve',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('admin_action_proposals')
      .select('*')
      .eq('id', payload.proposalId)
      .single();
    if (fetchErr) throw new Error(`proposal.approve fetch: ${fetchErr.message}`);
    if (!before) throw new Error('proposal.approve: proposal not found');
    assertProposalApprovable(before, actor.id);

    // Lazy-import the registry to dodge the circular dependency
    // (handlers/index.ts imports this file).
    const { HANDLERS } = await import('./index.ts');
    const action = ACTION_BY_AUDIT_OP[before.op];
    if (!action) throw new Error(`proposal.approve: no action for op ${before.op}`);
    const inner = HANDLERS[action];
    if (!inner) throw new Error(`proposal.approve: handler not registered for ${action}`);

    const innerPayload = inner.payloadSchema.safeParse(before.payload);
    if (!innerPayload.success) {
      throw new Error(`proposal.approve: invalid stored payload: ${JSON.stringify(innerPayload.error.issues)}`);
    }

    // PR14: defense-in-depth. The current path calls inner.execute()
    // directly (bypassing the dispatcher), so the dispatcher's
    // enforce_two_person_irreversible gate doesn't fire here. If a
    // future refactor ever round-trips this through the dispatcher,
    // the _via_proposal marker tells the gate this is the second-leg
    // of a proposal flow and not a direct call.
    const innerData = { ...(innerPayload.data as Record<string, unknown>), _via_proposal: true };
    const innerResult = await inner.execute(admin, innerData, actor, before.reason);

    const innerAuditId = await insertAuditRow(admin, {
      actor_id: actor.id,
      op: inner.op,
      target_type: innerResult.target.type,
      target_id:   innerResult.target.id,
      before:      innerResult.before ?? null,
      after:       innerResult.after  ?? null,
      reason:      before.reason,
      ip:          null,
      user_agent:  null,
    });

    const { data: after, error: updateErr } = await admin
      .from('admin_action_proposals')
      .update({
        status:            'executed',
        approver_id:       actor.id,
        approved_at:       new Date().toISOString(),
        executed_at:       new Date().toISOString(),
        executed_audit_id: innerAuditId,
      })
      .eq('id', payload.proposalId)
      .eq('status', 'pending')
      .select('*')
      .single();
    if (updateErr) throw new Error(`proposal.approve update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'admin_action_proposal', id: payload.proposalId },
      result: { executedAuditId: innerAuditId, notes: payload.notes ?? null },
    };
  },
};
