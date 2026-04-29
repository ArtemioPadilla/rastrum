import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({
  taxon_id: z.string().uuid(),
  flag: z.enum(['nom059_status', 'cites_appendix', 'iucn_category']),
  value: z.string().nullable(),
});
type Payload = z.infer<typeof Payload>;

export const taxonToggleConservationHandler: ActionHandler<Payload> = {
  op: 'taxon_conservation_set',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin: SupabaseClient, payload: Payload, _actor: Actor, _reason: string): Promise<ActionResult> {
    const { data: before, error: fetchErr } = await admin
      .from('taxa')
      .select('id, nom059_status, cites_appendix, iucn_category')
      .eq('id', payload.taxon_id)
      .single();

    if (fetchErr) throw new Error(`taxon.toggle_conservation fetch: ${fetchErr.message}`);

    const { data: after, error: updateErr } = await admin
      .from('taxa')
      .update({ [payload.flag]: payload.value, updated_at: new Date().toISOString() })
      .eq('id', payload.taxon_id)
      .select('id, nom059_status, cites_appendix, iucn_category')
      .single();

    if (updateErr) throw new Error(`taxon.toggle_conservation update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'taxon', id: payload.taxon_id },
    };
  },
};
