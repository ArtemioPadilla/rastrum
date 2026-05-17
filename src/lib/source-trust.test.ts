import { describe, it, expect } from 'vitest';
import { sourceTrustRank } from './source-trust';

describe('#1128 R3 — source trust rank', () => {
  it('ranks human primary first', () => {
    expect(sourceTrustRank('human')).toBe(0);
  });

  it('ranks cloud sources second', () => {
    expect(sourceTrustRank('plantnet')).toBe(1);
    expect(sourceTrustRank('claude_sonnet')).toBe(1);
  });

  it('ranks capped on-device sources third', () => {
    expect(sourceTrustRank('onnx_efficientnet_lite0')).toBe(2);
    expect(sourceTrustRank('phi_vision')).toBe(2);
  });

  it('ranks null / unknown last', () => {
    expect(sourceTrustRank(null)).toBe(3);
    expect(sourceTrustRank('something_unknown')).toBe(3);
  });

  it('orders cloud before capped on-device', () => {
    expect(sourceTrustRank('plantnet')).toBeLessThan(sourceTrustRank('phi_vision'));
  });
});
