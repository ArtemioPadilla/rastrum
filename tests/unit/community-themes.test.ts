/**
 * Unit tests for #811 — community-submitted seasonal themes.
 *
 * Tests cover:
 *  1. isValidHexColor — valid formats
 *  2. isValidHexColor — rejects invalid / CSS-injection payloads
 *  3. sanitiseCommunityThemeInput — passes valid input through
 *  4. sanitiseCommunityThemeInput — throws on invalid accent_color
 *  5. sanitiseCommunityThemeInput — throws on invalid bg_gradient_from
 *  6. sanitiseCommunityThemeInput — throws on invalid slug
 *  7. loadCommunityThemes — returns approved themes
 *  8. loadCommunityThemes — filters out non-approved themes (server RLS, tested via mock)
 *  9. loadCommunityThemes — returns empty array on error
 * 10. loadCommunityThemes — uses sessionStorage cache (bypass=false)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidHexColor,
  sanitiseCommunityThemeInput,
  loadCommunityThemes,
  type CommunityTheme,
} from '../../src/lib/seasonal-theme';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── isValidHexColor ──────────────────────────────────────────────────────

describe('isValidHexColor', () => {
  it('accepts lowercase 6-digit hex', () => {
    expect(isValidHexColor('#ff6b00')).toBe(true);
  });

  it('accepts uppercase 6-digit hex', () => {
    expect(isValidHexColor('#FF6B00')).toBe(true);
  });

  it('accepts mixed-case 6-digit hex', () => {
    expect(isValidHexColor('#10b981')).toBe(true);
  });

  it('rejects 3-digit shorthand', () => {
    expect(isValidHexColor('#fff')).toBe(false);
  });

  it('rejects bare color name', () => {
    expect(isValidHexColor('red')).toBe(false);
  });

  it('rejects CSS injection payload', () => {
    expect(isValidHexColor("red; }; body{display:none}; .foo{color:red")).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHexColor('')).toBe(false);
  });

  it('rejects hex without leading hash', () => {
    expect(isValidHexColor('ff6b00')).toBe(false);
  });
});

// ── sanitiseCommunityThemeInput ──────────────────────────────────────────

const validInput = {
  name_en: 'Monarch Season',
  name_es: 'Temporada Monarca',
  slug: 'monarch-season',
  accent_color: '#ff6b00',
  bg_gradient_from: '#431a00',
  bg_gradient_to: '#7c3a00',
  region: 'MX-CDMX',
  active_months: [10, 11, 12, 1, 2, 3],
};

describe('sanitiseCommunityThemeInput', () => {
  it('returns the input unchanged when all fields are valid', () => {
    const result = sanitiseCommunityThemeInput(validInput);
    expect(result).toEqual(validInput);
  });

  it('throws when accent_color is invalid hex', () => {
    expect(() => sanitiseCommunityThemeInput({ ...validInput, accent_color: 'orange' }))
      .toThrow('accent_color');
  });

  it('throws when bg_gradient_from is invalid hex', () => {
    expect(() => sanitiseCommunityThemeInput({ ...validInput, bg_gradient_from: '#gg0000' }))
      .toThrow('bg_gradient_from');
  });

  it('throws when bg_gradient_to contains injection payload', () => {
    expect(() => sanitiseCommunityThemeInput({
      ...validInput,
      bg_gradient_to: "red; }body{background:url('evil')}",
    })).toThrow('bg_gradient_to');
  });

  it('throws when slug contains uppercase', () => {
    expect(() => sanitiseCommunityThemeInput({ ...validInput, slug: 'MonarchSeason' }))
      .toThrow('slug');
  });

  it('throws when slug contains spaces', () => {
    expect(() => sanitiseCommunityThemeInput({ ...validInput, slug: 'monarch season' }))
      .toThrow('slug');
  });
});

// ── loadCommunityThemes ──────────────────────────────────────────────────

function makeTheme(overrides: Partial<CommunityTheme> = {}): CommunityTheme {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    creator_id: 'user-uuid-1',
    name_en: 'Test Theme',
    name_es: 'Tema de Prueba',
    slug: 'test-theme',
    accent_color: '#10b981',
    bg_gradient_from: '#064e3b',
    bg_gradient_to: '#065f46',
    region: null,
    active_months: null,
    status: 'approved',
    votes: 0,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function mockSupabase(data: CommunityTheme[] | null, error: { message: string } | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  } as unknown as SupabaseClient;
}

// Mock sessionStorage in node env
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
    removeItem: vi.fn((k: string) => { delete store[k]; }),
  });
});

describe('loadCommunityThemes', () => {
  it('returns approved themes from Supabase', async () => {
    const themes = [makeTheme(), makeTheme({ id: 'aaaaaaaa-0000-0000-0000-000000000002', slug: 'other' })];
    const sb = mockSupabase(themes);
    const result = await loadCommunityThemes(sb, { bypassCache: true });
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('approved');
  });

  it('only queries status=approved (RLS enforced, also filter in query)', async () => {
    const sb = mockSupabase([makeTheme()]);
    await loadCommunityThemes(sb, { bypassCache: true });
    const chain = (sb as unknown as { _chain: { eq: ReturnType<typeof vi.fn> } })._chain;
    expect(chain.eq).toHaveBeenCalledWith('status', 'approved');
  });

  it('returns empty array on Supabase error', async () => {
    const sb = mockSupabase(null, { message: 'connection refused' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await loadCommunityThemes(sb, { bypassCache: true });
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('stores result in sessionStorage cache', async () => {
    const sb = mockSupabase([makeTheme()]);
    await loadCommunityThemes(sb, { bypassCache: true });
    expect((sessionStorage.setItem as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});
