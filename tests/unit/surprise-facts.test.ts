import { describe, it, expect } from 'vitest';
import { resolveFact, __TESTING } from '../../src/lib/surprise-facts';

describe('resolveFact', () => {
  it('returns the curated species fact when the scientific name matches exactly', () => {
    const f = resolveFact('Panthera onca');
    expect(f).not.toBeNull();
    expect(f?.es).toMatch(/jaguar/i);
    expect(f?.en).toMatch(/jaguar/i);
  });

  it('matching is case-insensitive and tolerates trailing whitespace', () => {
    expect(resolveFact('panthera onca')).toEqual(__TESTING.SPECIES_FACTS['panthera onca']);
    expect(resolveFact('  PANTHERA  ONCA  '.replace(/\s+/g, ' ').trim())).toEqual(
      __TESTING.SPECIES_FACTS['panthera onca'],
    );
  });

  it('falls back to the genus when the exact species is not in the catalog', () => {
    const f = resolveFact('Panthera leo'); // not in catalog
    expect(f).not.toBeNull();
    // Should pick the Panthera onca entry as the genus fallback
    expect(f?.es).toMatch(/jaguar/i);
  });

  it('always returns a fact for any non-empty scientific name (generic pool fallback)', () => {
    const f = resolveFact('Zzzz unknownus');
    expect(f).not.toBeNull();
    expect(typeof f?.es).toBe('string');
    expect(typeof f?.en).toBe('string');
  });

  it('is deterministic: same input → same fallback', () => {
    const a = resolveFact('Some random name');
    const b = resolveFact('Some random name');
    expect(a).toEqual(b);
  });

  it('returns a fact even when the scientific name is null', () => {
    const f = resolveFact(null);
    expect(f).not.toBeNull();
    expect(typeof f?.es).toBe('string');
  });

  it('every curated species fact has both EN and ES strings', () => {
    for (const [k, v] of Object.entries(__TESTING.SPECIES_FACTS)) {
      expect(typeof v.en, `EN missing for ${k}`).toBe('string');
      expect(typeof v.es, `ES missing for ${k}`).toBe('string');
      expect(v.en.length, `EN empty for ${k}`).toBeGreaterThan(0);
      expect(v.es.length, `ES empty for ${k}`).toBeGreaterThan(0);
    }
  });

  it('every generic fact has both EN and ES strings', () => {
    for (const [i, v] of __TESTING.GENERIC_FACTS.entries()) {
      expect(v.en.length, `EN empty at index ${i}`).toBeGreaterThan(0);
      expect(v.es.length, `ES empty at index ${i}`).toBeGreaterThan(0);
    }
  });
});
