import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  badge_key: z.string().min(1),
});
type Payload = z.infer<typeof Payload>;

export const badgeAwardManualHandler: ActionHandler<Payload> = {
  op: 'badge_award_manual',
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
      .upsert(
        {
          user_id: payload.target_user_id,
          badge_key: payload.badge_key,
          awarded_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'user_id,badge_key', ignoreDuplicates: true },
      );

    if (error) throw new Error(`badge.award_manual: ${error.message}`);

    const { data: after } = await admin
      .from('user_badges')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('badge_key', payload.badge_key)
      .maybeSingle();

    return {
      before,
      after,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
