/**
 * RFC-4180-flavored CSV helpers used by audit.export.
 * Pure functions — no remote imports — so the same module can be
 * unit-tested under Vitest (which can't resolve Deno URL imports).
 */

export interface AuditExportRow {
  id: number;
  created_at: string;
  actor_id: string;
  op: string;
  target_type: string | null;
  target_id: string | null;
  details: unknown;
}

export const CSV_HEADERS = [
  'id',
  'created_at',
  'actor_id',
  'op',
  'target_type',
  'target_id',
  'details',
] as const;

/**
 * Escape a single CSV field per RFC 4180:
 *   - null / undefined  → ''
 *   - contains "," / `"` / newline → wrap in `"…"` and double inner quotes
 *   - otherwise → return as-is
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

export function buildAuditCsv(rows: AuditExportRow[]): string {
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
