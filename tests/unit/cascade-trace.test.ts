import { describe, it, expect } from 'vitest';
import { serializeClientCascade } from '../../src/lib/cascade-trace';

const baseResult = {
  scientific_name: 'Panthera onca',
  common_name_en: 'Jaguar',
  common_name_es: 'Jaguar',
  family: 'Felidae',
  kingdom: 'Animalia',
  confidence: 0.89,
  source: 'claude_haiku',
  raw: { rationale: 'Spotted coat, large head' },
};

describe('serializeClientCascade (#586)', () => {
  it('serializes cascade attempts with id/ok/confidence', () => {
    const trace = serializeClientCascade({
      best: baseResult,
      attempts: [
        { id: 'plantnet', ok: false, confidence: 0.1, error: 'no match' },
        { id: 'claude_haiku', ok: true, confidence: 0.89, result: baseResult },
      ],
    });
    expect(trace.cascade_attempts).toHaveLength(2);
    expect(trace.cascade_attempts[0]).toMatchObject({ id: 'plantnet', ok: false });
    expect(trace.cascade_attempts[1]).toMatchObject({ id: 'claude_haiku', ok: true, confidence: 0.89 });
  });

  it('marks client_persisted: true', () => {
    const t = serializeClientCascade({ best: null, attempts: [] });
    expect(t.client_persisted).toBe(true);
    expect(t.winner).toBeNull();
  });

  it('strips PII keys (lat/lng/gps/location) from raw_provider_response', () => {
    const trace = serializeClientCascade({
      best: { ...baseResult, raw: { lat: 19.4, lng: -99.1, location: 'Mexico City', confidence: 0.89 } },
      attempts: [],
    });
    const raw = trace.winner?.raw_provider_response as Record<string, unknown>;
    expect(raw).not.toHaveProperty('lat');
    expect(raw).not.toHaveProperty('lng');
    expect(raw).not.toHaveProperty('location');
    expect(raw.confidence).toBe(0.89);
  });

  it('truncates long strings to ~200 chars', () => {
    const longStr = 'x'.repeat(500);
    const trace = serializeClientCascade({
      best: { ...baseResult, raw: { description: longStr } },
      attempts: [],
    });
    const raw = trace.winner?.raw_provider_response as Record<string, unknown>;
    expect((raw.description as string).length).toBeLessThanOrEqual(200);
  });

  it('caps top-k arrays at 5 entries', () => {
    const trace = serializeClientCascade({
      best: { ...baseResult, raw: { results: Array.from({ length: 20 }, (_, i) => ({ rank: i })) } },
      attempts: [],
    });
    const raw = trace.winner?.raw_provider_response as Record<string, unknown>;
    expect((raw.results as unknown[]).length).toBe(5);
  });

  it('keeps trace under 4 KB even with verbose raw response', () => {
    const huge = 'x'.repeat(50_000);
    const trace = serializeClientCascade({
      best: { ...baseResult, raw: { dump: huge } },
      attempts: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, ok: true, confidence: 0.5 })),
    });
    expect(JSON.stringify(trace).length).toBeLessThan(4_096);
  });
});
