import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({});
type Payload = z.infer<typeof Payload>;

export const taxonRecomputeRarityHandler: ActionHandler<Payload> = {
  op: 'cron_force_run',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin: SupabaseClient, _payload: Payload, _actor: Actor, _reason: string): Promise<ActionResult> {
    const { error } = await admin.rpc('refresh_taxon_rarity');
    if (error) throw new Error(`taxon.recompute_rarity: ${error.message}`);

    return {
      before: null,
      after: null,
      target: { type: 'cron', id: 'refresh_taxon_rarity' },
    };
  },
};
