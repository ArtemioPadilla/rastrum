import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  observation_id: z.string().uuid(),
  license: z.enum(['CC BY 4.0', 'CC BY-NC 4.0', 'CC0']),
});
type Payload = z.infer<typeof Payload>;

export const observationLicenseOverrideHandler: ActionHandler<Payload> = {
  op: 'observation_license_override',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before } = await admin
      .from('observations')
      .select('id, observer_license')
      .eq('id', payload.observation_id)
      .single();

    const { error } = await admin
      .from('observations')
      .update({ observer_license: payload.license })
      .eq('id', payload.observation_id);
    if (error) throw new Error(`observation.license_override: ${error.message}`);

    const { data: after } = await admin
      .from('observations')
      .select('id, observer_license')
      .eq('id', payload.observation_id)
      .single();

    return {
      before,
      after,
      target: { type: 'observation', id: payload.observation_id },
    };
  },
};
