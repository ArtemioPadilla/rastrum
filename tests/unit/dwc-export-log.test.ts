/**
 * Unit tests for #806 — dwc_export_log audit trail.
 *
 * Tests cover:
 *  1. loadUserExportHistory returns typed rows
 *  2. Empty array on Supabase error
 *  3. Empty array for missing userId
 *  4. Respects limit parameter
 *  5. Rows ordered newest-first by exported_at
 *  6. file_size_bytes can be null (optional field)
 *  7. All valid format values accepted
 *  8. All valid triggered_by values accepted
 */

import { describe, it, expect, vi } from 'vitest';
import { loadUserExportHistory, type DwcExportLogRow } from '../../src/lib/impact';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeRow(overrides: Partial<DwcExportLogRow> = {}): DwcExportLogRow {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    exported_at: '2026-05-01T12:00:00Z',
    observation_count: 42,
    file_size_bytes: 102400,
    format: 'dwca',
    triggered_by: 'user',
    ...overrides,
  };
}

function mockSupabase(data: DwcExportLogRow[] | null, error: { message: string } | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  } as unknown as SupabaseClient;
}

describe('loadUserExportHistory', () => {
  it('returns typed rows on success', async () => {
    const rows = [makeRow(), makeRow({ id: 'aaaaaaaa-0000-0000-0000-000000000002', observation_count: 7 })];
    const sb = mockSupabase(rows);
    const result = await loadUserExportHistory(sb, 'user-uuid-1');
    expect(result).toHaveLength(2);
    expect(result[0].observation_count).toBe(42);
    expect(result[1].observation_count).toBe(7);
  });

  it('returns empty array on Supabase error', async () => {
    const sb = mockSupabase(null, { message: 'relation "dwc_export_log" does not exist' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await loadUserExportHistory(sb, 'user-uuid-1');
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('returns empty array when userId is empty string', async () => {
    const sb = mockSupabase([makeRow()]);
    const result = await loadUserExportHistory(sb, '');
    expect(result).toEqual([]);
    // from() should not have been called
    expect((sb as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it('passes limit to the Supabase query', async () => {
    const sb = mockSupabase([makeRow()]);
    await loadUserExportHistory(sb, 'user-uuid-1', 5);
    const chain = (sb as unknown as { _chain: { limit: ReturnType<typeof vi.fn> } })._chain;
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('orders rows by exported_at descending', async () => {
    const older = makeRow({ exported_at: '2026-04-01T00:00:00Z' });
    const newer = makeRow({ exported_at: '2026-05-10T00:00:00Z' });
    const sb = mockSupabase([newer, older]);
    const chain = (sb as unknown as { _chain: { order: ReturnType<typeof vi.fn> } })._chain;
    await loadUserExportHistory(sb, 'user-uuid-1');
    expect(chain.order).toHaveBeenCalledWith('exported_at', { ascending: false });
  });

  it('accepts null file_size_bytes (optional column)', async () => {
    const row = makeRow({ file_size_bytes: null });
    const sb = mockSupabase([row]);
    const result = await loadUserExportHistory(sb, 'user-uuid-1');
    expect(result[0].file_size_bytes).toBeNull();
  });

  it('accepts all valid format values', async () => {
    const formats: DwcExportLogRow['format'][] = ['dwca', 'csv', 'json'];
    for (const format of formats) {
      const sb = mockSupabase([makeRow({ format })]);
      const result = await loadUserExportHistory(sb, 'user-uuid-1');
      expect(result[0].format).toBe(format);
    }
  });

  it('accepts all valid triggered_by values', async () => {
    const triggers: DwcExportLogRow['triggered_by'][] = ['user', 'api', 'gbif_sync', 'cron'];
    for (const triggered_by of triggers) {
      const sb = mockSupabase([makeRow({ triggered_by })]);
      const result = await loadUserExportHistory(sb, 'user-uuid-1');
      expect(result[0].triggered_by).toBe(triggered_by);
    }
  });
});
