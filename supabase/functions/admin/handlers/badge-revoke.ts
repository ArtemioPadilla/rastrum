import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  badge_key: z.string().min(1),
});
type Payload = z.infer<typeof Payload>;

export const badgeRevokeHandler: ActionHandler<Payload> = {
  op: 'badge_revoke',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin: SupabaseClient, payload: Payload, _actor: Actor, _reason: string): Promise<ActionResult> {
    const { data: before } = await admin
      .from('user_badges')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('badge_key', payload.badge_key)
      .maybeSingle();

    const { error } = await admin
      .from('user_badges')
      .delete()
      .eq('user_id', payload.target_user_id)
      .eq('badge_key', payload.badge_key);

    if (error) throw new Error(`badge.revoke: ${error.message}`);

    return {
      before,
      after: null,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
