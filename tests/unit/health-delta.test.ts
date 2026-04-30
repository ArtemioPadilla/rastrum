/**
 * Unit tests for the metric-delta + trend-coloring helpers used by
 * /console/health/. The math is stupid simple but the lower/higher-is-better
 * mapping is load-bearing — getting it backwards would paint a worsening
 * ban queue green and an improving one red.
 */

import { describe, it, expect } from 'vitest';
import { computeMetricDelta, trendArrow, trendColorClass } from '../../src/lib/health-delta';

describe('computeMetricDelta', () => {
  it('returns flat for unchanged metric', () => {
    const d = computeMetricDelta(50, 50, 'admin_actions');
    expect(d.absolute).toBe(0);
    expect(d.percent).toBe(0);
    expect(d.trend).toBe('flat');
  });

  it('reports lower-is-better metric going DOWN as good', () => {
    const d = computeMetricDelta(3, 8, 'reports_open');
    expect(d.absolute).toBe(-5);
    expect(d.trend).toBe('down_good');
  });

  it('reports lower-is-better metric going UP as bad', () => {
    const d = computeMetricDelta(12, 4, 'anomalies_unack');
    expect(d.absolute).toBe(8);
    expect(d.trend).toBe('up_bad');
  });

  it('reports higher-is-better metric going UP as good', () => {
    const d = computeMetricDelta(7, 3, 'bans_lifted');
    expect(d.absolute).toBe(4);
    expect(d.trend).toBe('up_good');
  });

  it('reports higher-is-better metric going DOWN as bad', () => {
    const d = computeMetricDelta(1, 5, 'bans_lifted');
    expect(d.absolute).toBe(-4);
    expect(d.trend).toBe('down_bad');
  });

  it('treats neutral metrics as flat regardless of direction', () => {
    expect(computeMetricDelta(100, 50, 'admin_actions').trend).toBe('flat');
    expect(computeMetricDelta(50, 100, 'admin_actions').trend).toBe('flat');
  });

  it('handles divide-by-zero — previous=0, current>0 → 100%', () => {
    const d = computeMetricDelta(5, 0, 'reports_open');
    expect(d.absolute).toBe(5);
    expect(d.percent).toBe(100);
    expect(d.trend).toBe('up_bad');
  });

  it('handles divide-by-zero — both zero → 0%', () => {
    const d = computeMetricDelta(0, 0, 'reports_open');
    expect(d.absolute).toBe(0);
    expect(d.percent).toBe(0);
    expect(d.trend).toBe('flat');
  });

  it('rounds percent to whole number', () => {
    const d = computeMetricDelta(11, 7, 'reports_open');
    expect(d.percent).toBe(57);
  });

  it('flags function_errors_7d as lower-is-better', () => {
    expect(computeMetricDelta(20, 5, 'function_errors_7d').trend).toBe('up_bad');
    expect(computeMetricDelta(2, 10, 'function_errors_7d').trend).toBe('down_good');
  });
});

describe('trendArrow', () => {
  it('returns up arrow for any up trend', () => {
    expect(trendArrow('up_good')).toBe('▲');
    expect(trendArrow('up_bad')).toBe('▲');
  });
  it('returns down arrow for any down trend', () => {
    expect(trendArrow('down_good')).toBe('▼');
    expect(trendArrow('down_bad')).toBe('▼');
  });
  it('returns dash for flat', () => {
    expect(trendArrow('flat')).toBe('—');
  });
});

describe('trendColorClass', () => {
  it('returns emerald variants for any "good" trend', () => {
    expect(trendColorClass('up_good')).toContain('emerald');
    expect(trendColorClass('down_good')).toContain('emerald');
  });
  it('returns red variants for any "bad" trend', () => {
    expect(trendColorClass('up_bad')).toContain('red');
    expect(trendColorClass('down_bad')).toContain('red');
  });
  it('returns zinc for flat', () => {
    expect(trendColorClass('flat')).toContain('zinc');
  });
});
