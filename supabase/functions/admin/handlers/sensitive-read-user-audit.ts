import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
});
type Payload = z.infer<typeof Payload>;

export const sensitiveReadUserAuditHandler: ActionHandler<Payload> = {
  op: 'user_audit_read',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor) {
    const { data, error } = await admin
      .from('admin_audit')
      .select('*')
      .or(`actor_id.eq.${payload.target_user_id},target_id.eq.${payload.target_user_id}`)
      .order('created_at', { ascending: false })
      .limit(payload.limit);
    if (error) throw new Error(`user_audit_read: ${error.message}`);

    return {
      before: null,
      after: null,
      target: { type: 'user', id: payload.target_user_id },
      result: data ?? [],
    };
  },
};
