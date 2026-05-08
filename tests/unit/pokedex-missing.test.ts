import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadShowMissing,
  saveShowMissing,
  formatRegionCount,
} from '../../src/lib/pokedex-missing';

describe('pokedex-missing — showMissing localStorage toggle', () => {
  let store: Map<string, string>;
  let storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

  beforeEach(() => {
    store = new Map<string, string>();
    storage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  });

  it('defaults to false on first load', () => {
    expect(loadShowMissing(storage)).toBe(false);
  });

  it('round-trips true through save + load', () => {
    saveShowMissing(true, storage);
    expect(loadShowMissing(storage)).toBe(true);
  });

  it('saving false removes the key (default state)', () => {
    saveShowMissing(true, storage);
    expect(store.has('rastrum.pokedex.showMissing')).toBe(true);
    saveShowMissing(false, storage);
    expect(store.has('rastrum.pokedex.showMissing')).toBe(false);
  });

  it('accepts legacy "true" value (forwards-compat)', () => {
    storage.setItem('rastrum.pokedex.showMissing', 'true');
    expect(loadShowMissing(storage)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    storage.setItem('rastrum.pokedex.showMissing', 'maybe');
    expect(loadShowMissing(storage)).toBe(false);
  });

  it('uses the documented storage key', () => {
    saveShowMissing(true, storage);
    expect(store.has('rastrum.pokedex.showMissing')).toBe(true);
  });

  it('returns false when storage is unavailable (no throw)', () => {
    expect(loadShowMissing(null)).toBe(false);
    expect(() => saveShowMissing(true, null)).not.toThrow();
  });
});

describe('pokedex-missing — formatRegionCount', () => {
  const en = {
    template: '{observed} of {total} species in your region',
    fallback: '{observed} species observed',
  };
  const es = {
    template: '{observed} de {total} especies en tu región',
    fallback: '{observed} especies observadas',
  };

  it('formats observed/total in English', () => {
    expect(formatRegionCount(12, 250, en)).toBe('12 of 250 species in your region');
  });

  it('formats observed/total in Spanish', () => {
    expect(formatRegionCount(3, 87, es)).toBe('3 de 87 especies en tu región');
  });

  it('falls back when total is null (region unknown)', () => {
    expect(formatRegionCount(7, null, en)).toBe('7 species observed');
  });

  it('falls back when total is zero (empty pool)', () => {
    expect(formatRegionCount(0, 0, es)).toBe('0 especies observadas');
  });

  it('clamps total >= observed (pool lag is invisible to user)', () => {
    // Just-observed species not yet in the regional research-grade pool.
    expect(formatRegionCount(15, 10, en)).toBe('15 of 15 species in your region');
  });

  it('floors negative observed counts to 0', () => {
    expect(formatRegionCount(-3, 50, en)).toBe('0 of 50 species in your region');
  });
});
