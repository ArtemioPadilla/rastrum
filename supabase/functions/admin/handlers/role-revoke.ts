import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const RoleRevokePayload = z.object({
  target_user_id: z.string().uuid(),
  role: z.enum(['admin', 'moderator', 'expert', 'researcher']),
});
type RoleRevokePayload = z.infer<typeof RoleRevokePayload>;

export const roleRevokeHandler: ActionHandler<RoleRevokePayload> = {
  op: 'role_revoke',
  requiredRole: 'admin',
  payloadSchema: RoleRevokePayload,
  async execute(admin, payload, _actor) {
    const { data: before } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role)
      .single();

    if (!before) {
      return {
        before: null,
        after: null,
        target: { type: 'user', id: payload.target_user_id },
      };
    }

    const { error } = await admin
      .from('user_roles')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role);
    if (error) throw new Error(`role.revoke: ${error.message}`);

    const { data: after } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role)
      .single();

    return {
      before,
      after,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
