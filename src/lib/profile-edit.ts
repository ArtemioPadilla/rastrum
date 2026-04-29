/**
 * Pure helpers for ProfileEditForm.astro — extracted so the
 * inversion + carry-forward invariants are unit-testable without
 * mounting the form in a browser.
 *
 * The form itself wires these into the load/save handlers; the
 * inverted-checkbox + country_code_source='user'-on-save invariants
 * are the load-bearing rules from PR4 of M28 (community discovery).
 */

/**
 * Whether the inferred-from-region badge should render. True only
 * when the cron auto-filled country_code AND it's still set.
 *
 * After the user saves Profile → Edit, country_code_source flips to
 * 'user' (regardless of whether the country actually changed), so
 * this returns false.
 */
export function shouldShowInferredCountryBadge(profile: {
  country_code?: string | null;
  country_code_source?: 'auto' | 'user';
}): boolean {
  return profile.country_code != null && profile.country_code_source === 'auto';
}

/**
 * Subset of the Profile → Edit payload that PR4 of M28 introduces
 * (country_code, country_code_source, hide_from_leaderboards).
 *
 * - `country_code` is nullable (empty string = "Don't declare").
 * - `country_code_source` is ALWAYS `'user'` on save — re-saving a
 *   `'user'` row stays `'user'`, so this is idempotent.
 * - `hide_from_leaderboards` is the *inverted* form of the
 *   `community_visible` UI checkbox (UI-true → column-false).
 */
export interface CommunityDiscoveryPayload {
  country_code: string | null;
  country_code_source: 'user';
  hide_from_leaderboards: boolean;
}

export function buildCommunityDiscoveryPayload(form: {
  country_code: string;
  community_visible: boolean;
}): CommunityDiscoveryPayload {
  return {
    country_code: form.country_code === '' ? null : form.country_code,
    country_code_source: 'user',
    hide_from_leaderboards: !form.community_visible,
  };
}
