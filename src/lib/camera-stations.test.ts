import { describe, it, expect } from 'vitest';
import { isValidStationKey } from './camera-stations';

describe('isValidStationKey', () => {
  it('accepts alphanumerics, hyphens, underscores within 1–64 chars', () => {
    expect(isValidStationKey('SJ-CAM-01')).toBe(true);
    expect(isValidStationKey('cam_01')).toBe(true);
    expect(isValidStationKey('A')).toBe(true);
    expect(isValidStationKey('a'.repeat(64))).toBe(true);
  });

  it('rejects empty, too-long, or special-char keys', () => {
    expect(isValidStationKey('')).toBe(false);
    expect(isValidStationKey('a'.repeat(65))).toBe(false);
    expect(isValidStationKey('has space')).toBe(false);
    expect(isValidStationKey('has/slash')).toBe(false);
    expect(isValidStationKey('emoji🦊')).toBe(false);
  });
});
