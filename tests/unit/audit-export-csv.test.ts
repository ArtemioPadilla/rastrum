/**
 * Unit test for the CSV escape + buildAuditCsv helpers consumed by
 * supabase/functions/admin/handlers/audit-export.ts.
 *
 * The helpers live in supabase/functions/admin/_shared/csv.ts so the
 * same module is importable by both the Deno-runtime handler and this
 * Node-runtime test (the file has zero Deno-only imports — no Deno URL
 * specifiers, no jsr / esm.sh references — so Vitest can resolve it).
 *
 * Coverage targets the four real-world hazards that breaks naive CSV
 * builders: comma in field, quote in field, newline in field, and
 * null/empty handling. Plus a unicode pass for Spanish content.
 */
import { describe, it, expect } from 'vitest';
import {
  escapeCsvField,
  buildAuditCsv,
  CSV_HEADERS,
  type AuditExportRow,
} from '../../supabase/functions/admin/_shared/csv';

describe('escapeCsvField', () => {
  it('returns empty string for null', () => {
    expect(escapeCsvField(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('passes through plain ascii without quoting', () => {
    expect(escapeCsvField('plain')).toBe('plain');
  });

  it('coerces numbers to string without quoting', () => {
    expect(escapeCsvField(42)).toBe('42');
  });

  it('quotes a field containing a comma', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('quotes a field containing a double quote and doubles the inner quote', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a field containing a literal newline', () => {
    expect(escapeCsvField('one\ntwo')).toBe('"one\ntwo"');
  });

  it('quotes a field containing a literal carriage return', () => {
    expect(escapeCsvField('one\rtwo')).toBe('"one\rtwo"');
  });

  it('passes through unicode text without quoting', () => {
    expect(escapeCsvField('proteccíon — ñ')).toBe('proteccíon — ñ');
  });
});

describe('buildAuditCsv', () => {
  it('emits just the header when given zero rows', () => {
    const csv = buildAuditCsv([]);
    expect(csv).toBe(CSV_HEADERS.join(','));
  });

  it('serialises a plain row', () => {
    const rows: AuditExportRow[] = [
      {
        id: 1,
        created_at: '2026-04-29T00:00:00Z',
        actor_id: '00000000-0000-0000-0000-000000000001',
        op: 'role_grant',
        target_type: 'user',
        target_id: '00000000-0000-0000-0000-000000000002',
        details: null,
      },
    ];
    const csv = buildAuditCsv(rows);
    const [header, line] = csv.split('\n');
    expect(header).toBe('id,created_at,actor_id,op,target_type,target_id,details');
    expect(line).toBe('1,2026-04-29T00:00:00Z,00000000-0000-0000-0000-000000000001,role_grant,user,00000000-0000-0000-0000-000000000002,');
  });

  it('quotes a JSON details payload that contains commas + quotes', () => {
    const rows: AuditExportRow[] = [
      {
        id: 2,
        created_at: '2026-04-29T01:00:00Z',
        actor_id: 'a',
        op: 'observation_hide',
        target_type: 'observation',
        target_id: 'o',
        details: { reason: 'Spam, "stock photo"' },
      },
    ];
    const csv = buildAuditCsv(rows);
    const [, line] = csv.split('\n');
    // The serialised JSON contains a comma and quotes — both have to be escaped.
    expect(line.endsWith('"{""reason"":""Spam, \\""stock photo\\""""}"')).toBe(true);
  });

  it('encodes a string detail through JSON.stringify and CSV-quotes the surrounding quotes', () => {
    const rows: AuditExportRow[] = [
      {
        id: 3,
        created_at: 't',
        actor_id: 'a',
        op: 'comment_hide',
        target_type: 'comment',
        target_id: 'c',
        details: 'line1\nline2',
      },
    ];
    const csv = buildAuditCsv(rows);
    const [, line] = csv.split('\n');
    // JSON.stringify('line1\nline2') === '"line1\\nline2"'.  The surrounding
    // JSON quotes are CSV-special, so escapeCsvField wraps the whole field
    // in `"…"` and doubles the inner quotes — yielding `"""line1\nline2"""`.
    expect(line.endsWith('"""line1\\nline2"""')).toBe(true);
  });

  it('CSV-quotes a target_id that contains a real newline (raw string path)', () => {
    const rows: AuditExportRow[] = [
      {
        id: 5,
        created_at: 't',
        actor_id: 'a',
        op: 'op',
        target_type: 'note',
        target_id: 'multi\nline',
        details: null,
      },
    ];
    const csv = buildAuditCsv(rows);
    // target_id is a plain string at the escapeCsvField boundary, so a
    // real newline forces the entire field to be wrapped in CSV quotes.
    expect(csv).toContain('"multi\nline"');
  });

  it('emits multiple rows separated by a single \\n', () => {
    const rows: AuditExportRow[] = [
      {
        id: 1,
        created_at: 't1',
        actor_id: 'a',
        op: 'op1',
        target_type: null,
        target_id: null,
        details: null,
      },
      {
        id: 2,
        created_at: 't2',
        actor_id: 'b',
        op: 'op2',
        target_type: null,
        target_id: null,
        details: null,
      },
    ];
    const csv = buildAuditCsv(rows);
    expect(csv.split('\n')).toHaveLength(3); // header + 2 rows
  });

  it('serialises unicode in details without mangling', () => {
    const rows: AuditExportRow[] = [
      {
        id: 4,
        created_at: 't',
        actor_id: 'a',
        op: 'op',
        target_type: null,
        target_id: null,
        details: { note: 'protección — ñañá' },
      },
    ];
    const csv = buildAuditCsv(rows);
    expect(csv).toContain('protección');
    expect(csv).toContain('ñañá');
  });
});
