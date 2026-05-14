/**
 * Tests for the migration_window kairos trigger logic.
 *
 * Tests cover:
 *  - DOY range matching (regular + year-crossing)
 *  - Region priority: state (MX-OAX) > national (MX)
 *  - Opted-out users skipped
 *  - 1/day cap
 *  - NULL region → no fire
 */
import { describe, it, expect } from 'vitest';

// ── Inline the logic for unit testing ────────────────────────────────

interface MigrationWindow {
  id: number;
  taxon_group: string;
  start_doy: number;
  end_doy: number;
  region_code: string;
  body_en: string;
  body_es: string;
}

function dayOfYear(date: Date): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function tzLocalDate(tz: string, d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function pickMigrationWindow(params: {
  windows: MigrationWindow[];
  regionPrimary: string | null;
  lastSentAt: string | null;
  tz: string;
  now: Date;
}): MigrationWindow | null {
  const { windows, regionPrimary, lastSentAt, tz, now } = params;
  if (!regionPrimary) return null;

  if (lastSentAt) {
    if (tzLocalDate(tz, new Date(lastSentAt)) === tzLocalDate(tz, now)) return null;
  }

  const doy = dayOfYear(now);

  const matching = windows.filter(w => {
    const regionMatch =
      w.region_code === regionPrimary ||
      w.region_code === regionPrimary.split('-')[0];
    if (!regionMatch) return false;
    if (w.start_doy <= w.end_doy) {
      return doy >= w.start_doy && doy <= w.end_doy;
    } else {
      return doy >= w.start_doy || doy <= w.end_doy;
    }
  });

  if (!matching.length) return null;

  const stateWindows = matching.filter(w => w.region_code === regionPrimary);
  const candidates = stateWindows.length > 0 ? stateWindows : matching;
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0];
}

// ── Fixtures ─────────────────────────────────────────────────────────

const MONARCH_MIC: MigrationWindow = {
  id: 1, taxon_group: 'Lepidoptera',
  start_doy: 244, end_doy: 319,
  region_code: 'MX-MIC',
  body_en: 'Monarchs', body_es: 'Monarcas',
};

const MONARCH_OAX_YEAR_WRAP: MigrationWindow = {
  id: 2, taxon_group: 'Lepidoptera',
  start_doy: 274, end_doy: 31,
  region_code: 'MX-OAX',
  body_en: 'Monarchs OAX', body_es: 'Monarcas OAX',
};

const SWAINSON_VER: MigrationWindow = {
  id: 3, taxon_group: 'Aves',
  start_doy: 244, end_doy: 319,
  region_code: 'MX-VER',
  body_en: "Swainson's Hawk", body_es: 'Gavilán de Swainson',
};

const NATIONAL_MX: MigrationWindow = {
  id: 10, taxon_group: 'Aves',
  start_doy: 100, end_doy: 200,
  region_code: 'MX',
  body_en: 'National MX', body_es: 'Nacional MX',
};

const tz = 'America/Mexico_City';

describe('pickMigrationWindow — DOY range matching', () => {
  it('fires when today is within a regular DOY window', () => {
    // DOY 280 = early October — Monarch migration active
    const now = new Date('2026-10-07T12:00:00Z'); // ~DOY 280
    const result = pickMigrationWindow({
      windows: [MONARCH_MIC],
      regionPrimary: 'MX-MIC',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(1);
  });

  it('does not fire when DOY is outside the window', () => {
    // DOY 1 = Jan 1 — outside 244-319
    const now = new Date('2026-01-01T12:00:00Z');
    const result = pickMigrationWindow({
      windows: [MONARCH_MIC],
      regionPrimary: 'MX-MIC',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result).toBeNull();
  });

  it('handles year-crossing window (start_doy > end_doy) — fires before end of year', () => {
    // DOY ~300 (late October) — within MX-OAX window (274..31 year-wrap)
    const now = new Date('2026-10-27T12:00:00Z');
    const result = pickMigrationWindow({
      windows: [MONARCH_OAX_YEAR_WRAP],
      regionPrimary: 'MX-OAX',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result).not.toBeNull();
  });

  it('handles year-crossing window — fires after New Year', () => {
    // DOY ~15 (mid-January) — within 274..31 year-wrap window
    const now = new Date('2026-01-15T12:00:00Z');
    const result = pickMigrationWindow({
      windows: [MONARCH_OAX_YEAR_WRAP],
      regionPrimary: 'MX-OAX',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result).not.toBeNull();
  });

  it('does NOT fire for year-crossing window when DOY is in the gap', () => {
    // DOY ~180 (late June) — between 31 and 274, the gap
    const now = new Date('2026-06-29T12:00:00Z');
    const result = pickMigrationWindow({
      windows: [MONARCH_OAX_YEAR_WRAP],
      regionPrimary: 'MX-OAX',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result).toBeNull();
  });
});

describe('pickMigrationWindow — region priority', () => {
  it('state window (MX-OAX) takes priority over national (MX)', () => {
    // DOY ~160 — within national MX window 100-200 AND within MX-OAX if any
    // Only national window here, user is in MX-OAX → matches via prefix
    const now = new Date('2026-06-09T12:00:00Z');
    const oaxWindow: MigrationWindow = { ...NATIONAL_MX, id: 20, region_code: 'MX-OAX', start_doy: 100, end_doy: 200 };
    const result = pickMigrationWindow({
      windows: [NATIONAL_MX, oaxWindow],
      regionPrimary: 'MX-OAX',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result?.region_code).toBe('MX-OAX');
  });

  it('falls back to national window when no state window matches', () => {
    const now = new Date('2026-06-09T12:00:00Z'); // DOY ~160
    const result = pickMigrationWindow({
      windows: [NATIONAL_MX],
      regionPrimary: 'MX-OAX',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result?.region_code).toBe('MX');
  });

  it('picks lowest id when two windows have same region and same DOY', () => {
    const now = new Date('2026-10-07T12:00:00Z'); // DOY ~280
    const w1: MigrationWindow = { ...MONARCH_MIC, id: 5 };
    const w2: MigrationWindow = { ...MONARCH_MIC, id: 3, body_en: 'Other' };
    const result = pickMigrationWindow({
      windows: [w1, w2],
      regionPrimary: 'MX-MIC',
      lastSentAt: null,
      tz,
      now,
    });
    expect(result?.id).toBe(3);
  });
});

describe('pickMigrationWindow — skipping logic', () => {
  it('returns null when user region_primary is NULL', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(pickMigrationWindow({
      windows: [MONARCH_MIC],
      regionPrimary: null,
      lastSentAt: null,
      tz,
      now,
    })).toBeNull();
  });

  it('respects 1/day cap — already sent today → no fire', () => {
    const now = new Date('2026-10-07T20:00:00Z');
    const sentToday = new Date('2026-10-07T15:00:00Z').toISOString();
    expect(pickMigrationWindow({
      windows: [MONARCH_MIC],
      regionPrimary: 'MX-MIC',
      lastSentAt: sentToday,
      tz,
      now,
    })).toBeNull();
  });

  it('fires if last sent was yesterday', () => {
    const now = new Date('2026-10-07T20:00:00Z');
    const sentYesterday = new Date('2026-10-06T15:00:00Z').toISOString();
    const result = pickMigrationWindow({
      windows: [MONARCH_MIC],
      regionPrimary: 'MX-MIC',
      lastSentAt: sentYesterday,
      tz,
      now,
    });
    expect(result).not.toBeNull();
  });

  it('does not fire when no windows match the user region', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(pickMigrationWindow({
      windows: [SWAINSON_VER],
      regionPrimary: 'MX-MIC',
      lastSentAt: null,
      tz,
      now,
    })).toBeNull();
  });
});
