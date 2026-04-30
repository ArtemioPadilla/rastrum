/**
 * user-merge handler — merge two accounts belonging to the same person.
 *
 * Marked as irreversible: the two-person-rule gate (PR14) fires before
 * execute() is called when enforce_two_person_irreversible is true.
 *
 * The heavy FK-rewrite logic lives in the merge_user_accounts() SECURITY
 * DEFINER RPC (see supabase-schema.sql) so all table touches run in one
 * transaction and any partial failure rolls back automatically.
 *
 * Op: user.merge
 * Required role: admin
 * Irreversible: true
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor } from '../_shared/auth.ts';
import type { ActionHandler, ActionResult } from './role-grant.ts';

const Payload = z.object({
  keep_user_id:    z.string().uuid(),
  discard_user_id: z.string().uuid(),
  /** Confirms the operator manually verified both accounts belong to the same person. */
  confirmed_same_person: z.literal(true),
});
type Payload = z.infer<typeof Payload>;

export const userMergeHandler: ActionHandler<Payload> = {
  op: 'user.merge',
  requiredRole: 'admin',
  payloadSchema: Payload,
  irreversible: true,

  async execute(admin: SupabaseClient, payload: Payload, actor: Actor, reason: string): Promise<ActionResult> {
    if (payload.keep_user_id === payload.discard_user_id) {
      throw new Error('keep_user_id and discard_user_id must be different accounts');
    }

    // Fetch both users for the before snapshot
    const [keepSnap, discardSnap] = await Promise.all([
      admin.from('users').select('id, username, display_name, created_at').eq('id', payload.keep_user_id).single(),
      admin.from('users').select('id, username, display_name, created_at').eq('id', payload.discard_user_id).single(),
    ]);

    if (keepSnap.error)    throw new Error(`keep user not found: ${keepSnap.error.message}`);
    if (discardSnap.error) throw new Error(`discard user not found: ${discardSnap.error.message}`);

    // Run the merge RPC — single transaction, all FK rewrites
    const { data, error } = await admin.rpc('merge_user_accounts', {
      p_keep:    payload.keep_user_id,
      p_discard: payload.discard_user_id,
      p_actor:   actor.id,
      p_reason:  reason,
    });
    if (error) throw new Error(`merge_user_accounts RPC failed: ${error.message}`);

    return {
      before: {
        keep:    keepSnap.data,
        discard: discardSnap.data,
      },
      after: {
        merged_at: new Date().toISOString(),
        summary: data as Record<string, unknown>,
      },
      target: { type: 'user', id: payload.keep_user_id },
    };
  },
};
