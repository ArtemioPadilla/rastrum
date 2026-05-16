import { describe, it, expect } from 'vitest';
import { buildCardViewModel, type CardVmInput } from './observe-card-vm';
import type { IdAttempt } from './observe-audit-trace';

const base: CardVmInput = {
  provisional: null,
  cloud: null,
  observerAffirmed: false,
  online: true,
  hasOnDeviceModel: true,
  attempts: [],
};

describe('buildCardViewModel', () => {
  it('S0 with no headline/sourceLabel when nothing resolved', () => {
    const vm = buildCardViewModel(base);
    expect(vm.state).toBe('S0');
    expect(vm.sovereignty).toBe('none');
    expect(vm.headline).toBeNull();
    expect(vm.sourceLabel).toBeNull();
    expect(vm.trace).toEqual([]);
  });

  it('S1a with cloud headline + source label when an authoritative cloud result exists', () => {
    const vm = buildCardViewModel({
      ...base,
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
    });
    expect(vm.state).toBe('S1a');
    expect(vm.sovereignty).toBe('upgrade-primary');
    expect(vm.headline).toBe('Quercus rugosa');
    expect(vm.sourceLabel).toBe('plantnet · 94%');
  });

  it('S1b headline/source come from the provisional when there is no cloud', () => {
    const vm = buildCardViewModel({
      ...base,
      provisional: { scientificName: 'Quercus sp.', confidence: 0.31, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 },
    });
    expect(vm.state).toBe('S1b');
    expect(vm.sovereignty).toBe('none');
    expect(vm.headline).toBe('Quercus sp.');
    expect(vm.sourceLabel).toBe('onnx_efficientnet_lite0 · 31%');
  });

  it('S2prime keeps the observer headline; sovereignty is parallel-suggestion', () => {
    const vm = buildCardViewModel({
      ...base,
      provisional: { scientificName: 'Quercus crassifolia', confidence: 1, source: 'human', confidenceCeiling: 1 },
      cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 },
      observerAffirmed: true,
    });
    expect(vm.state).toBe('S2prime');
    expect(vm.sovereignty).toBe('parallel-suggestion');
    expect(vm.headline).toBe('Quercus crassifolia');
  });

  it('passes the audit trace through, oldest-first', () => {
    const attempts: IdAttempt[] = [
      { source: 'plantnet', where: 'cloud', scientificName: 'Quercus rugosa', confidence: 0.94, isPrimary: true, createdAt: '2026-05-16T10:02:09Z' },
      { source: 'onnx_efficientnet_lite0', where: 'device', scientificName: 'Quercus sp.', confidence: 0.31, isPrimary: false, createdAt: '2026-05-16T10:02:02Z' },
    ];
    const vm = buildCardViewModel({ ...base, cloud: { scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 }, attempts });
    expect(vm.trace.map(e => e.source)).toEqual(['onnx_efficientnet_lite0', 'plantnet']);
  });

  it('sourceLabel rounds confidence to whole percent', () => {
    const vm = buildCardViewModel({
      ...base,
      cloud: { scientificName: 'X', confidence: 0.666, source: 'claude_haiku', confidenceCeiling: 1 },
    });
    expect(vm.sourceLabel).toBe('claude_haiku · 67%');
  });
});
