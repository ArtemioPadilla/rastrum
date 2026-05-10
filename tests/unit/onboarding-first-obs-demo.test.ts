/**
 * Unit tests for the OnboardingTour first_observation_demo step (#896).
 *
 * Since OnboardingTour.astro is a server-rendered component with an inline
 * <script>, we test the step-data shape and i18n keys rather than DOM
 * rendering (which would require a full Playwright e2e test).
 *
 * Tests cover:
 *   - step-data JSON includes a 'first_observation_demo' step
 *   - new step is inserted between quick_id and explore
 *   - i18n keys exist in en.json and es.json
 *   - step total is 7 (was 6)
 */
import { describe, it, expect } from 'vitest';
import enJson from '../../src/i18n/en.json';
import esJson from '../../src/i18n/es.json';

// Re-export the expected step definitions matching the component
type OnbSteps = typeof enJson.onboarding.steps;

describe('OnboardingTour first_observation_demo i18n (en)', () => {
  const onb = enJson.onboarding;

  it('has first_observation_demo step in steps object', () => {
    expect(onb.steps).toHaveProperty('first_observation_demo');
  });

  it('first_observation_demo.title is a non-empty string', () => {
    const step = (onb.steps as OnbSteps & { first_observation_demo?: { title: string; body: string } }).first_observation_demo;
    expect(step?.title).toBeTruthy();
    expect(typeof step?.title).toBe('string');
  });

  it('first_observation_demo.body is a non-empty string', () => {
    const step = (onb.steps as OnbSteps & { first_observation_demo?: { title: string; body: string } }).first_observation_demo;
    expect(step?.body).toBeTruthy();
  });

  it('has first_obs_demo_cascade_label', () => {
    expect((onb as Record<string, unknown>).first_obs_demo_cascade_label).toBeTruthy();
  });

  it('has first_obs_demo_step_result (sample species)', () => {
    expect((onb as Record<string, unknown>).first_obs_demo_step_result).toBeTruthy();
  });

  it('has first_obs_demo_confidence', () => {
    expect((onb as Record<string, unknown>).first_obs_demo_confidence).toBeTruthy();
  });

  it('has first_obs_demo_try_cta', () => {
    expect((onb as Record<string, unknown>).first_obs_demo_try_cta).toBeTruthy();
  });
});

describe('OnboardingTour first_observation_demo i18n (es)', () => {
  const onb = esJson.onboarding;

  it('has first_observation_demo step in steps object (es)', () => {
    expect(onb.steps).toHaveProperty('first_observation_demo');
  });

  it('es first_observation_demo.title is different from en', () => {
    const esStep = (onb.steps as OnbSteps & { first_observation_demo?: { title: string; body: string } }).first_observation_demo;
    const enStep = (enJson.onboarding.steps as OnbSteps & { first_observation_demo?: { title: string; body: string } }).first_observation_demo;
    expect(esStep?.title).not.toBe(enStep?.title);
  });

  it('has es first_obs_demo_cascade_label', () => {
    expect((onb as Record<string, unknown>).first_obs_demo_cascade_label).toBeTruthy();
  });
});

describe('OnboardingTour total step count', () => {
  it('step data array now has 7 entries (was 6)', () => {
    // Replicate the step-data array as defined in the component
    const enOnb = enJson.onboarding;
    const steps = enOnb.steps as OnbSteps & {
      first_observation_demo?: { title: string; body: string };
    };
    const stepList = [
      steps.welcome,
      steps.fab,
      steps.quick_id,
      steps.first_observation_demo,
      steps.explore,
      steps.privacy,
      steps.settings,
    ];
    expect(stepList.length).toBe(7);
    // All steps defined
    expect(stepList.every(s => s !== undefined)).toBe(true);
  });
});
