import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({ application_id: z.string().uuid(), reviewer_note: z.string().min(1, 'reviewer_note required') });
type Payload = z.infer<typeof Payload>;

export const expertAppRejectHandler: ActionHandler<Payload> = {
  op: 'expert_app_reject',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: app, error: fetchErr } = await admin
      .from('expert_applications').select('*').eq('id', payload.application_id).single();
    if (fetchErr) throw new Error(`expert_app.reject fetch: ${fetchErr.message}`);
    if (!app) throw new Error('expert_app.reject: not found');
    const row = app as { id: string; user_id: string; status: string };
    if (row.status === 'rejected') return { before: app, after: app, target: { type: 'expert_application', id: row.id }, result: { idempotent: true } };
    const { data: after, error: upErr } = await admin.from('expert_applications')
      .update({ status: 'rejected', reviewer_id: actor.id, reviewed_at: new Date().toISOString(), reviewer_note: payload.reviewer_note })
      .eq('id', row.id).select('*').single();
    if (upErr) throw new Error(`expert_app.reject update: ${upErr.message}`);
    return { before: app, after, target: { type: 'expert_application', id: row.id }, result: { user_id: row.user_id } };
  },
};
