import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  duration_hours: z.number().int().positive().nullable(),
});
type Payload = z.infer<typeof Payload>;

export const userBanHandler: ActionHandler<Payload> = {
  op: 'user_ban',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, actor, reason) {
    const expiresAt = payload.duration_hours !== null
      ? new Date(Date.now() + payload.duration_hours * 3_600_000).toISOString()
      : null;

    const { error } = await admin.from('user_bans').insert({
      user_id: payload.target_user_id,
      banned_by: actor.id,
      reason,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`user.ban: ${error.message}`);

    const { data: after } = await admin
      .from('user_bans')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return { before: null, after, target: { type: 'user', id: payload.target_user_id } };
  },
};
