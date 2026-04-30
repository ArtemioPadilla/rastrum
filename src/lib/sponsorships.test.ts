import { describe, it, expect } from 'vitest';
import { detectAnyKind, detectKind } from './sponsorships';

describe('detectKind (legacy — Anthropic only)', () => {
  it('matches sk-ant-api03-*', () => {
    expect(detectKind('sk-ant-api03-abc')).toBe('api_key');
  });
  it('matches sk-ant-oat01-*', () => {
    expect(detectKind('sk-ant-oat01-abc')).toBe('oauth_token');
  });
  it('returns null for OpenAI / Gemini / Bedrock JSON', () => {
    expect(detectKind('sk-proj-abc')).toBeNull();
    expect(detectKind('AIzaXYZ')).toBeNull();
    expect(detectKind('{"accessKeyId":"x"}')).toBeNull();
  });
});

describe('detectAnyKind (M32 — multi-provider)', () => {
  it('prefers Anthropic prefixes over generic sk-', () => {
    expect(detectAnyKind('sk-ant-api03-abc')).toBe('api_key');
    expect(detectAnyKind('sk-ant-oat01-abc')).toBe('oauth_token');
  });
  it('falls through to OpenAI for plain sk-*', () => {
    expect(detectAnyKind('sk-proj-abc')).toBe('openai_api_key');
    expect(detectAnyKind('sk-svcacct-abc')).toBe('openai_api_key');
  });
  it('matches AIza* as Gemini', () => {
    expect(detectAnyKind('AIzaSyABC123')).toBe('gemini_api_key');
  });
  it('returns null for JSON envelopes (Bedrock / Vertex — no prefix)', () => {
    expect(detectAnyKind('{"accessKeyId":"x"}')).toBeNull();
    expect(detectAnyKind('{"type":"service_account"}')).toBeNull();
    expect(detectAnyKind('')).toBeNull();
  });
});
