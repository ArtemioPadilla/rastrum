import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPoolAnalytics } from './pool-analytics';

function mockSupabase(overrides: {
  pool?: { id: string; total_cap: number; used: number } | null;
  taxa?: Array<{ scientific_name: string; call_count: number }> | null;
  daily?: Array<{ usage_date: string; calls: number }> | null;
} = {}): SupabaseClient {
  const pool = 'pool' in overrides ? overrides.pool : { id: 'p1', total_cap: 100, used: 42 };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: pool }),
        }),
      }),
    }),
    rpc: vi.fn().mockImplementation((fn: string) => {
      if (fn === 'pool_top_taxa') {
        return Promise.resolve({ data: overrides.taxa ?? [] });
      }
      if (fn === 'pool_daily_usage') {
        return Promise.resolve({ data: overrides.daily ?? [] });
      }
      return Promise.resolve({ data: null });
    }),
  } as unknown as SupabaseClient;
}

describe('fetchPoolAnalytics', () => {
  it('returns analytics for a valid pool', async () => {
    const sb = mockSupabase({
      pool: { id: 'p1', total_cap: 200, used: 50 },
      taxa: [
        { scientific_name: 'Quercus robur', call_count: 12 },
        { scientific_name: 'Pinus sylvestris', call_count: 8 },
      ],
      daily: [
        { usage_date: '2026-05-01', calls: 3 },
        { usage_date: '2026-05-02', calls: 7 },
      ],
    });

    const result = await fetchPoolAnalytics(sb, 'p1');

    expect(result).not.toBeNull();
    expect(result!.poolId).toBe('p1');
    expect(result!.totalCap).toBe(200);
    expect(result!.used).toBe(50);
    expect(result!.pctUsed).toBe(25);
    expect(result!.topTaxa).toHaveLength(2);
    expect(result!.topTaxa[0].scientific_name).toBe('Quercus robur');
    expect(result!.dailyUsage).toHaveLength(2);
  });

  it('returns null when pool is not found', async () => {
    const sb = mockSupabase({ pool: null });
    const result = await fetchPoolAnalytics(sb, 'nonexistent');
    expect(result).toBeNull();
  });

  it('calculates pctUsed = 0 when total_cap is 0', async () => {
    const sb = mockSupabase({ pool: { id: 'p2', total_cap: 0, used: 0 } });
    const result = await fetchPoolAnalytics(sb, 'p2');
    expect(result).not.toBeNull();
    expect(result!.pctUsed).toBe(0);
  });

  it('calculates pctUsed = 100 when fully used', async () => {
    const sb = mockSupabase({ pool: { id: 'p3', total_cap: 50, used: 50 } });
    const result = await fetchPoolAnalytics(sb, 'p3');
    expect(result!.pctUsed).toBe(100);
  });

  it('handles pctUsed > 100 when over-consumed', async () => {
    const sb = mockSupabase({ pool: { id: 'p4', total_cap: 10, used: 15 } });
    const result = await fetchPoolAnalytics(sb, 'p4');
    expect(result!.pctUsed).toBe(150);
  });

  it('returns empty arrays when taxa/daily are null', async () => {
    const sb = mockSupabase({ taxa: null, daily: null });
    const result = await fetchPoolAnalytics(sb, 'p1');
    expect(result).not.toBeNull();
    expect(result!.topTaxa).toEqual([]);
    expect(result!.dailyUsage).toEqual([]);
  });

  it('slices topTaxa to 10 items max', async () => {
    const taxa = Array.from({ length: 15 }, (_, i) => ({
      scientific_name: `Species ${i}`,
      call_count: 15 - i,
    }));
    const sb = mockSupabase({ taxa });
    const result = await fetchPoolAnalytics(sb, 'p1');
    expect(result!.topTaxa).toHaveLength(10);
    expect(result!.topTaxa[0].scientific_name).toBe('Species 0');
  });

  it('calls rpc with correct function names and pool id', async () => {
    const sb = mockSupabase();
    await fetchPoolAnalytics(sb, 'test-pool-id');
    expect(sb.rpc).toHaveBeenCalledWith('pool_top_taxa', { p_pool_id: 'test-pool-id' });
    expect(sb.rpc).toHaveBeenCalledWith('pool_daily_usage', { p_pool_id: 'test-pool-id' });
  });
});
