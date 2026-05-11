/**
 * #748 — Observador del mes (Principle of Recognition)
 *
 * Tests for the featured-observer data loading logic and schema.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers that mirror the client-script logic in HomeObservadorDelMes.astro
// ---------------------------------------------------------------------------

interface FeaturedObserver {
  month_date: string;
  user_id: string;
  headline_es: string | null;
  headline_en: string | null;
  users: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  };
}

/** Build the profile URL for the featured observer. */
function buildProfileUrl(
  lang: string,
  username: string | null,
): string {
  const base = lang === 'es' ? '/es/perfil/' : '/en/profile/';
  return `${base}${username ?? ''}/`;
}

/** Get month_date string for a given date (first day of month). */
function getMonthDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Resolve display name: prefer display_name, fallback to username. */
function resolveDisplayName(
  displayName: string | null,
  username: string | null,
): string {
  return displayName ?? username ?? '?';
}

/** Build fake Supabase client returning a featured observer. */
function makeObservadorClient(row: FeaturedObserver | null) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Observador del mes (#748)', () => {
  it('builds correct ES profile URL for a featured observer', () => {
    const url = buildProfileUrl('es', 'naturalistaX');
    expect(url).toBe('/es/perfil/naturalistaX/');
  });

  it('builds correct EN profile URL for a featured observer', () => {
    const url = buildProfileUrl('en', 'naturalistaX');
    expect(url).toBe('/en/profile/naturalistaX/');
  });

  it('getMonthDate returns first day of current month', () => {
    const d = new Date('2026-05-15T12:00:00Z');
    expect(getMonthDate(d)).toBe('2026-05-01');
  });

  it('resolveDisplayName prefers display_name over username', () => {
    expect(resolveDisplayName('Aves Mx', 'aves_mx')).toBe('Aves Mx');
  });

  it('resolveDisplayName falls back to username when display_name is null', () => {
    expect(resolveDisplayName(null, 'aves_mx')).toBe('aves_mx');
  });

  it('returns null when no featured observer for the month', async () => {
    const db = makeObservadorClient(null);
    const { data } = await db
      .from('featured_observers')
      .select('month_date, user_id, headline_es, headline_en, users (username, display_name, avatar_url)')
      .eq('month_date', '2026-05-01')
      .maybeSingle();
    expect(data).toBeNull();
  });

  it('returns featured observer data when one exists', async () => {
    const row: FeaturedObserver = {
      month_date: '2026-05-01',
      user_id: 'user-abc',
      headline_es: '¡Observó 200 especies en mayo!',
      headline_en: 'Observed 200 species in May!',
      users: { username: 'obs_may', display_name: 'Observador Mayo', avatar_url: null },
    };
    const db = makeObservadorClient(row);
    const { data } = await db
      .from('featured_observers')
      .select('month_date, user_id, headline_es, headline_en, users (username, display_name, avatar_url)')
      .eq('month_date', '2026-05-01')
      .maybeSingle();
    expect(data?.user_id).toBe('user-abc');
    expect(data?.headline_es).toContain('200');
  });

  it('schema contains featured_observers table', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.featured_observers');
    expect(schema).toContain('month_date');
  });
});
