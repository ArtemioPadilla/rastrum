import { describe, expect, it, vi, beforeEach } from 'vitest';
import { detectKind } from '../../src/lib/sponsorships';

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'fake-token' } } }) },
  }),
}));

interface FetchCall { url: string; method: string; body: string | null }
const FETCH_CALLS: FetchCall[] = [];
const FETCH_URLS: string[] = [];
beforeEach(() => {
  FETCH_URLS.length = 0;
  FETCH_CALLS.length = 0;
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    FETCH_URLS.push(u);
    const method = (init?.method ?? (init?.headers as Record<string, string> | undefined)?.['X-HTTP-Method-Override'] ?? 'GET');
    const body = typeof init?.body === 'string' ? init.body : null;
    FETCH_CALLS.push({ url: u, method, body });
    return new Response(JSON.stringify({ items: [], page: 0, page_size: 50, total: 0, has_more: false }), { status: 200 });
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

// ── #468: pool management ─────────────────────────────────────────
describe('pool management client', () => {
  const POOL = '11111111-2222-3333-4444-555555555555';

  it('updatePool issues PATCH with cap+model+daily payload', async () => {
    const { updatePool } = await import('../../src/lib/sponsorships');
    await updatePool(POOL, { total_cap: 500, preferred_model: 'claude-haiku-4-5', daily_user_cap: 20 });
    const call = FETCH_CALLS.at(-1);
    expect(call?.url).toMatch(new RegExp(`/sponsorships/pools/${POOL}$`));
    expect(call?.method).toBe('PATCH');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      total_cap: 500, preferred_model: 'claude-haiku-4-5', daily_user_cap: 20,
    });
  });

  it('updatePool surfaces server cap_below_used error', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'cap_below_used', detail: 'Cannot shrink total_cap to 50: pool has already used 200 calls.', used: 200 }),
      { status: 400 },
    )) as unknown as typeof fetch;
    const { updatePool } = await import('../../src/lib/sponsorships');
    await expect(updatePool(POOL, { total_cap: 50 })).rejects.toThrow(/cap_below_used/);
  });

  it('deletePool issues DELETE via X-HTTP-Method-Override', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      FETCH_CALLS.push({
        url:    typeof url === 'string' ? url : url.toString(),
        method: headers['X-HTTP-Method-Override'] ?? init?.method ?? 'GET',
        body:   typeof init?.body === 'string' ? init.body : null,
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { deletePool } = await import('../../src/lib/sponsorships');
    await deletePool(POOL);
    const call = FETCH_CALLS.at(-1);
    expect(call?.url).toMatch(new RegExp(`/sponsorships/pools/${POOL}$`));
    expect(call?.method).toBe('DELETE');
  });

  it('listPoolBeneficiaries hits /pools/:id/beneficiaries with page param', async () => {
    const { listPoolBeneficiaries } = await import('../../src/lib/sponsorships');
    const result = await listPoolBeneficiaries(POOL, 2);
    expect(FETCH_URLS.at(-1)).toMatch(new RegExp(`/sponsorships/pools/${POOL}/beneficiaries\\?page=2$`));
    expect(result).toEqual({ items: [], page: 0, page_size: 50, total: 0, has_more: false });
  });

  it('listPoolBeneficiaries defaults to page=0', async () => {
    const { listPoolBeneficiaries } = await import('../../src/lib/sponsorships');
    await listPoolBeneficiaries(POOL);
    expect(FETCH_URLS.at(-1)).toMatch(/\?page=0$/);
  });
});
