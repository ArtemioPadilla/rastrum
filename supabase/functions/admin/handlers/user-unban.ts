import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  ban_id: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

export const userUnbanHandler: ActionHandler<Payload> = {
  op: 'user_unban',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, actor, reason) {
    const { data: before } = await admin
      .from('user_bans')
      .select('*')
      .eq('id', payload.ban_id)
      .eq('user_id', payload.target_user_id)
      .single();
    // Fail fast if the ban doesn't belong to the stated target — prevents
    // a mismatched (ban_id, target_user_id) pair from corrupting the audit chain.
    if (!before) throw new Error('unban: ban_id does not belong to target_user_id');

    const { data: updated, error } = await admin
      .from('user_bans')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: actor.id,
        revoke_reason: reason,
      })
      .eq('id', payload.ban_id)
      .eq('user_id', payload.target_user_id)
      .select();
    if (error) throw new Error(`user.unban: ${error.message}`);
    if (!updated || updated.length === 0) throw new Error('unban: ban_id does not belong to target_user_id');

    const { data: after } = await admin.from('user_bans').select('*').eq('id', payload.ban_id).single();

    try {
      await admin.from('notifications').insert({
        user_id: payload.target_user_id,
        kind: 'ban_lifted',
        payload: {
          ban_id: payload.ban_id,
          revoke_reason: reason,
        },
      });
    } catch (notifErr) {
      console.warn('[user.unban] notification insert failed:', notifErr);
    }

    return { before, after, target: { type: 'user', id: payload.target_user_id } };
  },
};
