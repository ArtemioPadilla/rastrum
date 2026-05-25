/**
 * Unit tests for the OnboardingTour geo-aware demo species picker.
 *
 * Pure module → trivially testable. Mirrors the priority table in
 * src/lib/onboarding-demo-species.ts and pins the "no Geolocation API"
 * contract (no DOM / no `permission` token in the implementation).
 */
import { describe, it, expect } from 'vitest';
import {
  pickDemoSpecies,
  formatDemoSpeciesLabel,
  parseNavigatorLocale,
} from '../../src/lib/onboarding-demo-species';

describe('parseNavigatorLocale', () => {
  it('parses es-MX into lang+region', () => {
    expect(parseNavigatorLocale('es-MX')).toEqual({ lang: 'es', region: 'MX' });
  });

  it('parses en-US into lang+region', () => {
    expect(parseNavigatorLocale('en-US')).toEqual({ lang: 'en', region: 'US' });
  });

  it('handles bare language tags (es)', () => {
    expect(parseNavigatorLocale('es')).toEqual({ lang: 'es', region: null });
  });

  it('returns en/null when input is empty or null', () => {
    expect(parseNavigatorLocale(null)).toEqual({ lang: 'en', region: null });
    expect(parseNavigatorLocale(undefined)).toEqual({ lang: 'en', region: null });
  });

  it('parses underscore form (es_MX) via manual fallback', () => {
    const parsed = parseNavigatorLocale('es_MX');
    expect(parsed.lang).toBe('es');
    expect(parsed.region).toBe('MX');
  });
});

describe('pickDemoSpecies — Spanish regional picks', () => {
  it('es-MX → Crotophaga sulcirostris (regional bird)', () => {
    const s = pickDemoSpecies('es-MX');
    expect(s.scientific).toBe('Crotophaga sulcirostris');
    expect(s.common).toContain('Garrapatero');
  });

  it('es-CO → Tangara cyanicollis', () => {
    expect(pickDemoSpecies('es-CO').scientific).toBe('Tangara cyanicollis');
  });

  it('es-AR → Megaceryle torquata', () => {
    expect(pickDemoSpecies('es-AR').scientific).toBe('Megaceryle torquata');
  });

  it('es-PE and es-CL share Vultur gryphus', () => {
    expect(pickDemoSpecies('es-PE').scientific).toBe('Vultur gryphus');
    expect(pickDemoSpecies('es-CL').scientific).toBe('Vultur gryphus');
  });

  it('es with no region falls back to Quercus rugosa (neotropical oak)', () => {
    expect(pickDemoSpecies('es').scientific).toBe('Quercus rugosa');
  });

  it('unknown es region falls back to Quercus rugosa', () => {
    expect(pickDemoSpecies('es-XX').scientific).toBe('Quercus rugosa');
  });
});

describe('pickDemoSpecies — English regional picks', () => {
  it('en-US → Northern Cardinal', () => {
    expect(pickDemoSpecies('en-US').scientific).toBe('Cardinalis cardinalis');
  });

  it('en-MX → Groove-billed Ani (parity with es-MX)', () => {
    expect(pickDemoSpecies('en-MX').scientific).toBe('Crotophaga sulcirostris');
  });

  it('en with no region falls back to Quercus robur', () => {
    expect(pickDemoSpecies('en').scientific).toBe('Quercus robur');
  });

  it('en-GB (unknown region) falls back to Quercus robur', () => {
    expect(pickDemoSpecies('en-GB').scientific).toBe('Quercus robur');
  });
});

describe('pickDemoSpecies — fallback handling', () => {
  it('uses provided fallback when language is unsupported', () => {
    const out = pickDemoSpecies('fr-FR', { scientific: 'Custom sp', common: 'Custom name' });
    expect(out.scientific).toBe('Custom sp');
  });

  it('uses EN default when language is unsupported and no fallback given', () => {
    expect(pickDemoSpecies('fr-FR').scientific).toBe('Quercus robur');
  });
});

describe('formatDemoSpeciesLabel', () => {
  it('joins scientific + common with em-dash', () => {
    expect(formatDemoSpeciesLabel({ scientific: 'A', common: 'B' })).toBe('A — B');
  });
});

describe('no Geolocation API — purity invariant', () => {
  it('source file does not import or reference Geolocation', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/lib/onboarding-demo-species.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/navigator\.geolocation/i);
    expect(src).not.toMatch(/getCurrentPosition/i);
  });
});
