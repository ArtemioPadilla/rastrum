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

// ── Month-boundary formula unit tests (#876 fix) ──────────────────────────
// The SQL uses: ((p_month - 2 + 12) % 12) + 1, p_month, (p_month % 12) + 1
// to compute prev/current/next month without BETWEEN (which broke at
// Jan=1 → BETWEEN 0 AND 2, and Dec=12 → BETWEEN 11 AND 13).
function monthWindow(m: number): [number, number, number] {
  return [
    ((m - 2 + 12) % 12) + 1,
    m,
    (m % 12) + 1,
  ];
}

describe('monthWindow — boundary-safe month triplet', () => {
  it('January wraps prev to December', () => {
    expect(monthWindow(1)).toEqual([12, 1, 2]);
  });

  it('December wraps next to January', () => {
    expect(monthWindow(12)).toEqual([11, 12, 1]);
  });

  it('mid-year produces consecutive months', () => {
    expect(monthWindow(6)).toEqual([5, 6, 7]);
    expect(monthWindow(7)).toEqual([6, 7, 8]);
  });

  it('all months produce values in [1..12]', () => {
    for (let m = 1; m <= 12; m++) {
      const [prev, cur, next] = monthWindow(m);
      expect(prev).toBeGreaterThanOrEqual(1);
      expect(prev).toBeLessThanOrEqual(12);
      expect(cur).toBe(m);
      expect(next).toBeGreaterThanOrEqual(1);
      expect(next).toBeLessThanOrEqual(12);
    }
  });

  it('never produces 0 or 13 (which BETWEEN p_month±1 would generate)', () => {
    // This was the original bug: BETWEEN 0 AND 2 in January, BETWEEN 11 AND 13 in December.
    for (let m = 1; m <= 12; m++) {
      const window = monthWindow(m);
      expect(window).not.toContain(0);
      expect(window).not.toContain(13);
    }
  });
});
