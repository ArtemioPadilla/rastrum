/**
 * GPS coords used by the "Places near me" flow on /explore/places/.
 *
 * Privacy invariant — same rule as `community-url.ts`: coords NEVER
 * appear in the URL querystring (would leak via the `Referer` header
 * and browser history). They live in `sessionStorage` only — cleared
 * when the tab closes.
 *
 * Separate storage key from the community Nearby helper so the two
 * flows don't share state (a user may grant geolocation for one but
 * not the other).
 */

export interface PlacesGps {
  lat: number;
  lng: number;
}

const GPS_STORAGE_KEY = 'rastrum.places.gps';

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSessionStorage(): SessionStorageLike | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const ss = (globalThis as unknown as { sessionStorage?: SessionStorageLike }).sessionStorage;
    return ss ?? null;
  } catch {
    return null;
  }
}

export function loadPlacesGps(
  storage: SessionStorageLike | null = getSessionStorage(),
): PlacesGps | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    if (Math.abs(parsed.lat) > 90 || Math.abs(parsed.lng) > 180) return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch {
    return null;
  }
}

export function savePlacesGps(
  gps: PlacesGps,
  storage: SessionStorageLike | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(GPS_STORAGE_KEY, JSON.stringify({ lat: gps.lat, lng: gps.lng }));
  } catch {
    // non-fatal — storage may be full or unavailable
  }
}

export function clearPlacesGps(
  storage: SessionStorageLike | null = getSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(GPS_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

/**
 * Format meters as a human-readable distance label.
 * Below 1 km → whole meters; above → 1 decimal of km.
 */
export function formatDistance(meters: number, lang: 'en' | 'es'): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) {
    const m = Math.round(meters);
    return lang === 'es' ? `~${m} m` : `~${m} m`;
  }
  const km = (meters / 1000).toFixed(meters < 10000 ? 1 : 0);
  return `~${km} km`;
}

/**
 * Build a URL querystring for the places index.
 *
 * Privacy gate: explicitly drops any `lat`/`lng`/`gps` keys. The Near-me
 * mode is encoded as `?near=true` — the actual coords stay in
 * sessionStorage. Mirrors the community-url regression test.
 */
export function serializePlacesQuery(opts: {
  near?: boolean;
  type?: string;
  q?: string;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (opts.near) sp.set('near', 'true');
  if (opts.type) sp.set('type', opts.type);
  if (opts.q) sp.set('q', opts.q);
  if (opts.page && opts.page > 1) sp.set('page', String(opts.page));
  const out = sp.toString();
  return out ? `?${out}` : '';
}
