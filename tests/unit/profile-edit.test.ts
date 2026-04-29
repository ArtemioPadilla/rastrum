import { describe, it, expect } from 'vitest';
import {
  shouldShowInferredCountryBadge,
  buildCommunityDiscoveryPayload,
} from '../../src/lib/profile-edit';

describe('shouldShowInferredCountryBadge', () => {
  it('shows when country_code is set AND source is auto', () => {
    expect(shouldShowInferredCountryBadge({ country_code: 'MX', country_code_source: 'auto' })).toBe(true);
  });

  it('hides when source is user, regardless of country', () => {
    expect(shouldShowInferredCountryBadge({ country_code: 'MX', country_code_source: 'user' })).toBe(false);
  });

  it('hides when country_code is null even if source is auto', () => {
    expect(shouldShowInferredCountryBadge({ country_code: null, country_code_source: 'auto' })).toBe(false);
  });

  it('hides when country_code is undefined', () => {
    expect(shouldShowInferredCountryBadge({})).toBe(false);
  });

  it('hides when source is undefined (defaults are not user-set)', () => {
    expect(shouldShowInferredCountryBadge({ country_code: 'MX' })).toBe(false);
  });
});

describe('buildCommunityDiscoveryPayload', () => {
  it('always sets country_code_source to "user" on save (idempotent)', () => {
    const a = buildCommunityDiscoveryPayload({ country_code: 'MX', community_visible: true });
    expect(a.country_code_source).toBe('user');
    const b = buildCommunityDiscoveryPayload({ country_code: '', community_visible: false });
    expect(b.country_code_source).toBe('user');
  });

  it('inverts community_visible (UI-true) into hide_from_leaderboards (column-false)', () => {
    expect(buildCommunityDiscoveryPayload({ country_code: 'MX', community_visible: true }).hide_from_leaderboards).toBe(false);
    expect(buildCommunityDiscoveryPayload({ country_code: 'MX', community_visible: false }).hide_from_leaderboards).toBe(true);
  });

  it('coerces empty country_code to null (the "Don\'t declare" option)', () => {
    expect(buildCommunityDiscoveryPayload({ country_code: '', community_visible: true }).country_code).toBeNull();
  });

  it('preserves a non-empty country_code as-is', () => {
    expect(buildCommunityDiscoveryPayload({ country_code: 'AR', community_visible: true }).country_code).toBe('AR');
  });
});
