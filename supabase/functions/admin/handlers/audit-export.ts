import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  actorId: z.string().uuid().optional(),
  op: z.string().optional(),
  limit: z.number().int().min(1).max(10000).optional(),
});
type Payload = z.infer<typeof Payload>;

interface AuditRow {
  id: number;
  created_at: string;
  actor_id: string;
  op: string;
  target_type: string | null;
  target_id: string | null;
  details: unknown;
}

const CSV_HEADERS = [
  'id',
  'created_at',
  'actor_id',
  'op',
  'target_type',
  'target_id',
  'details',
] as const;

/**
 * Escape a single CSV field. Wraps in double quotes and doubles inner
 * quotes when the value contains a quote, comma, or newline. Empty / null
 * values become an empty unquoted field.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s === '') return '';
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildAuditCsv(rows: AuditRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const detailsJson =
      row.details === null || row.details === undefined
        ? ''
        : JSON.stringify(row.details);
    const cells = [
      escapeCsvField(row.id),
      escapeCsvField(row.created_at),
      escapeCsvField(row.actor_id),
      escapeCsvField(row.op),
      escapeCsvField(row.target_type),
      escapeCsvField(row.target_id),
      escapeCsvField(detailsJson),
    ];
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

export const auditExportHandler: ActionHandler<Payload> = {
  op: 'audit_export',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const limit = payload.limit ?? 1000;

    let query = admin
      .from('admin_audit')
      .select('id, created_at, actor_id, op, target_type, target_id, before, after, reason')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (payload.from) query = query.gte('created_at', payload.from);
    if (payload.to) query = query.lte('created_at', payload.to);
    if (payload.actorId) query = query.eq('actor_id', payload.actorId);
    if (payload.op) query = query.eq('op', payload.op);

    const { data, error } = await query;
    if (error) throw new Error(`audit.export: ${error.message}`);

    type RawRow = {
      id: number;
      created_at: string;
      actor_id: string;
      op: string;
      target_type: string | null;
      target_id: string | null;
      before: unknown;
      after: unknown;
      reason: string;
    };
    const raw = (data ?? []) as RawRow[];
    const rows: AuditRow[] = raw.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      actor_id: r.actor_id,
      op: r.op,
      target_type: r.target_type,
      target_id: r.target_id,
      details: { before: r.before, after: r.after, reason: r.reason },
    }));
    const csv = buildAuditCsv(rows);

    return {
      before: null,
      after: {
        from: payload.from ?? null,
        to: payload.to ?? null,
        actorId: payload.actorId ?? null,
        op: payload.op ?? null,
        limit,
        returned: rows.length,
      },
      result: { rows, csv },
      target: { type: 'admin_audit', id: 'export' },
    };
  },
};
