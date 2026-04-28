import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  detectPreset,
  DEFAULT_MATRIX,
  FACET_KEYS,
  normalizeMatrix,
  nuclearPrivateMatrix,
  PRESETS,
  type PrivacyMatrix,
} from './privacy-presets';

describe('privacy presets', () => {
  it('exposes all 19 facet keys', () => {
    expect(FACET_KEYS).toHaveLength(19);
    expect(new Set(FACET_KEYS).size).toBe(19);
  });

  it('applyPreset(open_scientist) makes everything public except watchlist + goals', () => {
    const m = applyPreset('open_scientist');
    expect(m.watchlist).toBe('private');
    expect(m.goals).toBe('private');
    expect(m.profile).toBe('public');
    expect(m.real_name).toBe('public');
    expect(m.location).toBe('public');
    expect(m.streak).toBe('public');
    expect(m.activity_feed).toBe('public');
    expect(m.karma_total).toBe('public');
    expect(m.expertise).toBe('public');
    expect(m.pokedex).toBe('public');

    for (const key of FACET_KEYS) {
      const v = m[key];
      if (key === 'watchlist' || key === 'goals') {
        expect(v).toBe('private');
      } else {
        expect(v).toBe('public');
      }
    }
  });

  it('applyPreset(researcher) matches the spec defaults', () => {
    const m = applyPreset('researcher');
    expect(m.profile).toBe('public');
    expect(m.bio).toBe('public');
    expect(m.stats_counts).toBe('public');
    expect(m.observation_map).toBe('public');
    expect(m.calendar_heatmap).toBe('public');
    expect(m.validation_rep).toBe('public');
    expect(m.obs_list).toBe('public');
    expect(m.karma_total).toBe('public');
    expect(m.expertise).toBe('public');
    expect(m.pokedex).toBe('public');

    expect(m.real_name).toBe('signed_in');
    expect(m.location).toBe('signed_in');
    expect(m.streak).toBe('signed_in');
    expect(m.activity_feed).toBe('signed_in');

    expect(m.watchlist).toBe('private');
    expect(m.goals).toBe('private');
  });

  it('applyPreset(private_observer) is signed_in profile with everything else private', () => {
    const m = applyPreset('private_observer');
    expect(m.profile).toBe('signed_in');
    for (const key of FACET_KEYS) {
      if (key === 'profile') continue;
      expect(m[key]).toBe('private');
    }
  });

  it('applyPreset returns a fresh object each call (no aliasing)', () => {
    const a = applyPreset('researcher');
    const b = applyPreset('researcher');
    expect(a).not.toBe(b);
    a.profile = 'private';
    expect(b.profile).toBe('public');
  });

  it('the Researcher preset matches DEFAULT_MATRIX (it IS the default)', () => {
    expect(applyPreset('researcher')).toEqual(DEFAULT_MATRIX);
  });
});

describe('detectPreset', () => {
  it('identifies an unmodified open_scientist matrix', () => {
    expect(detectPreset(applyPreset('open_scientist'))).toBe('open_scientist');
  });

  it('identifies an unmodified researcher matrix', () => {
    expect(detectPreset(applyPreset('researcher'))).toBe('researcher');
  });

  it('identifies an unmodified private_observer matrix', () => {
    expect(detectPreset(applyPreset('private_observer'))).toBe('private_observer');
  });

  it('returns "custom" when one row differs from a preset', () => {
    const m = applyPreset('researcher');
    m.bio = 'private';
    expect(detectPreset(m)).toBe('custom');
  });

  it('returns "custom" for a matrix that mixes preset shapes', () => {
    const a = applyPreset('open_scientist');
    a.profile = 'signed_in';
    expect(detectPreset(a)).toBe('custom');
  });

  it('detects each preset across all 3 inputs round-trip', () => {
    for (const preset of Object.keys(PRESETS) as Array<keyof typeof PRESETS>) {
      expect(detectPreset(applyPreset(preset))).toBe(preset);
    }
  });
});

describe('normalizeMatrix', () => {
  it('returns DEFAULT_MATRIX for null / undefined input', () => {
    expect(normalizeMatrix(null)).toEqual(DEFAULT_MATRIX);
    expect(normalizeMatrix(undefined)).toEqual(DEFAULT_MATRIX);
  });

  it('fills missing facet keys with DEFAULT_MATRIX values (forward-compat)', () => {
    const partial: Record<string, string> = { profile: 'private' };
    const norm = normalizeMatrix(partial);
    expect(norm.profile).toBe('private');
    expect(norm.bio).toBe(DEFAULT_MATRIX.bio);
    expect(norm.pokedex).toBe(DEFAULT_MATRIX.pokedex);
  });

  it('drops unknown keys without throwing', () => {
    const noisy: Record<string, string> = {
      profile: 'public',
      something_unknown: 'banana',
    };
    expect(() => normalizeMatrix(noisy)).not.toThrow();
    expect((normalizeMatrix(noisy) as unknown as Record<string, string>).something_unknown).toBeUndefined();
  });

  it('rejects a value with an invalid level', () => {
    const bad: Record<string, string> = { profile: 'invalid_level' };
    const norm = normalizeMatrix(bad);
    expect(norm.profile).toBe(DEFAULT_MATRIX.profile);
  });
});

describe('nuclearPrivateMatrix', () => {
  it('mirrors private_observer (profile signed_in, rest private)', () => {
    const m: PrivacyMatrix = nuclearPrivateMatrix();
    expect(m.profile).toBe('signed_in');
    for (const key of FACET_KEYS) {
      if (key === 'profile') continue;
      expect(m[key]).toBe('private');
    }
  });
});
