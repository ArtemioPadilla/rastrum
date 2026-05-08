import { describe, it, expect } from 'vitest';
import {
  parseStoredTheme,
  resolveEffective,
  applyEffective,
  FIELD_LUX_THRESHOLD,
} from '../../src/lib/theme';

describe('parseStoredTheme', () => {
  it('returns the stored value when valid', () => {
    expect(parseStoredTheme('light')).toBe('light');
    expect(parseStoredTheme('dark')).toBe('dark');
    expect(parseStoredTheme('auto')).toBe('auto');
    expect(parseStoredTheme('field')).toBe('field');
  });

  it('falls back to auto on missing or invalid input', () => {
    expect(parseStoredTheme(null)).toBe('auto');
    expect(parseStoredTheme(undefined)).toBe('auto');
    expect(parseStoredTheme('')).toBe('auto');
    expect(parseStoredTheme('FIELD')).toBe('auto');
    expect(parseStoredTheme('garbage')).toBe('auto');
  });
});

describe('resolveEffective', () => {
  it('honors explicit light/dark/field over context', () => {
    expect(resolveEffective('light', { prefersDark: true,  lux: 99999 })).toBe('light');
    expect(resolveEffective('dark',  { prefersDark: false, lux: 0     })).toBe('dark');
    expect(resolveEffective('field', { prefersDark: false, lux: 0     })).toBe('field');
  });

  it('auto falls through to system dark preference', () => {
    expect(resolveEffective('auto', { prefersDark: true })).toBe('dark');
    expect(resolveEffective('auto', { prefersDark: false })).toBe('light');
  });

  it('auto engages field when lux exceeds threshold', () => {
    expect(resolveEffective('auto', { prefersDark: false, lux: FIELD_LUX_THRESHOLD + 1 })).toBe('field');
    expect(resolveEffective('auto', { prefersDark: true,  lux: FIELD_LUX_THRESHOLD + 1 })).toBe('field');
  });

  it('auto does not engage field at or below threshold', () => {
    expect(resolveEffective('auto', { prefersDark: false, lux: FIELD_LUX_THRESHOLD })).toBe('light');
    expect(resolveEffective('auto', { prefersDark: false, lux: 1000 })).toBe('light');
    expect(resolveEffective('auto', { prefersDark: false, lux: null })).toBe('light');
    expect(resolveEffective('auto', { prefersDark: false })).toBe('light');
  });
});

describe('applyEffective', () => {
  function fakeEl(): { classList: DOMTokenList; tokens: Set<string> } {
    const tokens = new Set<string>();
    const classList = {
      add: (c: string) => { tokens.add(c); },
      remove: (c: string) => { tokens.delete(c); },
      contains: (c: string) => tokens.has(c),
      toggle: (c: string, force?: boolean) => {
        const next = force ?? !tokens.has(c);
        if (next) tokens.add(c); else tokens.delete(c);
        return next;
      },
    } as unknown as DOMTokenList;
    return { classList, tokens };
  }

  it('field sets both dark and field', () => {
    const el = fakeEl();
    applyEffective(el, 'field');
    expect(el.tokens.has('dark')).toBe(true);
    expect(el.tokens.has('field')).toBe(true);
  });

  it('dark sets dark, removes field', () => {
    const el = fakeEl();
    el.tokens.add('field');
    applyEffective(el, 'dark');
    expect(el.tokens.has('dark')).toBe(true);
    expect(el.tokens.has('field')).toBe(false);
  });

  it('light removes both classes', () => {
    const el = fakeEl();
    el.tokens.add('dark');
    el.tokens.add('field');
    applyEffective(el, 'light');
    expect(el.tokens.has('dark')).toBe(false);
    expect(el.tokens.has('field')).toBe(false);
  });
});
