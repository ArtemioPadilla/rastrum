/**
 * tests/unit/pits.test.ts — Tests for PITs (Puntos de Información Territorial) (issue #193).
 *
 * Tests the PIT data model, QR URL generation, deep-link construction,
 * and slug validation that can be verified without a live database or browser.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types (mirror Supabase schema)
// ---------------------------------------------------------------------------

interface PIT {
  id: string;
  slug: string;
  name: string;
  name_es?: string;
  lat: number;
  lng: number;
  qr_payload: string;
  trail_id?: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors component logic)
// ---------------------------------------------------------------------------

function qrUrl(data: string, size = 200): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

function pitDeepLink(slug: string, origin = 'https://rastrum.app', lang = 'en'): string {
  return `${origin}/${lang}/explore/pits/${slug}`;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || /^[a-z0-9]$/.test(slug);
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const samplePit: PIT = {
  id: 'pit-uuid-abcdef',
  slug: 'entrada-chapultepec',
  name: 'Entrada Chapultepec',
  name_es: 'Entrada Chapultepec',
  lat: 19.432608,
  lng: -99.133208,
  qr_payload: 'https://rastrum.app/en/explore/pits/entrada-chapultepec',
  trail_id: null,
  created_at: '2026-05-01T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PIT data model', () => {
  it('has required fields', () => {
    expect(samplePit.id).toBeTruthy();
    expect(samplePit.slug).toBeTruthy();
    expect(samplePit.name).toBeTruthy();
    expect(typeof samplePit.lat).toBe('number');
    expect(typeof samplePit.lng).toBe('number');
    expect(samplePit.qr_payload).toBeTruthy();
  });

  it('lat is in valid range [-90, 90]', () => {
    expect(samplePit.lat).toBeGreaterThanOrEqual(-90);
    expect(samplePit.lat).toBeLessThanOrEqual(90);
  });

  it('lng is in valid range [-180, 180]', () => {
    expect(samplePit.lng).toBeGreaterThanOrEqual(-180);
    expect(samplePit.lng).toBeLessThanOrEqual(180);
  });

  it('trail_id is nullable', () => {
    expect(samplePit.trail_id).toBeNull();
  });

  it('qr_payload matches expected deep-link format', () => {
    expect(samplePit.qr_payload).toContain(samplePit.slug);
    expect(samplePit.qr_payload).toMatch(/^https?:\/\//);
  });
});

describe('qrUrl()', () => {
  it('returns api.qrserver.com URL', () => {
    const url = qrUrl('https://example.com', 200);
    expect(url).toContain('api.qrserver.com');
  });

  it('encodes the data parameter', () => {
    const url = qrUrl('https://rastrum.app/en/explore/pits/mi-pit');
    expect(url).toContain('data=');
    expect(url).not.toContain(' ');
  });

  it('includes size parameter', () => {
    const url = qrUrl('test', 150);
    expect(url).toContain('150x150');
  });
});

describe('pitDeepLink()', () => {
  it('contains the slug', () => {
    const link = pitDeepLink('entrada-chapultepec');
    expect(link).toContain('entrada-chapultepec');
  });

  it('includes the origin', () => {
    const link = pitDeepLink('test', 'https://rastrum.app');
    expect(link).toContain('https://rastrum.app');
  });

  it('follows /lang/explore/pits/slug pattern', () => {
    const link = pitDeepLink('my-pit', 'https://rastrum.app', 'en');
    expect(link).toBe('https://rastrum.app/en/explore/pits/my-pit');
  });
});

describe('slugify()', () => {
  it('lowercases the string', () => {
    expect(slugify('Entrada Chapultepec')).toBe('entrada-chapultepec');
  });

  it('removes accents', () => {
    expect(slugify('Área Natural Protegida')).toBe('area-natural-protegida');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('bosque norte')).toBe('bosque-norte');
  });

  it('truncates to 80 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(80);
  });

  it('produces valid slugs for common Spanish names', () => {
    const slug = slugify('Laguna de Coyoacán');
    expect(isValidSlug(slug)).toBe(true);
  });
});
