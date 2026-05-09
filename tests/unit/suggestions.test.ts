import { describe, it, expect, vi, beforeEach } from 'vitest';

// We mock the supabase module before importing the module under test
const mockRpc = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
  }),
}));

// Import after mock is set up
const { fetchSuggestions } = await import('../../src/lib/suggestions');

const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_LAT = 19.43;
const FAKE_LNG = -99.13;

describe('fetchSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns 3 suggestions', async () => {
    const mockData = [
      {
        taxon_id: 'taxon-1',
        scientific_name: 'Quercus rugosa',
        common_name_es: 'Encino',
        common_name_en: 'Netleaf Oak',
        kingdom: 'Plantae',
        class: 'Magnoliopsida',
        nearby_count: 42,
        photo_url: 'https://example.com/quercus.jpg',
      },
      {
        taxon_id: 'taxon-2',
        scientific_name: 'Piranga rubra',
        common_name_es: 'Cardenal veranero',
        common_name_en: 'Summer Tanager',
        kingdom: 'Animalia',
        class: 'Aves',
        nearby_count: 17,
        photo_url: 'https://example.com/piranga.jpg',
      },
      {
        taxon_id: 'taxon-3',
        scientific_name: 'Bufo valliceps',
        common_name_es: 'Sapo del golfo',
        common_name_en: 'Gulf Coast Toad',
        kingdom: 'Animalia',
        class: 'Amphibia',
        nearby_count: 5,
        photo_url: null,
      },
    ];

    mockRpc.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG);

    expect(result).toHaveLength(3);
    expect(result[0].scientific_name).toBe('Quercus rugosa');
    expect(result[1].common_name_en).toBe('Summer Tanager');
    expect(result[2].photo_url).toBeNull();

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith('suggest_nearby_species', {
      p_user_id: FAKE_USER_ID,
      p_lat: FAKE_LAT,
      p_lng: FAKE_LNG,
      p_month: expect.any(Number),
      p_radius_km: 50,
      p_limit: 10,
    });
  });

  it('empty result: returns []', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG);

    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('null data: returns []', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG);

    expect(result).toEqual([]);
  });

  it('error: throws', async () => {
    const mockError = new Error('RPC error: permission denied');
    mockRpc.mockResolvedValueOnce({ data: null, error: mockError });

    await expect(fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG)).rejects.toThrow(
      'RPC error: permission denied'
    );
  });

  it('passes custom opts (limit, radiusKm) to the RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG, { limit: 5, radiusKm: 25 });

    expect(mockRpc).toHaveBeenCalledWith('suggest_nearby_species', {
      p_user_id: FAKE_USER_ID,
      p_lat: FAKE_LAT,
      p_lng: FAKE_LNG,
      p_month: expect.any(Number),
      p_radius_km: 25,
      p_limit: 5,
    });
  });

  it('p_month is the current month (1-based)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await fetchSuggestions(FAKE_USER_ID, FAKE_LAT, FAKE_LNG);

    const call = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    const month = call.p_month as number;
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(Number.isInteger(month)).toBe(true);
  });
});
