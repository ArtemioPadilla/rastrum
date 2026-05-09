/**
 * Lunar phase helpers — browser/client-side copy of
 * `supabase/functions/_shared/moon.ts`.
 *
 * Pure math, no external dependencies. Used in tests and any
 * client-side lunar display (future use).
 *
 * Spec: docs/specs/modules/34-kairos-prompts.md (#800).
 */

type LunarPhase = 'new' | 'first_quarter' | 'full' | 'last_quarter';
export type LunarEventKind = 'full' | 'new' | 'eclipse' | null;

function toJulian(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

function lunationK(jd: number): number {
  return (jd - 2451550.09766) / 29.530588861;
}

function lunarPhaseMoment(k: number, phase: LunarPhase): number {
  let kn: number;
  switch (phase) {
    case 'new':           kn = Math.round(k); break;
    case 'first_quarter': kn = Math.round(k - 0.25) + 0.25; break;
    case 'full':          kn = Math.round(k - 0.5) + 0.5; break;
    case 'last_quarter':  kn = Math.round(k - 0.75) + 0.75; break;
  }
  const T = kn / 1236.85;
  let JDE = 2451550.09766 + 29.530588861 * kn
    + 0.00015437 * T * T
    - 0.000000150 * T * T * T
    + 0.00000000073 * T * T * T * T;

  const M = (2.5534 + 29.10535670 * kn - 0.0000014 * T * T) * Math.PI / 180;
  const Mprime = (201.5643 + 385.81693528 * kn + 0.0107582 * T * T) * Math.PI / 180;
  const F = (160.7108 + 390.67050284 * kn - 0.0016118 * T * T) * Math.PI / 180;

  if (phase === 'new' || phase === 'full') {
    const sign = phase === 'new' ? 1 : -1;
    JDE += (phase === 'full' ? -0.00306 : 0)
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
 * - 'full'    : full moon within ±12 h of local midnight
 * - 'new'     : new moon within ±12 h of local midnight
 * - 'eclipse' : total lunar eclipse (F within 12.5° of 0 or 180) on this date
 *
 * @param now  Current UTC datetime (defaults to new Date())
 * @param tz   IANA timezone string; defaults to 'UTC'
 */
export function isLunarEventToday(now: Date = new Date(), tz = 'UTC'): LunarEventKind {
  const localDateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  const localMidnight = new Date(localDateStr + 'T00:00:00Z');
  const from = new Date(localMidnight.getTime() - 12 * 3600_000);
  const to   = new Date(localMidnight.getTime() + 36 * 3600_000);

  const jdFrom = toJulian(from);
  const jdTo   = toJulian(to);
  const kBase  = lunationK(toJulian(now));

  for (const delta of [-1, 0, 1]) {
    const kFull = Math.round(kBase - 0.5 + delta) + 0.5;
    const jdFull = lunarPhaseMoment(kFull, 'full');
    if (jdFull >= jdFrom && jdFull <= jdTo) {
      const T = kFull / 1236.85;
      const Fdeg = ((160.7108 + 390.67050284 * kFull - 0.0016118 * T * T) % 360 + 360) % 360;
      const Fmin = Math.min(Fdeg, 360 - Fdeg);
      if (Fmin < 12.5 || Math.abs(Fmin - 180) < 12.5) return 'eclipse';
      return 'full';
    }

    const kNew = Math.round(kBase + delta);
    const jdNew = lunarPhaseMoment(kNew, 'new');
    if (jdNew >= jdFrom && jdNew <= jdTo) return 'new';
  }

  return null;
}
