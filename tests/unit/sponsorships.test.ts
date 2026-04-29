import { describe, expect, it, vi, beforeEach } from 'vitest';
import { detectKind } from '../../src/lib/sponsorships';

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'fake-token' } } }) },
  }),
}));

const FETCH_URLS: string[] = [];
beforeEach(() => {
  FETCH_URLS.length = 0;
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    FETCH_URLS.push(typeof url === 'string' ? url : url.toString());
    return new Response(JSON.stringify([]), { status: 200 });
  }) as unknown as typeof fetch;
});

describe('detectKind', () => {
  it('detects api_key prefix', () => {
    expect(detectKind('sk-ant-api03-xxx')).toBe('api_key');
  });
  it('detects oauth_token prefix', () => {
    expect(detectKind('sk-ant-oat01-xxx')).toBe('oauth_token');
  });
  it('returns null for unknown prefix', () => {
    expect(detectKind('not-a-key')).toBeNull();
  });
});

describe('sponsorships client', () => {
  it('listCredentials hits /credentials', async () => {
    const { listCredentials } = await import('../../src/lib/sponsorships');
    await listCredentials();
    expect(FETCH_URLS.at(-1)).toMatch(/\/sponsorships\/credentials$/);
  });

  it('listSponsorships passes role param', async () => {
    const { listSponsorships } = await import('../../src/lib/sponsorships');
    await listSponsorships('beneficiary');
    expect(FETCH_URLS.at(-1)).toMatch(/\/sponsorships\?role=beneficiary$/);
  });

  it('getUsage hits /sponsorships/:id/usage', async () => {
    const { getUsage } = await import('../../src/lib/sponsorships');
    await getUsage('00000000-0000-0000-0000-000000000000');
    expect(FETCH_URLS.at(-1)).toMatch(/\/sponsorships\/00000000-0000-0000-0000-000000000000\/usage$/);
  });
});
