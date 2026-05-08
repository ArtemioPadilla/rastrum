import { describe, it, expect } from 'vitest';
import {
  pickSeasonalTheme,
  resolveSeasonalTheme,
  readStoredChoice,
  regionFromUserProfile,
  applySeasonalTheme,
  STORAGE_KEY,
} from '../../src/lib/seasonal-theme';

function dateAt(month: number): Date {
  return new Date(2026, month - 1, 15);
}

describe('pickSeasonalTheme — MX-Centro month mapping', () => {
  it('returns monarca for Oct–Mar (overwintering season)', () => {
    expect(pickSeasonalTheme(dateAt(10))).toBe('monarca');
    expect(pickSeasonalTheme(dateAt(11))).toBe('monarca');
    expect(pickSeasonalTheme(dateAt(12))).toBe('monarca');
    expect(pickSeasonalTheme(dateAt(1))).toBe('monarca');
    expect(pickSeasonalTheme(dateAt(2))).toBe('monarca');
    expect(pickSeasonalTheme(dateAt(3))).toBe('monarca');
  });

  it('returns secas for Apr–May (late dry season)', () => {
    expect(pickSeasonalTheme(dateAt(4))).toBe('secas');
    expect(pickSeasonalTheme(dateAt(5))).toBe('secas');
  });

  it('returns lluvias for Jun–Sep (rainy season)', () => {
    expect(pickSeasonalTheme(dateAt(6))).toBe('lluvias');
    expect(pickSeasonalTheme(dateAt(7))).toBe('lluvias');
    expect(pickSeasonalTheme(dateAt(8))).toBe('lluvias');
    expect(pickSeasonalTheme(dateAt(9))).toBe('lluvias');
  });

  it('falls back to default for non-MX regions', () => {
    expect(pickSeasonalTheme(dateAt(7), 'default')).toBe('default');
    expect(pickSeasonalTheme(dateAt(2), 'default')).toBe('default');
  });

  it('treats MX-Norte and MX-Sur as MX-Centro for v1', () => {
    expect(pickSeasonalTheme(dateAt(7), 'MX-Norte')).toBe('lluvias');
    expect(pickSeasonalTheme(dateAt(2), 'MX-Sur')).toBe('monarca');
  });
});

describe('regionFromUserProfile', () => {
  it('maps MX → MX-Centro', () => {
    expect(regionFromUserProfile('MX')).toBe('MX-Centro');
    expect(regionFromUserProfile('mx')).toBe('MX-Centro');
    expect(regionFromUserProfile('CDMX')).toBe('MX-Centro');
  });

  it('maps non-MX → default', () => {
    expect(regionFromUserProfile('US')).toBe('default');
    expect(regionFromUserProfile('CO')).toBe('default');
  });

  it('treats null/undefined as MX-Centro (v1 default)', () => {
    expect(regionFromUserProfile(null)).toBe('MX-Centro');
    expect(regionFromUserProfile(undefined)).toBe('MX-Centro');
  });

  it('parses MX-Norte / MX-Sur prefixes', () => {
    expect(regionFromUserProfile('MX-Norte-Sonora')).toBe('MX-Norte');
    expect(regionFromUserProfile('MX-Sur-Chiapas')).toBe('MX-Sur');
  });
});

describe('resolveSeasonalTheme', () => {
  it('returns the manual override when one is set', () => {
    expect(
      resolveSeasonalTheme({ choice: 'monarca', now: dateAt(7), region: 'MX-Centro' }),
    ).toBe('monarca');
    expect(
      resolveSeasonalTheme({ choice: 'default', now: dateAt(7), region: 'MX-Centro' }),
    ).toBe('default');
  });

  it("falls through to the auto pick when choice is 'auto'", () => {
    expect(
      resolveSeasonalTheme({ choice: 'auto', now: dateAt(7), region: 'MX-Centro' }),
    ).toBe('lluvias');
    expect(
      resolveSeasonalTheme({ choice: 'auto', now: dateAt(11), region: 'MX-Centro' }),
    ).toBe('monarca');
  });
});

describe('readStoredChoice', () => {
  function makeStorage(map: Map<string, string>): Pick<Storage, 'getItem'> {
    return { getItem: (k: string) => map.get(k) ?? null };
  }

  it("returns 'auto' when nothing is stored", () => {
    expect(readStoredChoice(makeStorage(new Map()))).toBe('auto');
  });

  it('returns the stored theme when valid', () => {
    expect(readStoredChoice(makeStorage(new Map([[STORAGE_KEY, 'monarca']])))).toBe('monarca');
    expect(readStoredChoice(makeStorage(new Map([[STORAGE_KEY, 'secas']])))).toBe('secas');
  });

  it("returns 'auto' for unknown values", () => {
    expect(readStoredChoice(makeStorage(new Map([[STORAGE_KEY, 'rainbow']])))).toBe('auto');
  });
});

describe('applySeasonalTheme', () => {
  it('writes data-season on the documentElement', () => {
    const doc = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } as unknown as HTMLElement };
    const attrs = new Map<string, string>();
    doc.documentElement.setAttribute = (k: string, v: string) => { attrs.set(k, v); };
    applySeasonalTheme('monarca', doc);
    expect(attrs.get('data-season')).toBe('monarca');
  });
});
