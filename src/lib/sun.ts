/**
 * Sunset / sunrise computation. Standard astronomical algorithm based
 * on Jean Meeus's "Astronomical Algorithms" (chapter 15) — accurate to
 * ~1 minute at temperate latitudes. Pure UTC math; no external services.
 *
 * Mirrored at `supabase/functions/_shared/sun.ts` for the kairos-fire
 * Edge Function; the two files share the same algorithm and are pinned
 * by `tests/unit/sun-sunset.test.ts`.
 *
 * Adapted from SunCalc (BSD-2 licence): https://github.com/mourner/suncalc
 */

const RAD = Math.PI / 180;
const J1970 = 2440588;
const J2000 = 2451545;
const DAY_MS = 86_400_000;

const e = RAD * 23.4397; // obliquity of the Earth

function toJulian(d: Date): number {
  return d.getTime() / DAY_MS - 0.5 + J1970;
}

function fromJulian(j: number): Date {
  return new Date((j + 0.5 - J1970) * DAY_MS);
}

function toDays(d: Date): number {
  return toJulian(d) - J2000;
}

function declination(l: number, b: number): number {
  return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
}

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

function julianCycle(d: number, lw: number): number {
  return Math.round(d - 0.0009 - lw / (2 * Math.PI));
}
function approxTransit(Ht: number, lw: number, n: number): number {
  return 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
}
function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}
function hourAngle(h: number, phi: number, d: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
}

function getSetJ(h: number, lw: number, phi: number, dec: number, n: number, M: number, L: number): number {
  const w = hourAngle(h, phi, dec);
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

const ALTITUDE = -0.833; // standard "official" sunrise/sunset altitude in degrees

export function computeSunset(lat: number, lng: number, when: Date): Date | null {
  return solarEvent(lat, lng, when, 'sunset');
}
export function computeSunrise(lat: number, lng: number, when: Date): Date | null {
  return solarEvent(lat, lng, when, 'sunrise');
}

function solarEvent(
  lat: number,
  lng: number,
  when: Date,
  kind: 'sunrise' | 'sunset',
): Date | null {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(when);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);

  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);

  const Jnoon = solarTransitJ(ds, M, L);

  const h = ALTITUDE * RAD;
  const cosH = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return null; // sun never sets / rises that day

  const Jset = getSetJ(h, lw, phi, dec, n, M, L);
  if (kind === 'sunset') return fromJulian(Jset);

  // Sunrise = noon - (set - noon)
  const Jrise = Jnoon - (Jset - Jnoon);
  return fromJulian(Jrise);
}

/**
 * Returns true when `now` falls within [sunset - leadMaxMin, sunset - leadMinMin].
 * Default window is "30 to 15 minutes before sunset."
 */
export function inGoldenHourPromptWindow(
  sunset: Date,
  now: Date,
  leadMinMin = 15,
  leadMaxMin = 30,
): boolean {
  const min = sunset.getTime() - leadMaxMin * 60_000;
  const max = sunset.getTime() - leadMinMin * 60_000;
  return now.getTime() >= min && now.getTime() <= max;
}

export function tzLocalDate(tz: string, when: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(when);
}
