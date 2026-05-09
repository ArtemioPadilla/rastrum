/**
 * Lunar phase helpers — pure math, no external dependencies.
 *
 * Algorithm: Jean Meeus "Astronomical Algorithms" ch. 49 (Julian Ephemeris).
 * Accuracy: ±2 hours for main phase moments (adequate for kairos prompts).
 *
 * Used by: kairos-fire (lunar_event trigger)
 */

type LunarPhase = 'new' | 'first_quarter' | 'full' | 'last_quarter';
type LunarEventKind = 'full' | 'new' | 'eclipse' | null;

/** Julian Day Number from a UTC Date. */
function toJulian(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/** Fractional lunation count from J2000.0 */
function lunationK(jd: number): number {
  // Mean synodic month ~ 29.53059 days
  // New moon at J2000.0 (Jan 6.75, 2000 UTC)
  return (jd - 2451550.09766) / 29.530588861;
}

/** Compute Julian Day of a specific lunar phase for the lunation nearest k. */
function lunarPhaseMoment(k: number, phase: LunarPhase): number {
  // Round k to the nearest integer lunation for the requested phase.
  let kn: number;
  switch (phase) {
    case 'new':           kn = Math.round(k); break;
    case 'first_quarter': kn = Math.round(k - 0.25) + 0.25; break;
    case 'full':          kn = Math.round(k - 0.5) + 0.5; break;
    case 'last_quarter':  kn = Math.round(k - 0.75) + 0.75; break;
  }
  const T = kn / 1236.85;  // Julian centuries from J2000
  // Mean JDE (Meeus eq. 49.1)
  let JDE = 2451550.09766 + 29.530588861 * kn
    + 0.00015437 * T * T
    - 0.000000150 * T * T * T
    + 0.00000000073 * T * T * T * T;

  // Sun's mean anomaly
  const M = (2.5534 + 29.10535670 * kn - 0.0000014 * T * T) * Math.PI / 180;
  // Moon's mean anomaly
  const Mprime = (201.5643 + 385.81693528 * kn + 0.0107582 * T * T) * Math.PI / 180;
  // Moon's argument of latitude
  const F = (160.7108 + 390.67050284 * kn - 0.0016118 * T * T) * Math.PI / 180;
  // Longitude of ascending node
  const Omega = (124.7746 - 1.56375588 * kn + 0.0020672 * T * T) * Math.PI / 180;

  // Corrections for new/full (Meeus table 49.a)
  if (phase === 'new' || phase === 'full') {
    const sign = phase === 'new' ? 1 : -1;
    JDE += (phase === 'full' ? -0.00306 : 0) // full moon base offset
      - 0.40720 * Math.sin(Mprime)
      + 0.17241 * sign * Math.sin(M)
      + 0.01608 * Math.sin(2 * Mprime)
      + 0.01039 * Math.sin(2 * F)
      + 0.00739 * sign * Math.sin(Mprime - M)
      - 0.00514 * sign * Math.sin(Mprime + M)
      - 0.00111 * Math.sin(2 * F - Mprime)
      - 0.00057 * Math.sin(Mprime + 2 * F);
  }

  return JDE;
}

/**
 * Return today's lunar event kind in the given timezone, or null.
 *
 * - 'full'    : full moon within [localMidnight - 12h, localMidnight + 36h]
 * - 'new'     : new moon within [localMidnight - 12h, localMidnight + 36h]
 * - 'eclipse' : total lunar eclipse (magnitude > 0.5) on this date
 *
 * Eclipse detection uses a simple criterion: full moon whose F argument
 * is within ~12.5° of 0° or 180° (shadow zone per Meeus ch. 54).
 *
 * @param now  Current UTC datetime
 * @param tz   IANA timezone string (e.g. 'America/Mexico_City')
 */
export function isLunarEventToday(now: Date, tz: string): LunarEventKind {
  // Compute local midnight bounds for "today" in the user's timezone.
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const localMidnight = new Date(localDateStr + 'T00:00:00Z');
  // Use a 12-h window centred on local noon as the "today" bracket.
  const from = new Date(localMidnight.getTime() - 12 * 3600_000);
  const to   = new Date(localMidnight.getTime() + 36 * 3600_000);

  const jdFrom = toJulian(from);
  const jdTo   = toJulian(to);

  const kBase = lunationK(toJulian(now));

  for (const delta of [-1, 0, 1]) {
    // Full moon
    const kFull = Math.round(kBase - 0.5 + delta) + 0.5;
    const jdFull = lunarPhaseMoment(kFull, 'full');
    if (jdFull >= jdFrom && jdFull <= jdTo) {
      // Check for total eclipse: F within 12.5° of 0 or 180.
      const T = kFull / 1236.85;
      const F = ((160.7108 + 390.67050284 * kFull - 0.0016118 * T * T) % 360 + 360) % 360;
      const Fdeg = Math.min(F, 360 - F);
      if (Fdeg < 12.5 || Math.abs(Fdeg - 180) < 12.5) {
        return 'eclipse';
      }
      return 'full';
    }

    // New moon
    const kNew = Math.round(kBase + delta);
    const jdNew = lunarPhaseMoment(kNew, 'new');
    if (jdNew >= jdFrom && jdNew <= jdTo) return 'new';
  }

  return null;
}

/**
 * Return the canonical phase name for the current moment.
 * Returns null when the moon is in a transitional phase (not a named event).
 */
export function currentLunarPhase(date: Date): LunarPhase | 'eclipse' | null {
  const kind = isLunarEventToday(date, 'UTC');
  if (kind === 'eclipse') return 'eclipse';
  if (kind === 'full') return 'full';
  if (kind === 'new') return 'new';

  const kBase = lunationK(toJulian(date));
  // Check quarter phases within ±1 day.
  const jdNow = toJulian(date);
  for (const delta of [-1, 0, 1]) {
    for (const [ph, off] of [['first_quarter', 0.25], ['last_quarter', 0.75]] as [LunarPhase, number][]) {
      const kQ = Math.round(kBase - off + delta) + off;
      const jdQ = lunarPhaseMoment(kQ, ph);
      if (Math.abs(jdQ - jdNow) < 0.5) return ph;
    }
  }
  return null;
}
