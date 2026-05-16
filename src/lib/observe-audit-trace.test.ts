import { describe, it, expect } from 'vitest';
import { buildAuditTrace, type IdAttempt } from './observe-audit-trace';

const attempts: IdAttempt[] = [
  { source: 'plantnet', where: 'cloud', scientificName: 'Quercus rugosa', confidence: 0.94, isPrimary: true, createdAt: '2026-05-16T10:02:09Z' },
  { source: 'onnx_efficientnet_lite0', where: 'device', scientificName: 'Quercus sp.', confidence: 0.31, isPrimary: false, createdAt: '2026-05-16T10:02:02Z' },
  { source: 'camera_trap_megadetector', where: 'device', scientificName: null, confidence: 0.71, isPrimary: false, createdAt: '2026-05-16T10:02:01Z', filteredLabel: 'animal' },
];

describe('buildAuditTrace', () => {
  it('sorts by createdAt ascending', () => {
    expect(buildAuditTrace(attempts).map(e => e.source)).toEqual(['camera_trap_megadetector', 'onnx_efficientnet_lite0', 'plantnet']);
  });
  it('types the outcome per attempt', () => {
    const bySrc = Object.fromEntries(buildAuditTrace(attempts).map(e => [e.source, e.outcome]));
    expect(bySrc['plantnet']).toBe('primary');
    expect(bySrc['onnx_efficientnet_lite0']).toBe('non-primary');
    expect(bySrc['camera_trap_megadetector']).toBe('pre-filter');
  });
  it('flags capped-source rows so the UI can explain the research-grade floor', () => {
    const t = buildAuditTrace(attempts);
    expect(t.find(e => e.source === 'onnx_efficientnet_lite0')?.capped).toBe(true);
    expect(t.find(e => e.source === 'plantnet')?.capped).toBe(false);
  });
  it('returns [] for no attempts', () => {
    expect(buildAuditTrace([])).toEqual([]);
  });
});
