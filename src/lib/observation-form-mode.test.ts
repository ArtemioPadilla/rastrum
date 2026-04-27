import { describe, it, expect } from 'vitest';
import {
  pickModeLabels,
  submitIntent,
  shouldAutoStartGPS,
  IDENTIFY_ONLY_HIDDEN_BLOCKS,
} from './observation-form-mode';

describe('pickModeLabels', () => {
  it('returns "Just identify" for identify-only mode (EN)', () => {
    const l = pickModeLabels('identify-only', false);
    expect(l.submit).toBe('Just identify');
    expect(l.saveAsObservation).toBe('Save as observation');
    expect(l.backToIdentify).toBe('Back to identify only');
  });

  it('returns "Solo identificar" for identify-only mode (ES)', () => {
    const l = pickModeLabels('identify-only', true);
    expect(l.submit).toBe('Solo identificar');
    expect(l.saveAsObservation).toBe('Guardar como observación');
  });

  it('returns "Save observation" for full mode', () => {
    const l = pickModeLabels('full', false);
    expect(l.submit).toBe('Save observation');
  });

  it('honours overrides', () => {
    const l = pickModeLabels('identify-only', false, { submit: 'Identify' });
    expect(l.submit).toBe('Identify');
  });
});

describe('submitIntent', () => {
  it('full mode → save', () => {
    expect(submitIntent('full')).toBe('save');
  });
  it('identify-only mode → noop', () => {
    expect(submitIntent('identify-only')).toBe('noop');
  });
});

describe('shouldAutoStartGPS', () => {
  it('full mode → true', () => {
    expect(shouldAutoStartGPS('full')).toBe(true);
  });
  it('identify-only mode → false', () => {
    expect(shouldAutoStartGPS('identify-only')).toBe(false);
  });
});

describe('IDENTIFY_ONLY_HIDDEN_BLOCKS', () => {
  it('lists all five blocks the spec hides', () => {
    expect(IDENTIFY_ONLY_HIDDEN_BLOCKS).toContain('gps');
    expect(IDENTIFY_ONLY_HIDDEN_BLOCKS).toContain('habitat_weather');
    expect(IDENTIFY_ONLY_HIDDEN_BLOCKS).toContain('evidence_type');
    expect(IDENTIFY_ONLY_HIDDEN_BLOCKS).toContain('notes');
  });
});
