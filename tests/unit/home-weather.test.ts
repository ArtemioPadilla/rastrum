import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WMO_BUCKETS, fetchWeather } from '../../src/lib/home-weather';

describe('WMO_BUCKETS mapping', () => {
  it('maps code 0 to sunny', () => {
    expect(WMO_BUCKETS[0]).toBe('sunny');
  });

  it('maps code 1 to sunny', () => {
    expect(WMO_BUCKETS[1]).toBe('sunny');
  });

  it('maps code 2 to cloudy', () => {
    expect(WMO_BUCKETS[2]).toBe('cloudy');
  });

  it('maps code 3 to cloudy', () => {
    expect(WMO_BUCKETS[3]).toBe('cloudy');
  });

  it('maps code 45 to foggy', () => {
    expect(WMO_BUCKETS[45]).toBe('foggy');
  });

  it('maps code 48 to foggy', () => {
    expect(WMO_BUCKETS[48]).toBe('foggy');
  });

  it('maps code 51 to rainy', () => {
    expect(WMO_BUCKETS[51]).toBe('rainy');
  });

  it('maps code 61 to rainy', () => {
    expect(WMO_BUCKETS[61]).toBe('rainy');
  });

  it('maps code 71 to snow', () => {
    expect(WMO_BUCKETS[71]).toBe('snow');
  });

  it('maps code 80 to rainy', () => {
    expect(WMO_BUCKETS[80]).toBe('rainy');
  });

  it('maps code 95 to windy', () => {
    expect(WMO_BUCKETS[95]).toBe('windy');
  });

  it('returns undefined for unknown code 999', () => {
    expect(WMO_BUCKETS[999]).toBeUndefined();
  });

  it('returns undefined for unknown code 100', () => {
    expect(WMO_BUCKETS[100]).toBeUndefined();
  });
});

describe('fetchWeather cache TTL logic', () => {
  const mockLocalStorage = (() => {
    const store: Record<string, string> = {};
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      store,
    };
  })();

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    mockLocalStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns cached snapshot before TTL expires', async () => {
    const snapshot = { kind: 'sunny' as const, temperature_c: 25 };
    const key = `rastrum.home.weather.19.4,-99.1`;
    mockLocalStorage.setItem(key, JSON.stringify({
      snapshot,
      expiresAt: Date.now() + 60_000, // 1 min in future
    }));

    const fetchSpy = vi.spyOn(global, 'fetch');
    const result = await fetchWeather(19.43, -99.13);

    expect(result).toEqual(snapshot);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches fresh data when cache is expired', async () => {
    const oldSnapshot = { kind: 'sunny' as const, temperature_c: 20 };
    const key = `rastrum.home.weather.19.4,-99.1`;
    mockLocalStorage.setItem(key, JSON.stringify({
      snapshot: oldSnapshot,
      expiresAt: Date.now() - 1, // expired
    }));

    const freshPayload = { current_weather: { weathercode: 61, temperature: 18 } };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => freshPayload,
    } as Response);

    const result = await fetchWeather(19.43, -99.13);
    expect(result.kind).toBe('rainy');
    expect(result.temperature_c).toBe(18);
  });

  it('returns null kind on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));
    const result = await fetchWeather(0, 0);
    expect(result.kind).toBeNull();
    expect(result.temperature_c).toBeNull();
  });

  it('returns null kind when weathercode is unknown', async () => {
    const freshPayload = { current_weather: { weathercode: 999, temperature: 22 } };
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => freshPayload,
    } as Response);

    const result = await fetchWeather(0, 0);
    expect(result.kind).toBeNull();
    expect(result.temperature_c).toBe(22);
  });
});
