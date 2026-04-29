import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  observation_id: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

export const observationHideHandler: ActionHandler<Payload> = {
  op: 'observation_hide',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const { data: before, error: beforeErr } = await admin
      .from('observations')
      .select('id, hidden, hidden_reason, hidden_at, hidden_by')
      .eq('id', payload.observation_id)
      .single();
    if (beforeErr || !before) throw new Error('observation.hide: target not found');

    const { error } = await admin
      .from('observations')
      .update({
        hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_by: actor.id,
      })
      .eq('id', payload.observation_id);
    if (error) throw new Error(`observation.hide: ${error.message}`);

    const { data: after } = await admin
      .from('observations')
      .select('id, hidden, hidden_reason, hidden_at, hidden_by')
      .eq('id', payload.observation_id)
      .single();

    return {
      before,
      after,
      target: { type: 'observation', id: payload.observation_id },
    };
  },
};
