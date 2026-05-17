import { describe, it, expect } from 'vitest';
import { resolveIdentificationSource } from './identification-source';

describe('resolveIdentificationSource', () => {
  it('returns the machine source when a machine result exists', () => {
    expect(resolveIdentificationSource({ machineSource: 'plantnet', hasMachineResult: true })).toBe('plantnet');
  });
  it('trims surrounding whitespace on the machine source', () => {
    expect(resolveIdentificationSource({ machineSource: '  claude_haiku  ', hasMachineResult: true })).toBe('claude_haiku');
  });
  it('THROWS when there is a machine result but no source (never coerces to human)', () => {
    expect(() => resolveIdentificationSource({ machineSource: '', hasMachineResult: true })).toThrow();
    expect(() => resolveIdentificationSource({ machineSource: '   ', hasMachineResult: true })).toThrow();
    expect(() => resolveIdentificationSource({ machineSource: null, hasMachineResult: true })).toThrow();
    expect(() => resolveIdentificationSource({ machineSource: undefined, hasMachineResult: true })).toThrow();
  });
  it("returns 'human' only when there is no machine result (observer manual entry)", () => {
    expect(resolveIdentificationSource({ machineSource: null, hasMachineResult: false })).toBe('human');
    expect(resolveIdentificationSource({ machineSource: undefined, hasMachineResult: false })).toBe('human');
    // even if a stray source is passed, no machine result ⇒ human
    expect(resolveIdentificationSource({ machineSource: 'plantnet', hasMachineResult: false })).toBe('human');
  });
});
