import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({ report_id: z.string().uuid() });
type Payload = z.infer<typeof Payload>;

export const reportResolveHandler: ActionHandler<Payload> = {
  op: 'report_resolved',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before } = await admin.from('reports').select('*').eq('id', payload.report_id).single();
    if (!before) throw new Error('report.resolve: target not found');
    const { error } = await admin.from('reports').update({ status: 'resolved' }).eq('id', payload.report_id);
    if (error) throw new Error(`report.resolve: ${error.message}`);
    const { data: after } = await admin.from('reports').select('*').eq('id', payload.report_id).single();
    return { before, after, target: { type: 'report', id: payload.report_id } };
  },
};
