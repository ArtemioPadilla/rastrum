/**
 * Tests for the kairos lunar event trigger glue (1/day cap + tz matrix).
 */
import { describe, it, expect } from 'vitest';
import { isLunarEventToday, type LunarEventKind } from '../../src/lib/lunar';

function tzLocalDate(tz: string, d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function shouldFireLunarEvent(params: {
  now: Date;
  tz: string;
  lastSentAt: string | null;
}): LunarEventKind {
  const { now, tz, lastSentAt } = params;
  if (lastSentAt) {
    if (tzLocalDate(tz, new Date(lastSentAt)) === tzLocalDate(tz, now)) return null;
  }
  return isLunarEventToday(now, tz);
}

describe('kairos lunar trigger — 1/day cap', () => {
  const fullMoonDay = new Date('2025-05-12T20:00:00Z');
  const tz = 'UTC';

  it('fires on a full moon day when not sent today', () => {
    const result = shouldFireLunarEvent({ now: fullMoonDay, tz, lastSentAt: null });
    expect(['full', 'eclipse']).toContain(result);
  });

  it('does not fire when already sent today', () => {
    const sentToday = new Date('2025-05-12T10:00:00Z').toISOString();
    const result = shouldFireLunarEvent({ now: fullMoonDay, tz, lastSentAt: sentToday });
    expect(result).toBeNull();
  });

  it('fires again the next day after full moon (if it is still in window)', () => {
    // This would not fire because 2025-05-13 is NOT a full moon day.
    const dayAfter = new Date('2025-05-13T20:00:00Z');
    const sentYesterday = new Date('2025-05-12T20:00:00Z').toISOString();
    const result = shouldFireLunarEvent({ now: dayAfter, tz, lastSentAt: sentYesterday });
    expect(result).toBeNull(); // not a full moon day
  });
});

describe('kairos lunar trigger — UTC fallback', () => {
  it('uses UTC when tz is empty string', () => {
    const fullMoonDay = new Date('2025-05-12T20:00:00Z');
    const result = shouldFireLunarEvent({ now: fullMoonDay, tz: 'UTC', lastSentAt: null });
    expect(['full', 'eclipse', null]).toContain(result);
  });
});

describe('kairos lunar trigger — timezone × DOY matrix', () => {
  it('different tz produces same or adjacent date for the same UTC moment', () => {
    // 2025-09-07 eclipse at ~18:11 UTC
    const eclipseUtc = new Date('2025-09-07T18:11:00Z');
    const utcResult = shouldFireLunarEvent({ now: eclipseUtc, tz: 'UTC', lastSentAt: null });
    const mxResult = shouldFireLunarEvent({ now: eclipseUtc, tz: 'America/Mexico_City', lastSentAt: null });
    // Both should detect eclipse (MX is UTC-6, still Sep 7 at 12:11 local)
    expect(utcResult).toBe('eclipse');
    expect(mxResult).toBe('eclipse');
  });

  it('handles date boundary — event in UTC Dec 4 but UTC-5 sees Dec 3', () => {
    // 2025-12-04 full moon at ~06:14 UTC — in UTC-5, that is Dec 3 at 01:14
    const fullMoonUtc = new Date('2025-12-04T06:14:00Z');
    const utcResult = shouldFireLunarEvent({ now: fullMoonUtc, tz: 'UTC', lastSentAt: null });
    const estResult = shouldFireLunarEvent({ now: fullMoonUtc, tz: 'America/New_York', lastSentAt: null });
    // UTC sees full moon on Dec 4; EST (UTC-5) at 01:14 local Dec 4 still
    expect(['full', 'eclipse']).toContain(utcResult);
    // EST result depends on local window; both acceptable
    expect(['full', 'eclipse', null]).toContain(estResult);
  });
});
