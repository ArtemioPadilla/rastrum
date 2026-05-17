import { describe, it, expect } from 'vitest';
import { CAPABILITY_CATALOG } from './download-capabilities';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

describe('download-capabilities i18n parity', () => {
  it('every CapabilityItem has non-empty EN/ES label + capability strings', () => {
    for (const c of CAPABILITY_CATALOG) {
      for (const field of ['labelEn', 'labelEs', 'capabilityEn', 'capabilityEs'] as const) {
        expect(typeof c[field]).toBe('string');
        expect(c[field].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('observe.downloads exists with identical key sets in EN + ES', () => {
    const enDl = (en as Record<string, any>).observe?.downloads;
    const esDl = (es as Record<string, any>).observe?.downloads;
    expect(enDl).toBeTruthy();
    expect(esDl).toBeTruthy();
    const enKeys = Object.keys(enDl).sort();
    const esKeys = Object.keys(esDl).sort();
    expect(enKeys).toEqual(esKeys);
    for (const k of enKeys) {
      expect(typeof enDl[k]).toBe('string');
      expect(typeof esDl[k]).toBe('string');
      expect(enDl[k].trim().length).toBeGreaterThan(0);
      expect(esDl[k].trim().length).toBeGreaterThan(0);
    }
  });
});
