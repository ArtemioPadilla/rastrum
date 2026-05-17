import { describe, it, expect } from 'vitest';
import { capConfidence, ceilingForSource, CONFIDENCE_CEILING } from './confidence-ceiling';

describe('#1128 R2 — confidence ceiling', () => {
  it('caps on-device sources below the research-grade floor', () => {
    expect(capConfidence('onnx_efficientnet_lite0', 0.9)).toBe(0.4);
    expect(capConfidence('phi_vision', 0.95)).toBe(0.35);
    expect(capConfidence('camera_trap_megadetector', 1)).toBe(0.4);
  });

  it('leaves cloud / human / unknown sources uncapped', () => {
    expect(capConfidence('plantnet', 0.92)).toBe(0.92);
    expect(capConfidence('claude_sonnet', 0.99)).toBe(0.99);
    expect(capConfidence('human', 1)).toBe(1);
    expect(capConfidence(null, 0.8)).toBe(0.8);
  });

  it('clamps negative confidence to 0', () => {
    expect(capConfidence('onnx_efficientnet_lite0', -1)).toBe(0);
  });

  it('ceilingForSource resolves known + unknown sources', () => {
    expect(ceilingForSource('phi_vision')).toBe(0.35);
    expect(ceilingForSource(undefined)).toBe(1);
  });

  it('every on-device key ceiling is ≤ the 0.4 research-grade promotion', () => {
    for (const key of [
      'onnx_efficientnet_lite0',
      'camera_trap_megadetector',
      'phi_vision',
      'webllm_phi35_vision',
      'onnx_gemma4_vision',
    ]) {
      expect(CONFIDENCE_CEILING[key]).toBeLessThanOrEqual(0.4);
    }
  });
});
