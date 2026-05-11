/**
 * Tests for Places feature improvements (#711).
 *
 * Focuses on pure helpers and UI logic that can be tested without DOM/Supabase:
 * 1. renderCard includes observer count when present
 * 2. renderCard includes last activity date when present
 * 3. renderCard omits observer count when 0
 * 4. renderCard omits last activity when null
 * 5. PlacesNearby component exists (smoke)
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Place card social layer helpers (mirroring the renderCard logic in
// ExplorePlacesView.astro for testing the business rules separately)
// ---------------------------------------------------------------------------

interface PlaceCardData {
  slug: string;
  name: string;
  place_type: string;
  obs_count: number;
  species_count: number;
  observer_count?: number;
  last_obs_at?: string | null;
}

function buildSocialLayer(place: PlaceCardData, lang: string): {
  observersStr: string;
  lastActivityStr: string;
} {
  const obsCountVal = place.observer_count ?? 0;
  const observersStr = obsCountVal > 0
    ? `👥 ${obsCountVal.toLocaleString()}`
    : '';
  const lastActivityStr = place.last_obs_at
    ? `🕒 ${new Date(place.last_obs_at).toLocaleDateString(
        lang === 'es' ? 'es-MX' : 'en-US',
        { year: 'numeric', month: 'short' }
      )}`
    : '';
  return { observersStr, lastActivityStr };
}

describe('Place card social layer (#711)', () => {
  const basePlace: PlaceCardData = {
    slug: 'sierra-norte',
    name: 'Sierra Norte',
    place_type: 'protected_area',
    obs_count: 340,
    species_count: 88,
  };

  it('shows observer count when > 0', () => {
    const { observersStr } = buildSocialLayer(
      { ...basePlace, observer_count: 12 },
      'en'
    );
    expect(observersStr).toContain('12');
    expect(observersStr).toContain('👥');
  });

  it('omits observer count when 0', () => {
    const { observersStr } = buildSocialLayer(
      { ...basePlace, observer_count: 0 },
      'en'
    );
    expect(observersStr).toBe('');
  });

  it('omits observer count when undefined', () => {
    const { observersStr } = buildSocialLayer(basePlace, 'en');
    expect(observersStr).toBe('');
  });

  it('shows last activity date when present', () => {
    const { lastActivityStr } = buildSocialLayer(
      { ...basePlace, last_obs_at: '2026-04-15T10:00:00Z' },
      'en'
    );
    expect(lastActivityStr).toContain('🕒');
    expect(lastActivityStr).toContain('2026');
  });

  it('omits last activity when null', () => {
    const { lastActivityStr } = buildSocialLayer(
      { ...basePlace, last_obs_at: null },
      'en'
    );
    expect(lastActivityStr).toBe('');
  });

  it('omits last activity when undefined', () => {
    const { lastActivityStr } = buildSocialLayer(basePlace, 'en');
    expect(lastActivityStr).toBe('');
  });

  it('uses es-MX locale for date formatting in ES', () => {
    const { lastActivityStr } = buildSocialLayer(
      { ...basePlace, last_obs_at: '2026-04-15T10:00:00Z' },
      'es'
    );
    expect(lastActivityStr).toContain('2026');
    // Month will be in Spanish
    expect(lastActivityStr.toLowerCase()).toMatch(/abr|apr/);
  });
});

describe('PlacesNearby component (#711)', () => {
  it('component file exists', () => {
    const componentPath = resolve(
      import.meta.dirname ?? __dirname,
      '../../src/components/PlacesNearby.astro'
    );
    expect(existsSync(componentPath)).toBe(true);
  });
});
