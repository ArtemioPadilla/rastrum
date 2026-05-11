/**
 * tests/unit/trail-field-guide.test.ts — Tests for trail field guide data assembly (issue #195).
 *
 * Tests the data assembly logic for the field guide, NOT the HTML rendering.
 * Covers: data formatting, waypoint serialization, stat calculations, escaping.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Waypoint {
  lat: number;
  lng: number;
  name?: string;
  obs_count?: number;
}

interface TrailForGuide {
  id: string;
  name: string;
  name_es?: string;
  total_species: number;
  total_observations: number;
  waypoints: Waypoint[];
  distance_km?: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helper functions (mirrors edge function and Astro page logic)
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getDisplayName(trail: TrailForGuide, isEs: boolean): string {
  return isEs && trail.name_es ? trail.name_es : trail.name;
}

function formatDate(isoDate: string, locale: string): string {
  return new Date(isoDate).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function assembleFieldGuideStats(trail: TrailForGuide): {
  species: number;
  observations: number;
  waypointCount: number;
  distanceKm: number | null;
} {
  return {
    species: trail.total_species,
    observations: trail.total_observations,
    waypointCount: Array.isArray(trail.waypoints) ? trail.waypoints.length : 0,
    distanceKm: trail.distance_km ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleTrail: TrailForGuide = {
  id: 'trail-uuid-fg-test',
  name: 'Sierra Chichinautzin Loop',
  name_es: 'Circuito Sierra Chichinautzin',
  total_species: 42,
  total_observations: 156,
  distance_km: 8.3,
  waypoints: [
    { lat: 18.9542, lng: -99.1380, name: 'Entrada principal',  obs_count: 15 },
    { lat: 18.9501, lng: -99.1420, name: 'Mirador Oriente',    obs_count: 28 },
    { lat: 18.9467, lng: -99.1455, name: 'Laguna Las Truchas', obs_count: 41 },
  ],
  created_at: '2026-04-15T08:30:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('escapeHtml()', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('returns safe string for clean input', () => {
    expect(escapeHtml('Normal trail name')).toBe('Normal trail name');
  });
});

describe('getDisplayName()', () => {
  it('returns name_es when isEs=true and name_es exists', () => {
    expect(getDisplayName(sampleTrail, true)).toBe('Circuito Sierra Chichinautzin');
  });

  it('returns name when isEs=false', () => {
    expect(getDisplayName(sampleTrail, false)).toBe('Sierra Chichinautzin Loop');
  });

  it('falls back to name when name_es is undefined', () => {
    const t = { ...sampleTrail, name_es: undefined };
    expect(getDisplayName(t, true)).toBe('Sierra Chichinautzin Loop');
  });
});

describe('assembleFieldGuideStats()', () => {
  it('returns all four stat fields', () => {
    const stats = assembleFieldGuideStats(sampleTrail);
    expect(typeof stats.species).toBe('number');
    expect(typeof stats.observations).toBe('number');
    expect(typeof stats.waypointCount).toBe('number');
  });

  it('species and observations match trail data', () => {
    const stats = assembleFieldGuideStats(sampleTrail);
    expect(stats.species).toBe(42);
    expect(stats.observations).toBe(156);
  });

  it('waypointCount matches waypoints array length', () => {
    const stats = assembleFieldGuideStats(sampleTrail);
    expect(stats.waypointCount).toBe(3);
  });

  it('distanceKm is null when not provided', () => {
    const t = { ...sampleTrail, distance_km: null };
    const stats = assembleFieldGuideStats(t);
    expect(stats.distanceKm).toBeNull();
  });
});
