import { describe, it, expect } from 'vitest';
import {
  classifyOutlier,
  formatDistanceKm,
  DEFAULT_OUTLIER_THRESHOLD_KM,
} from '../../src/lib/outlier-alert';

describe('classifyOutlier', () => {
  it('returns no_signal for null', () => {
    expect(classifyOutlier(null)).toEqual({ kind: 'no_signal' });
  });

  it('returns no_signal for undefined', () => {
    expect(classifyOutlier(undefined)).toEqual({ kind: 'no_signal' });
  });

  it('returns no_signal for NaN', () => {
    expect(classifyOutlier(Number.NaN)).toEqual({ kind: 'no_signal' });
  });

  it('returns no_signal for Infinity (defensive — RPC should never return it)', () => {
    expect(classifyOutlier(Number.POSITIVE_INFINITY)).toEqual({ kind: 'no_signal' });
  });

  it('treats 0 km as in_range', () => {
    expect(classifyOutlier(0)).toEqual({ kind: 'in_range', distanceKm: 0 });
  });

  it('treats exact threshold as in_range (not outlier)', () => {
    const out = classifyOutlier(DEFAULT_OUTLIER_THRESHOLD_KM);
    expect(out.kind).toBe('in_range');
  });

  it('treats threshold + epsilon as outlier', () => {
    const out = classifyOutlier(DEFAULT_OUTLIER_THRESHOLD_KM + 0.01);
    expect(out.kind).toBe('outlier');
  });

  it('treats far distance as outlier', () => {
    expect(classifyOutlier(3500)).toEqual({ kind: 'outlier', distanceKm: 3500 });
  });

  it('respects a custom threshold', () => {
    expect(classifyOutlier(80, 100).kind).toBe('in_range');
    expect(classifyOutlier(120, 100).kind).toBe('outlier');
  });

  it('default threshold is 50 km', () => {
    expect(DEFAULT_OUTLIER_THRESHOLD_KM).toBe(50);
  });
});

describe('formatDistanceKm', () => {
  it('rounds < 100 km to nearest km', () => {
    expect(formatDistanceKm(49.4)).toBe('49');
    expect(formatDistanceKm(49.6)).toBe('50');
    expect(formatDistanceKm(99.9)).toBe('100');
  });

  it('rounds ≥ 100 km to nearest 10 km (avoid false precision)', () => {
    expect(formatDistanceKm(100)).toBe('100');
    expect(formatDistanceKm(104)).toBe('100');
    expect(formatDistanceKm(105)).toBe('110');
    expect(formatDistanceKm(3419.27)).toBe('3420');
  });

  it('floors at 0 for non-finite or negative', () => {
    expect(formatDistanceKm(Number.NaN)).toBe('0');
    expect(formatDistanceKm(-5)).toBe('0');
    expect(formatDistanceKm(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('handles 0 km', () => {
    expect(formatDistanceKm(0)).toBe('0');
  });
});
