import { describe, it, expect } from 'vitest';
import {
  IUCN_MULTIPLIERS,
  NOM059_MULTIPLIERS,
  getConservationMultiplier,
  conservationBonusText,
} from './karma-conservation';
import type { IUCNCategory, NOM059Category } from './karma-conservation';

describe('IUCN_MULTIPLIERS', () => {
  it('has 8 entries covering all IUCN categories', () => {
    expect(IUCN_MULTIPLIERS).toHaveLength(8);
    const cats = IUCN_MULTIPLIERS.map(m => m.category);
    expect(cats).toEqual(['LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'DD', 'NE']);
  });

  it('all entries have source "iucn"', () => {
    for (const m of IUCN_MULTIPLIERS) {
      expect(m.source).toBe('iucn');
    }
  });

  it('multipliers increase with threat level (LC < NT < VU < EN < CR < EW)', () => {
    const ordered: IUCNCategory[] = ['LC', 'NT', 'VU', 'EN', 'CR', 'EW'];
    for (let i = 1; i < ordered.length; i++) {
      const prev = IUCN_MULTIPLIERS.find(m => m.category === ordered[i - 1])!;
      const curr = IUCN_MULTIPLIERS.find(m => m.category === ordered[i])!;
      expect(curr.multiplier).toBeGreaterThan(prev.multiplier);
    }
  });
});

describe('NOM059_MULTIPLIERS', () => {
  it('has 4 entries covering all NOM-059 categories', () => {
    expect(NOM059_MULTIPLIERS).toHaveLength(4);
    const cats = NOM059_MULTIPLIERS.map(m => m.category);
    expect(cats).toEqual(['Pr', 'A', 'P', 'E']);
  });

  it('all entries have source "nom059"', () => {
    for (const m of NOM059_MULTIPLIERS) {
      expect(m.source).toBe('nom059');
    }
  });

  it('multipliers increase with threat level (Pr < A < P < E)', () => {
    for (let i = 1; i < NOM059_MULTIPLIERS.length; i++) {
      expect(NOM059_MULTIPLIERS[i].multiplier)
        .toBeGreaterThan(NOM059_MULTIPLIERS[i - 1].multiplier);
    }
  });
});

describe('getConservationMultiplier', () => {
  describe('IUCN only', () => {
    const cases: [IUCNCategory, number][] = [
      ['LC', 1.0],
      ['NT', 1.2],
      ['VU', 1.5],
      ['EN', 2.0],
      ['CR', 3.0],
      ['EW', 5.0],
      ['DD', 1.5],
      ['NE', 1.0],
    ];

    it.each(cases)('IUCN %s → multiplier %s', (cat, expected) => {
      const result = getConservationMultiplier(cat, null);
      expect(result.multiplier).toBe(expected);
      expect(result.source).toBe(`IUCN ${cat}`);
    });
  });

  describe('NOM-059 only', () => {
    const cases: [NonNullable<NOM059Category>, number][] = [
      ['Pr', 1.3],
      ['A', 1.8],
      ['P', 2.5],
      ['E', 4.0],
    ];

    it.each(cases)('NOM-059 %s → multiplier %s', (cat, expected) => {
      const result = getConservationMultiplier(null, cat);
      expect(result.multiplier).toBe(expected);
      expect(result.source).toBe(`NOM-059 ${cat}`);
    });
  });

  describe('higher multiplier wins when both present', () => {
    it('NOM-059 E (4.0) beats IUCN CR (3.0)', () => {
      const result = getConservationMultiplier('CR', 'E');
      expect(result.multiplier).toBe(4.0);
      expect(result.source).toBe('NOM-059 E');
    });

    it('IUCN EW (5.0) beats NOM-059 E (4.0)', () => {
      const result = getConservationMultiplier('EW', 'E');
      expect(result.multiplier).toBe(5.0);
      expect(result.source).toBe('IUCN EW');
    });

    it('IUCN EN (2.0) beats NOM-059 Pr (1.3)', () => {
      const result = getConservationMultiplier('EN', 'Pr');
      expect(result.multiplier).toBe(2.0);
      expect(result.source).toBe('IUCN EN');
    });

    it('NOM-059 P (2.5) beats IUCN EN (2.0)', () => {
      const result = getConservationMultiplier('EN', 'P');
      expect(result.multiplier).toBe(2.5);
      expect(result.source).toBe('NOM-059 P');
    });

    it('when tied, IUCN wins (IUCN VU 1.5 vs DD 1.5 — same source)', () => {
      const result = getConservationMultiplier('VU', 'Pr');
      // VU = 1.5, Pr = 1.3 → IUCN wins
      expect(result.multiplier).toBe(1.5);
      expect(result.source).toBe('IUCN VU');
    });
  });

  describe('null/missing categories default to 1.0', () => {
    it('both null → multiplier 1.0, source "none"', () => {
      const result = getConservationMultiplier(null, null);
      expect(result.multiplier).toBe(1.0);
      expect(result.source).toBe('none');
      expect(result.label_en).toBe('Not assessed');
      expect(result.label_es).toBe('No evaluada');
    });

    it('IUCN null, NOM-059 null → 1.0', () => {
      const result = getConservationMultiplier(null, null);
      expect(result.multiplier).toBe(1.0);
    });
  });

  it('returns bilingual labels', () => {
    const result = getConservationMultiplier('CR', null);
    expect(result.label_en).toBe('Critically Endangered');
    expect(result.label_es).toBe('En peligro crítico');
  });
});

describe('conservationBonusText', () => {
  it('returns null for multiplier 1.0', () => {
    expect(conservationBonusText(1.0, 'none', 'en')).toBeNull();
  });

  it('returns null for multiplier less than 1.0', () => {
    expect(conservationBonusText(0.5, 'none', 'en')).toBeNull();
  });

  it('returns English text for multiplier > 1.0', () => {
    const text = conservationBonusText(3.0, 'IUCN CR', 'en');
    expect(text).toBe('×3 conservation bonus (IUCN CR)');
  });

  it('returns Spanish text for multiplier > 1.0', () => {
    const text = conservationBonusText(2.5, 'NOM-059 P', 'es');
    expect(text).toBe('×2.5 bono conservación (NOM-059 P)');
  });

  it('includes the source in the output', () => {
    const text = conservationBonusText(1.5, 'IUCN VU', 'en');
    expect(text).toContain('IUCN VU');
  });
});
