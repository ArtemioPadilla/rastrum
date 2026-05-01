import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  errorId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});
type Payload = z.infer<typeof Payload>;

export const errorAcknowledgeHandler: ActionHandler<Payload> = {
  op: 'error_acknowledge',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('function_errors')
      .select('id, function_name, code, acknowledged_at, acknowledged_by, ack_notes')
      .eq('id', payload.errorId)
      .maybeSingle();
    if (fetchErr) throw new Error(`error.acknowledge fetch: ${fetchErr.message}`);
    if (!before) throw new Error('error.acknowledge: row not found');
    if ((before as { acknowledged_at: string | null }).acknowledged_at) {
      throw new Error('error.acknowledge: already acknowledged');
    }

    const { data: after, error: updateErr } = await admin
      .from('function_errors')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: actor.id,
        ack_notes: payload.notes ?? null,
      })
      .eq('id', payload.errorId)
      .is('acknowledged_at', null)
      .select('id, function_name, code, acknowledged_at, acknowledged_by, ack_notes')
      .single();

    if (updateErr) throw new Error(`error.acknowledge update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'function_error', id: payload.errorId },
    };
  },
};
