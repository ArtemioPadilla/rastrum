/**
 * Unit tests for renderDigest — the pure weekly-digest email renderer.
 * Issue #868: Weekly email digest for inactive users.
 *
 * No Deno/Supabase deps: runs in Node/Vitest.
 */

import { describe, it, expect } from 'vitest';
import { renderDigest } from '../../supabase/functions/_shared/render-digest';
import type { DigestData } from '../../supabase/functions/_shared/render-digest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseUser = {
  id: 'user-1',
  display_name: 'Alice',
  email: 'alice@example.com',
  preferred_language: 'en' as const,
  country_code: 'MX',
};

const baseData: DigestData = {
  user: baseUser,
  follower_obs: [
    {
      scientific_name: 'Quercus robur',
      observer_name: 'Bob',
      observed_at: '2024-05-01T10:00:00Z',
      share_url: 'https://rastrum.org/obs/abc123',
    },
  ],
  missing_species: [
    { scientific_name: 'Parus major', common_name: 'Great Tit' },
  ],
  community_stats: { total_obs_week: 420, new_species_week: 18 },
  rank_delta: 3,
};

const esData: DigestData = {
  ...baseData,
  user: { ...baseUser, preferred_language: 'es' as const },
};

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

describe('renderDigest — subject', () => {
  it('returns English subject for en language', () => {
    const { subject } = renderDigest(baseData);
    expect(subject).toBe('Your Rastrum weekly summary');
  });

  it('returns Spanish subject for es language', () => {
    const { subject } = renderDigest(esData);
    expect(subject).toBe('Tu resumen semanal de Rastrum');
  });
});

// ---------------------------------------------------------------------------
// Follower observations included in output
// ---------------------------------------------------------------------------

describe('renderDigest — follower observations', () => {
  it('includes species name in HTML output', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('Quercus robur');
  });

  it('includes species name in text output', () => {
    const { text } = renderDigest(baseData);
    expect(text).toContain('Quercus robur');
  });

  it('includes observer name in HTML', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('Bob');
  });

  it('includes share_url link in HTML', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('https://rastrum.org/obs/abc123');
  });
});

// ---------------------------------------------------------------------------
// Empty follower_obs — graceful handling
// ---------------------------------------------------------------------------

describe('renderDigest — empty follower_obs', () => {
  const emptyData: DigestData = { ...baseData, follower_obs: [] };

  it('does not throw when follower_obs is empty', () => {
    expect(() => renderDigest(emptyData)).not.toThrow();
  });

  it('returns a non-empty subject', () => {
    const { subject } = renderDigest(emptyData);
    expect(subject.length).toBeGreaterThan(0);
  });

  it('returns non-empty HTML', () => {
    const { html } = renderDigest(emptyData);
    expect(html.length).toBeGreaterThan(0);
  });

  it('shows empty-state message in HTML (EN)', () => {
    const { html } = renderDigest(emptyData);
    expect(html).toContain('No recent observations from people you follow');
  });

  it('shows empty-state message in HTML (ES)', () => {
    const emptyEs: DigestData = { ...emptyData, user: { ...baseUser, preferred_language: 'es' } };
    const { html } = renderDigest(emptyEs);
    expect(html).toContain('No hay observaciones recientes');
  });
});

// ---------------------------------------------------------------------------
// Unsubscribe link
// ---------------------------------------------------------------------------

describe('renderDigest — unsubscribe link', () => {
  it('includes PLACEHOLDER token in HTML unsubscribe link (EN)', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('https://rastrum.org/en/unsubscribe?token=PLACEHOLDER');
  });

  it('includes PLACEHOLDER token in text unsubscribe link (EN)', () => {
    const { text } = renderDigest(baseData);
    expect(text).toContain('https://rastrum.org/en/unsubscribe?token=PLACEHOLDER');
  });

  it('uses /es/ path for Spanish users', () => {
    const { html } = renderDigest(esData);
    expect(html).toContain('https://rastrum.org/es/unsubscribe?token=PLACEHOLDER');
  });
});

// ---------------------------------------------------------------------------
// Community stats
// ---------------------------------------------------------------------------

describe('renderDigest — community stats', () => {
  it('includes total_obs_week in HTML', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('420');
  });

  it('includes new_species_week in HTML', () => {
    const { html } = renderDigest(baseData);
    expect(html).toContain('18');
  });
});

// ---------------------------------------------------------------------------
// Rank delta
// ---------------------------------------------------------------------------

describe('renderDigest — rank delta', () => {
  it('mentions positive rank delta in HTML', () => {
    const { html } = renderDigest(baseData); // rank_delta: 3
    expect(html).toContain('3');
  });

  it('does not error when rank_delta is null', () => {
    const noRank: DigestData = { ...baseData, rank_delta: null };
    expect(() => renderDigest(noRank)).not.toThrow();
  });

  it('does not error when rank_delta is 0', () => {
    const zeroRank: DigestData = { ...baseData, rank_delta: 0 };
    expect(() => renderDigest(zeroRank)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Display name fallback
// ---------------------------------------------------------------------------

describe('renderDigest — display_name fallback', () => {
  it('uses fallback "naturalist" when display_name is null (EN)', () => {
    const noName: DigestData = { ...baseData, user: { ...baseUser, display_name: null } };
    const { html } = renderDigest(noName);
    expect(html).toContain('naturalist');
  });

  it('uses fallback "naturalista" when display_name is null (ES)', () => {
    const noName: DigestData = { ...esData, user: { ...baseUser, preferred_language: 'es', display_name: null } };
    const { html } = renderDigest(noName);
    expect(html).toContain('naturalista');
  });
});
