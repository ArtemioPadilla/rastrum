export type WeatherKind = 'sunny' | 'rainy' | 'cloudy' | 'snow' | 'foggy' | 'windy';

export interface WeatherSnapshot {
  kind: WeatherKind | null;
  temperature_c: number | null;
}

// WMO weather codes → bucket (only the 5-6 we care about)
export const WMO_BUCKETS: Record<number, WeatherKind> = {
  0: 'sunny', 1: 'sunny', 2: 'cloudy', 3: 'cloudy',
  45: 'foggy', 48: 'foggy',
  51: 'rainy', 53: 'rainy', 55: 'rainy',
  61: 'rainy', 63: 'rainy', 65: 'rainy',
  71: 'snow', 73: 'snow', 75: 'snow',
  80: 'rainy', 81: 'rainy', 82: 'rainy',
  95: 'windy', 96: 'windy', 99: 'windy',
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

interface WeatherCache {
  snapshot: WeatherSnapshot;
  expiresAt: number;
}

function cacheKey(lat: number, lng: number): string {
  return `rastrum.home.weather.${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherSnapshot> {
  const key = cacheKey(lat, lng);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached: WeatherCache = JSON.parse(raw);
      if (Date.now() < cached.expiresAt) return cached.snapshot;
    }
  } catch { /* ignore */ }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('fetch failed');
    const json = await res.json() as { current_weather?: { weathercode: number; temperature: number } };
    const cw = json.current_weather;
    const snapshot: WeatherSnapshot = {
      kind: cw ? (WMO_BUCKETS[cw.weathercode] ?? null) : null,
      temperature_c: cw?.temperature ?? null,
    };
    try {
      localStorage.setItem(key, JSON.stringify({ snapshot, expiresAt: Date.now() + CACHE_TTL_MS }));
    } catch { /* ignore */ }
    return snapshot;
  } catch {
    return { kind: null, temperature_c: null };
  }
}
