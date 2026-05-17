import { describe, it, expect } from 'vitest';
import { attemptsToCardVmInput } from './observe-card-vm-input';
import type { IdentifyAttempt } from './identify-cascade-client';

const ctx = { observerAffirmed: false, reviewRequested: false, online: true, hasOnDeviceModel: true, now: '2026-05-17T00:00:00Z' };

describe('attemptsToCardVmInput', () => {
  it('picks best on-device as provisional and best cloud as cloud', () => {
    const attempts: IdentifyAttempt[] = [
      { source: 'onnx_efficientnet_lite0', scientific_name: 'Quercus sp.', confidence: 0.31 },
      { source: 'plantnet', scientific_name: 'Quercus rugosa', confidence: 0.94 },
      { source: 'claude_haiku', scientific_name: 'Quercus sp.', confidence: 0.6 },
    ];
    const vm = attemptsToCardVmInput(attempts, ctx);
    expect(vm.provisional).toEqual({ scientificName: 'Quercus sp.', confidence: 0.31, source: 'onnx_efficientnet_lite0', confidenceCeiling: 0.4 });
    expect(vm.cloud).toEqual({ scientificName: 'Quercus rugosa', confidence: 0.94, source: 'plantnet', confidenceCeiling: 1 });
    expect(vm.observerAffirmed).toBe(false);
    expect(vm.online).toBe(true);
    expect(vm.hasOnDeviceModel).toBe(true);
  });

  it('maps every attempt into the trace with correct where + isPrimary on the cloud winner', () => {
    const attempts: IdentifyAttempt[] = [
      { source: 'onnx_efficientnet_lite0', scientific_name: 'Quercus sp.', confidence: 0.31 },
      { source: 'plantnet', scientific_name: 'Quercus rugosa', confidence: 0.94 },
    ];
    const vm = attemptsToCardVmInput(attempts, ctx);
    expect(vm.attempts).toEqual([
      { source: 'onnx_efficientnet_lite0', where: 'device', scientificName: 'Quercus sp.', confidence: 0.31, isPrimary: false, createdAt: '2026-05-17T00:00:00Z' },
      { source: 'plantnet', where: 'cloud', scientificName: 'Quercus rugosa', confidence: 0.94, isPrimary: true, createdAt: '2026-05-17T00:00:00Z' },
    ]);
  });

  it('errored attempts: scientificName null, never provisional/cloud, never primary', () => {
    const attempts: IdentifyAttempt[] = [
      { source: 'plantnet', scientific_name: null, confidence: 0, error: 'quota' },
      { source: 'onnx_efficientnet_lite0', scientific_name: 'Quercus sp.', confidence: 0.3 },
    ];
    const vm = attemptsToCardVmInput(attempts, ctx);
    expect(vm.cloud).toBeNull();
    expect(vm.provisional?.source).toBe('onnx_efficientnet_lite0');
    const pn = vm.attempts.find(a => a.source === 'plantnet');
    expect(pn).toEqual({ source: 'plantnet', where: 'cloud', scientificName: null, confidence: 0, isPrimary: false, createdAt: '2026-05-17T00:00:00Z' });
  });

  it('no usable attempts → provisional and cloud null, trace still maps', () => {
    const vm = attemptsToCardVmInput([{ source: 'plantnet', scientific_name: null, confidence: 0, error: 'x' }], ctx);
    expect(vm.provisional).toBeNull();
    expect(vm.cloud).toBeNull();
    expect(vm.attempts).toHaveLength(1);
  });

  it('carries reviewRequested from ctx into the vm input', () => {
    const vm = attemptsToCardVmInput([], { ...ctx, reviewRequested: true });
    expect(vm.reviewRequested).toBe(true);
  });

  it('phi/gemma/megadetector/speciesnet ceilings are correct; provisional is highest-confidence device', () => {
    const attempts: IdentifyAttempt[] = [
      { source: 'webllm_phi35_vision', scientific_name: 'A', confidence: 0.2 },
      { source: 'speciesnet', scientific_name: 'B', confidence: 0.8 },
    ];
    const vm = attemptsToCardVmInput(attempts, ctx);
    expect(vm.provisional).toEqual({ scientificName: 'B', confidence: 0.8, source: 'speciesnet', confidenceCeiling: 0.85 });
  });
});
