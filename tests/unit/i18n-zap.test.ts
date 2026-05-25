/**
 * Zapotec (zap) partial-locale overlay tests.
 *
 * Pins the proof-of-concept contract introduced for the indigenous-language
 * promise on the landing: the OnboardingTour can render in zap, and any key
 * that zap.json doesn't cover falls back to es.json.
 *
 * Scope intentionally narrow — only the onboarding.* keys are guaranteed,
 * everything else is fallback territory.
 */
import { describe, it, expect } from 'vitest';
import zap from '../../src/i18n/zap.json';
import es from '../../src/i18n/es.json';
import {
  getLocalizedString,
  getPartialLocaleMeta,
  partialLocaleCodes,
} from '../../src/i18n/utils';

describe('zap.json — file shape and metadata', () => {
  it('is registered as a partial-locale code', () => {
    expect(partialLocaleCodes).toContain('zap');
  });

  it('declares fallback_locale=es', () => {
    const meta = getPartialLocaleMeta('zap');
    expect(meta).not.toBeNull();
    expect(meta?.fallback_locale).toBe('es');
  });

  it('declares iso_639_3=zap', () => {
    const meta = getPartialLocaleMeta('zap');
    expect(meta?.iso_639_3).toBe('zap');
  });

  it('carries an honest review_status (not "approved")', () => {
    const meta = getPartialLocaleMeta('zap');
    expect(meta?.review_status).toMatch(/draft|review|preview/i);
  });

  it('publishes a native-language name', () => {
    const meta = getPartialLocaleMeta('zap');
    expect(meta?.name_native).toBeTruthy();
  });
});

describe('zap.json — onboarding tour key coverage', () => {
  const requiredKeys = [
    'onboarding.skip',
    'onboarding.next',
    'onboarding.done',
    'onboarding.back',
    'onboarding.start',
    'onboarding.step_label',
    'onboarding.step_dot_aria',
    'onboarding.close_label',
    'onboarding.replay_tour_label',
    'onboarding.replay_tour_button',
    'onboarding.steps.welcome.title',
    'onboarding.steps.welcome.body',
    'onboarding.steps.fab.title',
    'onboarding.steps.fab.body',
    'onboarding.steps.quick_id.title',
    'onboarding.steps.quick_id.body',
    'onboarding.steps.explore.title',
    'onboarding.steps.explore.body',
    'onboarding.steps.settings.title',
    'onboarding.steps.settings.body',
    'onboarding.steps.privacy.title',
    'onboarding.steps.privacy.body',
    'onboarding.steps.first_observation_demo.title',
    'onboarding.steps.first_observation_demo.body',
  ];

  for (const key of requiredKeys) {
    it(`has a non-empty zap value at ${key}`, () => {
      const value = getLocalizedString(key, 'zap');
      expect(value).toBeTruthy();
      expect(value).not.toBe(key); // would mean lookup failed entirely
    });
  }

  it('all 7 step titles are present in zap.steps', () => {
    expect(zap.onboarding.steps.welcome.title).toBeTruthy();
    expect(zap.onboarding.steps.fab.title).toBeTruthy();
    expect(zap.onboarding.steps.quick_id.title).toBeTruthy();
    expect(zap.onboarding.steps.explore.title).toBeTruthy();
    expect(zap.onboarding.steps.settings.title).toBeTruthy();
    expect(zap.onboarding.steps.privacy.title).toBeTruthy();
    expect(zap.onboarding.steps.first_observation_demo.title).toBeTruthy();
  });
});

describe('getLocalizedString — overlay + fallback semantics', () => {
  it('returns the zap value when the key is in zap.json', () => {
    expect(getLocalizedString('onboarding.steps.welcome.title', 'zap'))
      .toBe('Padiuxh Rastrum');
  });

  it('returns the zap value for short labels', () => {
    expect(getLocalizedString('onboarding.start', 'zap')).toBe('Sieṉ ríatsoo');
    expect(getLocalizedString('onboarding.next', 'zap')).toBe('Pieṉ');
    expect(getLocalizedString('onboarding.back', 'zap')).toBe('Pwen');
    expect(getLocalizedString('onboarding.skip', 'zap')).toBe('Bzaa');
    expect(getLocalizedString('onboarding.done', 'zap')).toBe('Naa nakaa');
  });

  it('falls back to es.json for keys absent from zap.json', () => {
    // 'onboarding.install_title' is in en/es but NOT in the zap overlay.
    const fromEs = es.onboarding.install_title;
    expect(fromEs).toBeTruthy();
    expect(getLocalizedString('onboarding.install_title', 'zap')).toBe(fromEs);
  });

  it('falls back to es.json for keys in entirely different namespaces', () => {
    // header.* (or similar wide-coverage namespace) is never in the overlay.
    const result = getLocalizedString('pipeline.section_title', 'zap');
    // Should match the es.json value, never the dotted path itself.
    expect(result).not.toBe('pipeline.section_title');
    expect(result).toBe(es.pipeline.section_title);
  });

  it('returns the path back when the key is missing from all locales (safe fail)', () => {
    expect(getLocalizedString('this.key.does.not.exist', 'zap'))
      .toBe('this.key.does.not.exist');
  });

  it('works for the built-in en locale (no overlay path)', () => {
    expect(getLocalizedString('onboarding.steps.welcome.title', 'en'))
      .toBe('Welcome to Rastrum');
  });

  it('works for the built-in es locale (no overlay path)', () => {
    expect(getLocalizedString('onboarding.steps.welcome.title', 'es'))
      .toBe('Bienvenido a Rastrum');
  });
});

describe('zap.json — honest review tracking', () => {
  it('has a _review block flagging items that need native-speaker check', () => {
    expect(zap._review).toBeTruthy();
    expect(Array.isArray(zap._review.needs_native_speaker_check)).toBe(true);
    expect(zap._review.needs_native_speaker_check.length).toBeGreaterThan(0);
  });
});
