import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  observation_id: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

export const observationUnhideHandler: ActionHandler<Payload> = {
  op: 'observation_unhide',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor) {
    const { data: before, error: beforeErr } = await admin
      .from('observations')
      .select('id, hidden, hidden_reason, hidden_at, hidden_by')
      .eq('id', payload.observation_id)
      .single();
    if (beforeErr || !before) throw new Error('observation.unhide: target not found');

    const { error } = await admin
      .from('observations')
      .update({
        hidden: false,
        hidden_at: null,
        hidden_by: null,
        hidden_reason: null,
      })
      .eq('id', payload.observation_id);
    if (error) throw new Error(`observation.unhide: ${error.message}`);

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
