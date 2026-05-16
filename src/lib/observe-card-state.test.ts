import { describe, it, expect } from 'vitest';
import { resolveCardState, type CardStateInput } from './observe-card-state';
import { ACCEPT_THRESHOLD } from './identifiers/cascade';

const base: CardStateInput = {
  provisional: null, cloud: null, observerAffirmed: false,
  online: true, hasOnDeviceModel: true,
};

describe('resolveCardState', () => {
  it('S0 when nothing has resolved yet', () => {
    expect(resolveCardState(base)).toBe('S0');
  });
  it('S1a when a non-capped result clears ACCEPT_THRESHOLD', () => {
    expect(resolveCardState({ ...base, cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 } })).toBe('S1a');
  });
  it('S1b when a capped-source result cannot be authoritative even at high confidence', () => {
    expect(resolveCardState({ ...base, provisional: { scientificName: 'Quercus sp.', confidence: 0.4, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 } })).toBe('S1b');
  });
  it('S1b when a non-capped result is below ACCEPT_THRESHOLD', () => {
    expect(resolveCardState({ ...base, cloud: { scientificName: 'Quercus sp.', confidence: 0.55, source: 'claude_haiku', confidenceCeiling: 1 } })).toBe('S1b');
  });
  it('S2 when cloud upgrades and the observer did not act', () => {
    expect(resolveCardState({ ...base, provisional: { scientificName: 'Quercus sp.', confidence: 0.3, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 }, cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 }, observerAffirmed: false })).toBe('S2');
  });
  it('stays S1a when an already-authoritative provisional is followed by a cloud result (no un-collapse)', () => {
    expect(resolveCardState({ ...base, provisional: { scientificName: 'Puma concolor', confidence: 0.88, source: 'speciesnet', confidenceCeiling: 0.85 }, cloud: { scientificName: 'Puma concolor', confidence: 0.91, source: 'claude_haiku', confidenceCeiling: 1 }, observerAffirmed: false })).toBe('S1a');
  });
  it('S2prime when cloud arrives but the observer already affirmed', () => {
    expect(resolveCardState({ ...base, provisional: { scientificName: 'Quercus crassifolia', confidence: 1, source: 'human', confidenceCeiling: 1 }, cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 }, observerAffirmed: true })).toBe('S2prime');
  });
  it('S3 worst case: no on-device model and offline, nothing resolved', () => {
    expect(resolveCardState({ ...base, online: false, hasOnDeviceModel: false })).toBe('S3');
  });
  it('LOCAL ACCEPT_THRESHOLD constant matches the canonical cascade value', () => {
    expect(ACCEPT_THRESHOLD).toBe(0.7);
  });
});
