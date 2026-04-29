import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({
  key: z.string().min(1),
  value: z.boolean(),
});
type Payload = z.infer<typeof Payload>;

export const featureFlagToggleHandler: ActionHandler<Payload> = {
  op: 'feature_flag_toggle',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin: SupabaseClient, payload: Payload, actor: Actor, _reason: string): Promise<ActionResult> {
    const { data: before, error: fetchErr } = await admin
      .from('app_feature_flags')
      .select('*')
      .eq('key', payload.key)
      .maybeSingle();

    if (fetchErr) throw new Error(`feature_flag.toggle fetch: ${fetchErr.message}`);
    if (!before) throw new Error(`feature_flag.toggle: key not found: ${payload.key}`);

    const { data: after, error: updateErr } = await admin
      .from('app_feature_flags')
      .update({
        value: payload.value,
        updated_at: new Date().toISOString(),
        updated_by: actor.id,
      })
      .eq('key', payload.key)
      .select('*')
      .single();

    if (updateErr) throw new Error(`feature_flag.toggle update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'feature_flag', id: payload.key },
    };
  },
};
