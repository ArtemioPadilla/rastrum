import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';
import { insertAuditRow } from '../_shared/audit.ts';

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

export class SelfApprovalForbidden extends Error {
  code = 'self_approval_forbidden';
  constructor() { super('proposer cannot approve their own proposal'); }
}

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
    if (before.proposer_id === actor.id) {
      throw new SelfApprovalForbidden();
    }
    if (before.status !== 'pending') {
      throw new Error(`proposal.approve: proposal is ${before.status}, not pending`);
    }
    if (new Date(before.expires_at).getTime() <= Date.now()) {
      throw new Error('proposal.approve: proposal has expired');
    }

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

    const innerResult = await inner.execute(admin, innerPayload.data, actor, before.reason);

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
