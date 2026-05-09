import { describe, it, expect } from 'vitest';
import { ALGORITHMS, getAlgorithm, type AlgorithmId } from '../../src/lib/algorithms';

describe('algorithms catalog', () => {
  const ids = Object.keys(ALGORITHMS) as AlgorithmId[];

  it('exposes at least one entry per algorithmic surface', () => {
    expect(ids).toContain('community_observers');
    expect(ids).toContain('explore_recent');
    expect(ids).toContain('explore_species_recent');
  });

  it.each(ids)('"%s" has parity EN/ES copy with the required shape', (id) => {
    const entry = getAlgorithm(id);
    expect(entry.headline.en).toBeTruthy();
    expect(entry.headline.es).toBeTruthy();
    expect(entry.summary.en).toBeTruthy();
    expect(entry.summary.es).toBeTruthy();

    for (const lang of ['en', 'es'] as const) {
      const c = entry.copy[lang];
      expect(Array.isArray(c.inputs)).toBe(true);
      expect(c.inputs.length).toBeGreaterThan(0);
      for (const input of c.inputs) {
        expect(typeof input).toBe('string');
        expect(input.length).toBeGreaterThan(0);
      }
      expect(typeof c.window).toBe('string');
      expect(c.window.length).toBeGreaterThan(0);
      expect(typeof c.settings_label).toBe('string');
      expect(c.settings_label.length).toBeGreaterThan(0);
    }
  });

  it.each(ids)('"%s" exposes a settings_path that points somewhere', (id) => {
    const entry = getAlgorithm(id);
    expect(entry.settings_path.en.startsWith('/')).toBe(true);
    expect(entry.settings_path.es.startsWith('/')).toBe(true);
  });

  it('input bullets stay short enough to render in the modal', () => {
    for (const id of ids) {
      const entry = getAlgorithm(id);
      for (const lang of ['en', 'es'] as const) {
        for (const input of entry.copy[lang].inputs) {
          expect(input.length).toBeLessThan(220);
        }
      }
    }
  });
});
