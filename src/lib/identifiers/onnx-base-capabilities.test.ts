import { describe, it, expect, vi } from 'vitest';

vi.mock('./onnx-base-cache', () => ({
  getOnnxBaseCacheStatus: vi.fn(async () => ({ modelCached: false, labelsCached: false })),
  getCachedModelBuffer: vi.fn(async () => null),
  getCachedLabels: vi.fn(async () => null),
  getOnnxBaseWeightsBaseUrl: vi.fn(() => null),
}));

import { onnxBaseIdentifier } from './onnx-base';

describe('onnxBaseIdentifier capabilities (#582)', () => {
  it('confidence_ceiling capped at 0.4 so EfficientNet never crosses ACCEPT_THRESHOLD', () => {
    expect(onnxBaseIdentifier.capabilities.confidence_ceiling).toBe(0.4);
  });

  it('keeps free license + zero cost (no behavioral regression)', () => {
    expect(onnxBaseIdentifier.capabilities.license).toBe('free');
    expect(onnxBaseIdentifier.capabilities.cost_per_id_usd).toBe(0);
  });
});
