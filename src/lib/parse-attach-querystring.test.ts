import { describe, it, expect } from 'vitest';
import { parseAttachQuerystring } from './parse-attach-querystring';

describe('parseAttachQuerystring', () => {
  const KINDS = ['observation', 'species', 'project', 'camera_station', 'observer', 'self_profile'];

  it('returns null for empty input', () => {
    expect(parseAttachQuerystring(null)).toBeNull();
    expect(parseAttachQuerystring('')).toBeNull();
  });

  it('parses kind:id form', () => {
    expect(parseAttachQuerystring('observation:abc-123')).toEqual({
      kind: 'observation',
      id: 'abc-123',
    });
  });

  it('rejects unknown kind', () => {
    expect(parseAttachQuerystring('foo:bar')).toBeNull();
  });

  it('rejects malformed input (missing colon)', () => {
    expect(parseAttachQuerystring('observation')).toBeNull();
  });

  it('rejects empty id segment', () => {
    expect(parseAttachQuerystring('observation:')).toBeNull();
  });

  it('accepts every supported kind', () => {
    for (const k of KINDS) {
      expect(parseAttachQuerystring(`${k}:x`)?.kind).toBe(k);
    }
  });
});
