import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({ appeal_id: z.string().uuid() });
type Payload = z.infer<typeof Payload>;

export const appealAcceptHandler: ActionHandler<Payload> = {
  op: 'appeal_accepted',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, actor, reason) {
    const { data: appeal, error: fetchErr } = await admin
      .from('ban_appeals')
      .select('id, ban_id, appellant_id, status')
      .eq('id', payload.appeal_id)
      .single();
    if (fetchErr || !appeal) throw new Error(`appeal.accept: appeal not found`);
    if (appeal.status !== 'pending') throw new Error(`appeal.accept: appeal is already ${appeal.status}`);

    const now = new Date().toISOString();

    const { error: appealErr } = await admin
      .from('ban_appeals')
      .update({ status: 'accepted', reviewer_id: actor.id, reviewed_at: now })
      .eq('id', payload.appeal_id);
    if (appealErr) throw new Error(`appeal.accept: update appeal failed: ${appealErr.message}`);

    const { error: banErr } = await admin
      .from('user_bans')
      .update({ revoked_at: now, revoked_by: actor.id, revoke_reason: 'appeal accepted: ' + reason })
      .eq('id', appeal.ban_id)
      .is('revoked_at', null);
    if (banErr) throw new Error(`appeal.accept: revoke ban failed: ${banErr.message}`);

    try {
      await admin.from('notifications').insert({
        user_id: appeal.appellant_id,
        kind: 'ban_lifted',
        payload: {
          ban_id: appeal.ban_id,
          appeal_id: appeal.id,
          revoke_reason: 'appeal accepted',
        },
      });
    } catch (notifErr) {
      console.warn('[appeal.accept] notification insert failed:', notifErr);
    }

    return {
      before: { status: 'pending' },
      after: { status: 'accepted' },
      target: { type: 'ban_appeal', id: payload.appeal_id },
    };
  },
};
