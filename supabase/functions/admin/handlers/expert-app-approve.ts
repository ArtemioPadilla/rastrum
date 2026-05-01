import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({ application_id: z.string().uuid() });
type Payload = z.infer<typeof Payload>;

export const expertAppApproveHandler: ActionHandler<Payload> = {
  op: 'expert_app_approve',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: app, error: fetchErr } = await admin
      .from('expert_applications').select('*').eq('id', payload.application_id).single();
    if (fetchErr) throw new Error(`expert_app.approve fetch: ${fetchErr.message}`);
    if (!app) throw new Error('expert_app.approve: not found');
    const row = app as { id: string; user_id: string; status: string; taxa: string[] };
    if (row.status === 'approved') return { before: app, after: app, target: { type: 'expert_application', id: row.id }, result: { idempotent: true } };
    const now = new Date().toISOString();
    const { data: after, error: upErr } = await admin.from('expert_applications')
      .update({ status: 'approved', reviewer_id: actor.id, reviewed_at: now }).eq('id', row.id).select('*').single();
    if (upErr) throw new Error(`expert_app.approve update: ${upErr.message}`);
    if (row.taxa.length > 0) {
      await admin.from('user_expertise').upsert(
        row.taxa.map(t => ({ user_id: row.user_id, taxon: t, taxon_count: 0, approved_at: now })),
        { onConflict: 'user_id,taxon', ignoreDuplicates: true });
    }
    await admin.from('users').update({ is_expert: true }).eq('id', row.user_id);
    return { before: app, after, target: { type: 'expert_application', id: row.id }, result: { user_id: row.user_id, taxa: row.taxa } };
  },
};
