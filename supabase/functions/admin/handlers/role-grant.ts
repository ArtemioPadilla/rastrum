import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor, UserRole } from '../_shared/auth.ts';
import type { AuditOp } from '../_shared/audit.ts';

export interface ActionResult {
  before: unknown;
  after: unknown;
  target: { type: string; id: string };
  result?: unknown;
}

export interface ActionHandler<TPayload = unknown> {
  op: AuditOp;
  requiredRole: UserRole;
  payloadSchema: z.ZodType<TPayload>;
  execute: (admin: SupabaseClient, payload: TPayload, actor: Actor, reason: string) => Promise<ActionResult>;
}

const RoleGrantPayload = z.object({
  target_user_id: z.string().uuid(),
  role: z.enum(['admin', 'moderator', 'expert', 'researcher']),
  expires_at: z.string().datetime().optional(),
});
type RoleGrantPayload = z.infer<typeof RoleGrantPayload>;

export const roleGrantHandler: ActionHandler<RoleGrantPayload> = {
  op: 'role_grant',
  requiredRole: 'admin',
  payloadSchema: RoleGrantPayload,
  async execute(admin, payload, actor, _reason) {
    const { data: before } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id);

    // Existing row dictates whether this is a fresh grant, a re-grant after
    // a soft-revoke, or an extension of an active grant. We preserve the
    // original granted_at / granted_by on every conflict so audit history
    // is intact; only revoked_at moves on the conflict path. Fresh grants
    // get the new timestamps.
    const existing = (before ?? []).find(r => r.role === payload.role);
    const expiresAt = payload.expires_at ?? null;

    if (existing) {
      const { error } = await admin
        .from('user_roles')
        .update({ revoked_at: expiresAt })
        .eq('user_id', payload.target_user_id)
        .eq('role', payload.role);
      if (error) throw new Error(`role.grant (extend): ${error.message}`);
    } else {
      const { error } = await admin
        .from('user_roles')
        .insert({
          user_id: payload.target_user_id,
          role: payload.role,
          granted_at: new Date().toISOString(),
          granted_by: actor.id,
          revoked_at: expiresAt,
        });
      if (error) throw new Error(`role.grant (insert): ${error.message}`);
    }

    const { data: after } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id);

    return {
      before,
      after,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
