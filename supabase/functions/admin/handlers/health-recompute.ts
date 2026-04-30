import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({});
type Payload = z.infer<typeof Payload>;

export const healthRecomputeHandler: ActionHandler<Payload> = {
  op: 'health_recompute',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, _payload, _actor, _reason) {
    const { error: rpcErr } = await admin.rpc('compute_admin_health_digest');
    if (rpcErr) throw new Error(`health.recompute: ${rpcErr.message}`);

    const { data: latest, error: fetchErr } = await admin
      .from('admin_health_digests')
      .select('id, period_start, period_end')
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fetchErr) throw new Error(`health.recompute fetch: ${fetchErr.message}`);

    const digestId = (latest as { id: string } | null)?.id ?? null;

    return {
      before: null,
      after: latest,
      target: { type: 'admin_health_digest', id: digestId ?? 'none' },
      result: { digestId },
    };
  },
};
