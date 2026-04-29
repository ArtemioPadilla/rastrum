import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  anomalyId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});
type Payload = z.infer<typeof Payload>;

export const anomalyAcknowledgeHandler: ActionHandler<Payload> = {
  op: 'anomaly_acknowledge',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('admin_anomalies')
      .select('id, kind, actor_id, acknowledged_at, acknowledged_by, ack_notes')
      .eq('id', payload.anomalyId)
      .maybeSingle();
    if (fetchErr) throw new Error(`anomaly.acknowledge fetch: ${fetchErr.message}`);
    if (!before) throw new Error('anomaly.acknowledge: anomaly not found');
    if (before.acknowledged_at) throw new Error('anomaly.acknowledge: already acknowledged');

    const { data: after, error: updateErr } = await admin
      .from('admin_anomalies')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: actor.id,
        ack_notes: payload.notes ?? null,
      })
      .eq('id', payload.anomalyId)
      .is('acknowledged_at', null)
      .select('id, kind, actor_id, acknowledged_at, acknowledged_by, ack_notes')
      .single();

    if (updateErr) throw new Error(`anomaly.acknowledge update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'admin_anomaly', id: payload.anomalyId },
    };
  },
};
