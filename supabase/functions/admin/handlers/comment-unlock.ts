import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({ comment_id: z.string().uuid() });
type Payload = z.infer<typeof Payload>;

export const commentUnlockHandler: ActionHandler<Payload> = {
  op: 'comment_unlock',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before } = await admin.from('observation_comments').select('id, deleted_at, locked').eq('id', payload.comment_id).single();
    if (!before) throw new Error('comment.unlock: target not found');
    const { error } = await admin.from('observation_comments').update({ locked: false }).eq('id', payload.comment_id);
    if (error) throw new Error(`comment.unlock: ${error.message}`);
    const { data: after } = await admin.from('observation_comments').select('id, deleted_at, locked').eq('id', payload.comment_id).single();
    return { before, after, target: { type: 'comment', id: payload.comment_id } };
  },
};
