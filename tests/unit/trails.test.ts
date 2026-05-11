/**
 * tests/unit/trails.test.ts — Tests for Biodiversity Trails data model (issue #191).
 *
 * Tests trail data model contracts, waypoint structures, and display logic
 * that can be verified without a live database.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Trail data model types (mirrors what Supabase returns)
// ---------------------------------------------------------------------------

interface Waypoint {
  lat: number;
  lng: number;
  name?: string;
  obs_count?: number;
}

interface Trail {
  id: string;
  name: string;
  name_es?: string;
  creator_id?: string;
  waypoints: Waypoint[];
  total_species: number;
  total_observations: number;
  distance_km?: number | null;
  visibility: 'public' | 'private';
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helper: haversine distance between two GPS points (km)
// ---------------------------------------------------------------------------

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Calculate total trail distance from an ordered array of waypoints. */
function trailDistanceKm(waypoints: Waypoint[]): number {
  if (waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += haversineKm(
      waypoints[i].lat, waypoints[i].lng,
      waypoints[i + 1].lat, waypoints[i + 1].lng,
    );
  }
  return total;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleWaypoints: Waypoint[] = [
  { lat: 19.4326, lng: -99.1332, name: 'Entrada Chapultepec',   obs_count: 5  },
  { lat: 19.4310, lng: -99.1800, name: 'Lago Mayor',            obs_count: 12 },
  { lat: 19.4285, lng: -99.1850, name: 'Bosque de Ahuehuetes',  obs_count: 8  },
];

const sampleTrail: Trail = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Chapultepec Loop',
  name_es: 'Circuito Chapultepec',
  creator_id: 'user-uuid-1234',
  waypoints: sampleWaypoints,
  total_species: 24,
  total_observations: 87,
  distance_km: 3.2,
  visibility: 'public',
  created_at: '2026-05-01T10:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trail data model', () => {
  it('trail has required fields', () => {
    expect(sampleTrail.id).toBeTruthy();
    expect(sampleTrail.name).toBeTruthy();
    expect(Array.isArray(sampleTrail.waypoints)).toBe(true);
    expect(typeof sampleTrail.total_species).toBe('number');
    expect(typeof sampleTrail.total_observations).toBe('number');
  });

  it('visibility is public or private', () => {
    const valid: Trail['visibility'][] = ['public', 'private'];
    expect(valid).toContain(sampleTrail.visibility);
  });

  it('waypoints array has lat/lng fields', () => {
    for (const wp of sampleTrail.waypoints) {
      expect(typeof wp.lat).toBe('number');
      expect(typeof wp.lng).toBe('number');
    }
  });

  it('lat is in valid range [-90, 90]', () => {
    for (const wp of sampleTrail.waypoints) {
      expect(wp.lat).toBeGreaterThanOrEqual(-90);
      expect(wp.lat).toBeLessThanOrEqual(90);
    }
  });

  it('lng is in valid range [-180, 180]', () => {
    for (const wp of sampleTrail.waypoints) {
      expect(wp.lng).toBeGreaterThanOrEqual(-180);
      expect(wp.lng).toBeLessThanOrEqual(180);
    }
  });

  it('name_es is optional', () => {
    const trailNoEs: Trail = { ...sampleTrail, name_es: undefined };
    expect(trailNoEs.name_es).toBeUndefined();
  });

  it('distance_km is optional / nullable', () => {
    const noDistance: Trail = { ...sampleTrail, distance_km: null };
    expect(noDistance.distance_km).toBeNull();
  });
});

describe('trailDistanceKm', () => {
  it('returns 0 for empty waypoints', () => {
    expect(trailDistanceKm([])).toBe(0);
  });

  it('returns 0 for single waypoint', () => {
    expect(trailDistanceKm([{ lat: 19.43, lng: -99.13 }])).toBe(0);
  });

  it('calculates positive distance for valid waypoints', () => {
    const dist = trailDistanceKm(sampleWaypoints);
    expect(dist).toBeGreaterThan(0);
  });

  it('distance for north–south 1° is ~111 km', () => {
    const dist = haversineKm(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(112);
  });
});

describe('Trail display logic', () => {
  it('uses name_es when isEs=true and name_es exists', () => {
    const isEs = true;
    const displayName = isEs && sampleTrail.name_es ? sampleTrail.name_es : sampleTrail.name;
    expect(displayName).toBe('Circuito Chapultepec');
  });

  it('falls back to name when isEs=false', () => {
    const isEs = false;
    const displayName = isEs && sampleTrail.name_es ? sampleTrail.name_es : sampleTrail.name;
    expect(displayName).toBe('Chapultepec Loop');
  });

  it('waypoint count matches waypoints array length', () => {
    expect(sampleTrail.waypoints.length).toBe(3);
  });

  it('trail URL uses id as slug', () => {
    const base = '/en/explore/trails/';
    const url = `${base}${sampleTrail.id}`;
    expect(url).toContain(sampleTrail.id);
  });
});
