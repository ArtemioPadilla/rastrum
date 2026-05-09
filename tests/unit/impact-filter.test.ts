import { describe, it, expect } from 'vitest';
import {
  IMPACT_FILTERS,
  isImpactFilter,
  parseImpactFilter,
} from '../../src/lib/impact-filter';

describe('impact-filter', () => {
  describe('isImpactFilter', () => {
    it('accepts every known filter id', () => {
      for (const f of IMPACT_FILTERS) {
        expect(isImpactFilter(f)).toBe(true);
      }
    });
    it('rejects unknown values, null, undefined, empty', () => {
      expect(isImpactFilter('garbage')).toBe(false);
      expect(isImpactFilter('')).toBe(false);
      expect(isImpactFilter(null)).toBe(false);
      expect(isImpactFilter(undefined)).toBe(false);
      expect(isImpactFilter('Mapped')).toBe(false);
    });
  });

  describe('parseImpactFilter', () => {
    it('returns none when input is null/undefined/empty', () => {
      expect(parseImpactFilter(null)).toEqual({ kind: 'none' });
      expect(parseImpactFilter(undefined)).toEqual({ kind: 'none' });
      expect(parseImpactFilter('')).toEqual({ kind: 'none' });
      expect(parseImpactFilter('?')).toEqual({ kind: 'none' });
    });

    it('returns none when the param is absent', () => {
      expect(parseImpactFilter('?other=1')).toEqual({ kind: 'none' });
    });

    it('returns none when the param is present-but-empty', () => {
      expect(parseImpactFilter('?filter=')).toEqual({ kind: 'none' });
    });

    it('recognizes each known value (string input)', () => {
      for (const f of IMPACT_FILTERS) {
        expect(parseImpactFilter(`?filter=${f}`)).toEqual({
          kind: 'recognized',
          value: f,
        });
      }
    });

    it('strips a leading ? when given a raw query string', () => {
      expect(parseImpactFilter('filter=mapped')).toEqual({
        kind: 'recognized',
        value: 'mapped',
      });
    });

    it('accepts URLSearchParams directly', () => {
      const params = new URLSearchParams('filter=research_grade&page=2');
      expect(parseImpactFilter(params)).toEqual({
        kind: 'recognized',
        value: 'research_grade',
      });
    });

    it('flags unknown values rather than silently failing', () => {
      expect(parseImpactFilter('?filter=garbage')).toEqual({
        kind: 'unknown',
        raw: 'garbage',
      });
    });

    it('is case-sensitive — Mapped is not a match', () => {
      expect(parseImpactFilter('?filter=Mapped')).toEqual({
        kind: 'unknown',
        raw: 'Mapped',
      });
    });

    it('uses the first occurrence when filter appears twice', () => {
      // URLSearchParams.get returns the first value
      expect(parseImpactFilter('?filter=mapped&filter=garbage')).toEqual({
        kind: 'recognized',
        value: 'mapped',
      });
    });
  });
});
