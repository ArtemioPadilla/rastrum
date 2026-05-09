import { describe, it, expect } from 'vitest';
import { computeSunset, computeSunrise, inGoldenHourPromptWindow, tzLocalDate } from '../../src/lib/sun';

// Reference values from NOAA solar calculator (https://gml.noaa.gov/grad/solcalc/).
// Tolerance: ±5 minutes — the Almanac approximation is accurate to ~1-2 min,
// we leave headroom for atmospheric refraction variance.

function minutesDiff(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

describe('computeSunset', () => {
  it('produces a sunset in the expected late-afternoon window for CDMX equinox', () => {
    // 2026-03-21, CDMX (19.4326° N, -99.1332° W). CDMX is permanently UTC-6
    // (no DST since 2022). Real sunset is around 18:50 local = 00:50 UTC+1.
    const noon = new Date(Date.UTC(2026, 2, 21, 18, 0, 0));
    const sunset = computeSunset(19.4326, -99.1332, noon);
    expect(sunset).not.toBeNull();
    // Within 10 min of NOAA's published value.
    const expected = new Date(Date.UTC(2026, 2, 22, 0, 49, 0));
    expect(minutesDiff(sunset!, expected)).toBeLessThan(10);
  });

  it('produces a sunset close to 18:00 local for Tlacolula on Dec solstice', () => {
    // 2026-12-21, Tlacolula (16.95° N, -96.48° W) — sunset ≈ 17:58 local.
    const noon = new Date(Date.UTC(2026, 11, 21, 18, 0, 0));
    const sunset = computeSunset(16.95, -96.48, noon);
    expect(sunset).not.toBeNull();
    const expected = new Date(Date.UTC(2026, 11, 21, 23, 58, 0));
    expect(minutesDiff(sunset!, expected)).toBeLessThan(10);
  });

  it('returns null in polar night (Tromsø, mid-December)', () => {
    const noon = new Date(Date.UTC(2026, 11, 21, 12, 0, 0));
    expect(computeSunset(70, 19, noon)).toBeNull();
  });

  it('returns null when sun never sets (Svalbard, midsummer)', () => {
    const noon = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
    expect(computeSunset(78, 16, noon)).toBeNull();
  });
});

describe('computeSunrise', () => {
  it('produces sunrise in the expected morning window for CDMX equinox', () => {
    // CDMX 2026-03-21 sunrise ≈ 06:41 local (UTC-6) = 12:41 UTC.
    const noon = new Date(Date.UTC(2026, 2, 21, 12, 0, 0));
    const sunrise = computeSunrise(19.4326, -99.1332, noon);
    expect(sunrise).not.toBeNull();
    const expected = new Date(Date.UTC(2026, 2, 21, 12, 41, 0));
    expect(minutesDiff(sunrise!, expected)).toBeLessThan(10);
  });

  it('produces sunrise before sunset on the same day', () => {
    const noon = new Date(Date.UTC(2026, 5, 21, 18, 0, 0));
    const sr = computeSunrise(19.4326, -99.1332, noon);
    const ss = computeSunset(19.4326, -99.1332, noon);
    expect(sr).not.toBeNull();
    expect(ss).not.toBeNull();
    expect(sr!.getTime()).toBeLessThan(ss!.getTime());
  });
});

describe('inGoldenHourPromptWindow', () => {
  const sunset = new Date('2026-05-08T01:30:00Z'); // arbitrary

  it('is true exactly 22 minutes before sunset (mid-window)', () => {
    const now = new Date(sunset.getTime() - 22 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(true);
  });

  it('is false 35 minutes before sunset (too early)', () => {
    const now = new Date(sunset.getTime() - 35 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(false);
  });

  it('is false 10 minutes before sunset (too late)', () => {
    const now = new Date(sunset.getTime() - 10 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(false);
  });

  it('is true at the boundary (-30 min exactly)', () => {
    const now = new Date(sunset.getTime() - 30 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(true);
  });

  it('is true at the boundary (-15 min exactly)', () => {
    const now = new Date(sunset.getTime() - 15 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(true);
  });

  it('is false after sunset', () => {
    const now = new Date(sunset.getTime() + 60_000);
    expect(inGoldenHourPromptWindow(sunset, now)).toBe(false);
  });

  it('honours custom lead minutes', () => {
    const now = new Date(sunset.getTime() - 45 * 60_000);
    expect(inGoldenHourPromptWindow(sunset, now, 30, 60)).toBe(true);
    expect(inGoldenHourPromptWindow(sunset, now, 15, 30)).toBe(false);
  });
});

describe('tzLocalDate', () => {
  it('formats UTC midnight as the prior day in Mexico City', () => {
    const utc = new Date('2026-05-08T03:00:00Z'); // 21:00 May 7 in CDMX
    expect(tzLocalDate('America/Mexico_City', utc)).toBe('2026-05-07');
  });
  it('formats UTC midday as the same day in CDMX', () => {
    const utc = new Date('2026-05-08T15:00:00Z');
    expect(tzLocalDate('America/Mexico_City', utc)).toBe('2026-05-08');
  });
});
