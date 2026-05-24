import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock supabase BEFORE importing sponsorships so getCachedSession + getSupabase
// resolve through the mocked module. This mirrors the observation-defaults
// test pattern from #1155.
const mockedSession = { current: null as { user: { id: string } } | null };
const rpcSpy = vi.fn();

vi.mock('./supabase', () => ({
  getCachedSession: () => Promise.resolve(mockedSession.current),
  getSupabase: () => ({ rpc: rpcSpy }),
}));

import { detectAnyKind, detectKind, getClaudeEligibility } from './sponsorships';

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

// Regression for #1167 — RPC was firing before the JWT was hydrated (or for
// anon callers entirely), spamming the console with 401s from PostgREST.
describe('getClaudeEligibility (session gate)', () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    mockedSession.current = null;
  });

  it('returns defaults without calling rpc when session is null (anon / cold load)', async () => {
    const out = await getClaudeEligibility();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(out).toEqual({ has_sponsor: false, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
  });

  it('calls rpc when a session is present', async () => {
    mockedSession.current = { user: { id: 'user-1' } };
    rpcSpy.mockResolvedValue({
      data: [{ has_sponsor: true, has_pool: false, pool_used_today: 0, pool_cap_today: 0 }],
      error: null,
    });
    const out = await getClaudeEligibility();
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith('claude_eligibility');
    expect(out.has_sponsor).toBe(true);
  });

  it('propagates rpc errors as Error (auth present but server failed)', async () => {
    mockedSession.current = { user: { id: 'user-1' } };
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getClaudeEligibility()).rejects.toThrow('boom');
  });

  it('returns defaults when rpc returns an empty array', async () => {
    mockedSession.current = { user: { id: 'user-1' } };
    rpcSpy.mockResolvedValue({ data: [], error: null });
    const out = await getClaudeEligibility();
    expect(out).toEqual({ has_sponsor: false, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
  });
});
