/**
 * Tests for daily_challenge_for_user client helper.
 *
 * Bug: RPC returned 400 because taxa.rarity_tier column didn't exist.
 * Fix: Added ADD COLUMN IF NOT EXISTS rarity_tier int to taxa in schema.
 *      Updated WHERE clause to treat NULL rarity_tier as common.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reset module cache between tests so the in-memory day-cache doesn't leak.
beforeEach(() => {
  vi.resetModules();
});

describe('fetchDailyChallenge', () => {
  async function setup(mockReturn: { data: unknown; error: unknown }) {
    const mockRpc = vi.fn().mockResolvedValue(mockReturn);
    vi.doMock('../../src/lib/supabase', () => ({
      getSupabase: () => ({ rpc: mockRpc }),
    }));
    const { fetchDailyChallenge } = await import('../../src/lib/daily-challenge');
    return { fetchDailyChallenge, mockRpc };
  }

  const FAKE_USER = '00000000-0000-0000-0000-000000000001';

  const SAMPLE = {
    taxon_id: 'taxon-1',
    scientific_name: 'Quercus rugosa',
    common_name_en: 'Netleaf Oak',
    common_name_es: 'Encino',
    kingdom: 'Plantae',
    rarity_tier: 2,
    thumbnail_url: 'https://example.com/img.jpg',
    why: 'Encino — planta local',
  };

  it('returns challenge when RPC succeeds', async () => {
    const { fetchDailyChallenge, mockRpc } = await setup({ data: [SAMPLE], error: null });
    const result = await fetchDailyChallenge(FAKE_USER);
    expect(result).not.toBeNull();
    expect(result?.scientific_name).toBe('Quercus rugosa');
    expect(result?.rarity_tier).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith('daily_challenge_for_user', { p_user_id: FAKE_USER });
  });

  it('returns null when RPC returns empty array (no taxa match)', async () => {
    const { fetchDailyChallenge } = await setup({ data: [], error: null });
    expect(await fetchDailyChallenge(FAKE_USER)).toBeNull();
  });

  it('returns null when RPC returns null data', async () => {
    const { fetchDailyChallenge } = await setup({ data: null, error: null });
    expect(await fetchDailyChallenge(FAKE_USER)).toBeNull();
  });

  it('returns null (no throw) when RPC errors — widget hides gracefully', async () => {
    const { fetchDailyChallenge } = await setup({
      data: null,
      error: new Error('column rarity_tier does not exist'),
    });
    const result = await fetchDailyChallenge(FAKE_USER);
    expect(result).toBeNull();
  });

  it('handles null rarity_tier (unclassified taxa — treated as common by schema)', async () => {
    const { fetchDailyChallenge } = await setup({
      data: [{ ...SAMPLE, rarity_tier: null }],
      error: null,
    });
    const result = await fetchDailyChallenge(FAKE_USER);
    expect(result).not.toBeNull();
    expect(result?.rarity_tier).toBeNull();
  });

  it('memoizes within the same UTC day', async () => {
    const { fetchDailyChallenge, mockRpc } = await setup({ data: [SAMPLE], error: null });
    await fetchDailyChallenge(FAKE_USER);
    await fetchDailyChallenge(FAKE_USER);
    // Cache should prevent second RPC call
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
