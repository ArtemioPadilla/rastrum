import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const FiltersSchema = z.object({
  functionName: z.string().max(120).optional(),
  code: z.string().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const Payload = z.object({
  filters: FiltersSchema,
  notes: z.string().max(2000).optional(),
});
type Payload = z.infer<typeof Payload>;

const BULK_ACK_CAP = 1000;

export const errorAcknowledgeBulkHandler: ActionHandler<Payload> = {
  op: 'error_acknowledge_bulk',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const filters = payload.filters;
    const acknowledgedAt = new Date().toISOString();

    // Two-step: SELECT ids first (lets us cap at BULK_ACK_CAP), then UPDATE.
    // PostgREST doesn't support LIMIT on UPDATE directly, so we fetch the
    // candidate id list and pass it via .in().
    let candidateQuery = admin
      .from('function_errors')
      .select('id')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(BULK_ACK_CAP);

    if (filters.functionName) {
      candidateQuery = candidateQuery.eq('function_name', filters.functionName);
    }
    if (filters.code) {
      candidateQuery = candidateQuery.eq('code', filters.code);
    }
    if (filters.from) {
      candidateQuery = candidateQuery.gte('created_at', filters.from);
    }
    if (filters.to) {
      candidateQuery = candidateQuery.lte('created_at', filters.to);
    }

    const { data: candidates, error: selectErr } = await candidateQuery;
    if (selectErr) throw new Error(`error.acknowledge_bulk select: ${selectErr.message}`);

    const ids = (candidates ?? []).map(r => (r as { id: string }).id);
    if (ids.length === 0) {
      return {
        before: null,
        after: { count: 0 },
        target: { type: 'function_error_bulk', id: 'none' },
        result: { count: 0, capHit: false, filters },
      };
    }

    const { error: updateErr, count } = await admin
      .from('function_errors')
      .update({
        acknowledged_at: acknowledgedAt,
        acknowledged_by: actor.id,
        ack_notes: payload.notes ?? null,
      }, { count: 'exact' })
      .in('id', ids)
      .is('acknowledged_at', null);

    if (updateErr) throw new Error(`error.acknowledge_bulk update: ${updateErr.message}`);

    const affected = count ?? ids.length;
    return {
      before: null,
      after: { count: affected },
      target: { type: 'function_error_bulk', id: `n=${affected}` },
      result: { count: affected, capHit: affected >= BULK_ACK_CAP, filters },
    };
  },
};
