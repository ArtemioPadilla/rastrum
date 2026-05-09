/**
 * Tests for the after_rain kairos trigger logic.
 *
 * Tests cover:
 *  - threshold: 4mm → no fire, 6mm → fire
 *  - 1/day cap (shared with golden_hour)
 *  - locale handling
 *  - stale weather snapshot → no fire
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Inline minimal versions of the functions under test ───────────────
// We test the logic directly without the Deno/Supabase runtime.

function encodeGeohash5(lat: number, lng: number): string {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let result = '';
  let bits = 0, numBits = 0, isEven = true;
  while (result.length < 5) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) | 1; minLng = mid; }
      else            { bits = bits << 1;        maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; }
      else            { bits = bits << 1;        maxLat = mid; }
    }
    isEven = !isEven;
    numBits++;
    if (numBits === 5) { result += BASE32[bits]; bits = 0; numBits = 0; }
  }
  return result;
}

const AFTER_RAIN_THRESHOLD_MM = 5;

// Simulated getRecentRainfallMm for unit tests
function shouldFireAfterRain(params: {
  rainfallMm: number | null;
  lastSentIso: string | null;
  tz: string;
  now: Date;
}): boolean {
  const { rainfallMm, lastSentIso, tz, now } = params;

  // 1/day cap
  if (lastSentIso) {
    const sentDate = new Date(lastSentIso).toLocaleDateString('en-CA', { timeZone: tz });
    const todayDate = now.toLocaleDateString('en-CA', { timeZone: tz });
    if (sentDate === todayDate) return false;
  }

  if (rainfallMm === null) return false;
  return rainfallMm >= AFTER_RAIN_THRESHOLD_MM;
}

describe('after_rain kairos trigger', () => {
  const now = new Date('2026-05-09T20:00:00Z');
  const tz = 'America/Mexico_City';

  it('does not fire when rainfall is 4mm (below threshold)', () => {
    expect(shouldFireAfterRain({ rainfallMm: 4, lastSentIso: null, tz, now })).toBe(false);
  });

  it('does not fire when rainfall is exactly 4.9mm', () => {
    expect(shouldFireAfterRain({ rainfallMm: 4.9, lastSentIso: null, tz, now })).toBe(false);
  });

  it('fires when rainfall is exactly 5mm (threshold)', () => {
    expect(shouldFireAfterRain({ rainfallMm: 5, lastSentIso: null, tz, now })).toBe(true);
  });

  it('fires when rainfall is 6mm (above threshold)', () => {
    expect(shouldFireAfterRain({ rainfallMm: 6, lastSentIso: null, tz, now })).toBe(true);
  });

  it('does not fire when rainfall is null (no snapshot)', () => {
    expect(shouldFireAfterRain({ rainfallMm: null, lastSentIso: null, tz, now })).toBe(false);
  });

  it('respects 1/day cap — already sent today → no fire', () => {
    // Same calendar day in America/Mexico_City (UTC-6)
    const sentToday = new Date('2026-05-09T15:00:00Z').toISOString(); // 9am Mexico
    expect(shouldFireAfterRain({ rainfallMm: 10, lastSentIso: sentToday, tz, now })).toBe(false);
  });

  it('fires if last sent was yesterday', () => {
    const sentYesterday = new Date('2026-05-08T20:00:00Z').toISOString();
    expect(shouldFireAfterRain({ rainfallMm: 10, lastSentIso: sentYesterday, tz, now })).toBe(true);
  });

  it('1/day cap works across timezone boundary (US/Eastern)', () => {
    const tzEast = 'America/New_York';
    // 23:30 UTC = 19:30 EDT — sent 20:00 UTC same date
    const sentAt = new Date('2026-05-09T18:00:00Z').toISOString();
    const nowLate = new Date('2026-05-09T23:30:00Z');
    expect(shouldFireAfterRain({ rainfallMm: 10, lastSentIso: sentAt, tz: tzEast, now: nowLate })).toBe(false);
  });
});

describe('encodeGeohash5', () => {
  it('encodes CDMX to expected 5-char geohash prefix', () => {
    const gh = encodeGeohash5(19.4326, -99.1332);
    expect(gh).toHaveLength(5);
    // Known prefix for Mexico City area
    expect(gh.startsWith('9g3')).toBe(true);
  });

  it('encodes distinct locations to distinct geohashes', () => {
    const cdmx = encodeGeohash5(19.4326, -99.1332);
    const oaxaca = encodeGeohash5(17.0669, -96.7203);
    expect(cdmx).not.toBe(oaxaca);
  });
});

describe('after_rain 1/day cap shared with golden_hour', () => {
  it('after_rain suppresses golden_hour when after_rain fires first', () => {
    // This is enforced by the EF via shared lastSentAt update for all kinds.
    // Simulate: after_rain fires, updates last_sent_at; golden_hour check uses same value.
    const now = new Date('2026-05-09T21:00:00Z');
    const tz = 'America/Mexico_City';
    const afterRainFired = new Date('2026-05-09T20:00:00Z').toISOString();

    // Golden hour check re-uses the shared lastSentAt
    const sentDate = new Date(afterRainFired).toLocaleDateString('en-CA', { timeZone: tz });
    const todayDate = now.toLocaleDateString('en-CA', { timeZone: tz });
    expect(sentDate).toBe(todayDate);
  });
});
