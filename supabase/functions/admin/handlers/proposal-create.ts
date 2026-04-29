import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';
import { isIrreversibleOp } from '../_shared/irreversible.ts';

const Payload = z.object({
  targetOp:   z.string().min(1),
  targetType: z.string().min(1),
  targetId:   z.string().min(1),
  payload:    z.record(z.unknown()),
  reason:     z.string().min(5),
});
type Payload = z.infer<typeof Payload>;

// Maps a target action key (e.g. 'role.revoke') to the audit_op enum
// value persisted on the proposal row. Mirrors HANDLERS[targetOp].op
// but lives here so we don't pull a circular import.
const AUDIT_OP_BY_ACTION: Record<string, string> = {
  'role.revoke':      'role_revoke',
  'user.ban':         'user_ban',
  'observation.hide': 'observation_hide',
  'badge.revoke':     'badge_revoke',
};

export const proposalCreateHandler: ActionHandler<Payload> = {
  op: 'proposal_create',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, reason) {
    if (!isIrreversibleOp(payload.targetOp)) {
      throw new Error(`proposal.create: ${payload.targetOp} is not in IRREVERSIBLE_OPS`);
    }
    const auditOp = AUDIT_OP_BY_ACTION[payload.targetOp];
    if (!auditOp) {
      throw new Error(`proposal.create: no audit_op mapping for ${payload.targetOp}`);
    }

    const { data: inserted, error } = await admin
      .from('admin_action_proposals')
      .insert({
        proposer_id: actor.id,
        op:          auditOp,
        target_type: payload.targetType,
        target_id:   payload.targetId,
        payload:     payload.payload,
        reason:      payload.reason,
      })
      .select('id, expires_at')
      .single();
    if (error) throw new Error(`proposal.create: ${error.message}`);

    return {
      before: null,
      after: inserted,
      target: { type: 'admin_action_proposal', id: (inserted as { id: string }).id },
      result: {
        proposalId: (inserted as { id: string }).id,
        expiresAt:  (inserted as { expires_at: string }).expires_at,
      },
    };
  },
};
