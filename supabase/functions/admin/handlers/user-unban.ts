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
    const { data: before } = await admin.from('user_bans').select('*').eq('id', payload.ban_id).single();
    if (!before) throw new Error('user.unban: ban not found');

    const { error } = await admin.from('user_bans').update({
      revoked_at: new Date().toISOString(),
      revoked_by: actor.id,
      revoke_reason: reason,
    }).eq('id', payload.ban_id);
    if (error) throw new Error(`user.unban: ${error.message}`);

    const { data: after } = await admin.from('user_bans').select('*').eq('id', payload.ban_id).single();
    return { before, after, target: { type: 'user', id: payload.target_user_id } };
  },
};
