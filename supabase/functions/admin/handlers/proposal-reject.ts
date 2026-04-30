import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  proposalId: z.string().uuid(),
  reason:     z.string().min(5),
});
type Payload = z.infer<typeof Payload>;

export const proposalRejectHandler: ActionHandler<Payload> = {
  op: 'proposal_reject',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('admin_action_proposals')
      .select('*')
      .eq('id', payload.proposalId)
      .single();
    if (fetchErr) throw new Error(`proposal.reject fetch: ${fetchErr.message}`);
    if (!before) throw new Error('proposal.reject: proposal not found');
    if (before.status !== 'pending') {
      throw new Error(`proposal.reject: proposal is ${before.status}, not pending`);
    }

    const { data: after, error: updateErr } = await admin
      .from('admin_action_proposals')
      .update({
        status:       'rejected',
        approver_id:  actor.id,
        rejected_at:  new Date().toISOString(),
      })
      .eq('id', payload.proposalId)
      .eq('status', 'pending')
      .select('*')
      .single();
    if (updateErr) throw new Error(`proposal.reject update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'admin_action_proposal', id: payload.proposalId },
    };
  },
};
