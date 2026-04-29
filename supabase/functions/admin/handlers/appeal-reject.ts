import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  appeal_id: z.string().uuid(),
  reviewer_note: z.string().max(500).optional(),
});
type Payload = z.infer<typeof Payload>;

export const appealRejectHandler: ActionHandler<Payload> = {
  op: 'appeal_rejected',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, actor, reason) {
    const { data: appeal, error: fetchErr } = await admin
      .from('ban_appeals')
      .select('id, ban_id, appellant_id, status')
      .eq('id', payload.appeal_id)
      .single();
    if (fetchErr || !appeal) throw new Error(`appeal.reject: appeal not found`);
    if (appeal.status !== 'pending') throw new Error(`appeal.reject: appeal is already ${appeal.status}`);

    const now = new Date().toISOString();

    const { error: appealErr } = await admin
      .from('ban_appeals')
      .update({
        status: 'rejected',
        reviewer_id: actor.id,
        reviewer_note: payload.reviewer_note ?? reason,
        reviewed_at: now,
      })
      .eq('id', payload.appeal_id);
    if (appealErr) throw new Error(`appeal.reject: update failed: ${appealErr.message}`);

    try {
      await admin.from('notifications').insert({
        user_id: appeal.appellant_id,
        kind: 'appeal_rejected',
        payload: {
          ban_id: appeal.ban_id,
          appeal_id: appeal.id,
          reviewer_note: payload.reviewer_note ?? reason,
        },
      });
    } catch (notifErr) {
      console.warn('[appeal.reject] notification insert failed:', notifErr);
    }

    return {
      before: { status: 'pending' },
      after: { status: 'rejected' },
      target: { type: 'ban_appeal', id: payload.appeal_id },
    };
  },
};
