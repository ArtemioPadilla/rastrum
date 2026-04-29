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

    // Idempotent re-ban: if already actively banned, return the existing row
    // instead of creating a duplicate. The audit row is still written so the
    // attempt is logged. Future v1.x might extend the existing ban's expires_at
    // if the new request has a longer duration; for v1 we just no-op.
    const { data: existing } = await admin
      .from('user_bans')
      .select('id, expires_at, reason')
      .eq('user_id', payload.target_user_id)
      .is('revoked_at', null)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .maybeSingle();

    if (existing) {
      return {
        before: existing,
        after: existing,
        target: { type: 'user', id: payload.target_user_id },
      };
    }

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
