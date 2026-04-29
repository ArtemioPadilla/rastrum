import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  observation_id: z.string().uuid(),
  obscure_level: z.enum(['none', '0.1deg', '0.2deg', '5km', 'full']),
});
type Payload = z.infer<typeof Payload>;

export const observationObscureHandler: ActionHandler<Payload> = {
  op: 'observation_obscure',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before } = await admin
      .from('observations')
      .select('id, obscure_level, location_obscured')
      .eq('id', payload.observation_id)
      .single();

    const { error } = await admin
      .from('observations')
      .update({ obscure_level: payload.obscure_level })
      .eq('id', payload.observation_id);
    if (error) throw new Error(`observation.obscure: ${error.message}`);

    const { data: after } = await admin
      .from('observations')
      .select('id, obscure_level, location_obscured')
      .eq('id', payload.observation_id)
      .single();

    return {
      before,
      after,
      target: { type: 'observation', id: payload.observation_id },
    };
  },
};
