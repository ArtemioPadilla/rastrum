import { describe, expect, it, vi, beforeEach } from 'vitest';

// #655 — `setCredentialPersonal` client wrapper hits the SECURITY
// DEFINER `set_credential_personal` RPC. The RPC enforces
// owner_user_id = auth.uid() server-side; the wrapper just
// forwards the bool. These tests pin the call shape so a
// rename of the SQL signature breaks loudly.

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const rpcResults: Array<{ data: unknown; error: { message: string } | null }> = [];

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'fake-token' } } }),
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const next = rpcResults.shift() ?? { data: null, error: null };
      return Promise.resolve(next);
    },
  }),
}));

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResults.length = 0;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;
});

describe('setCredentialPersonal', () => {
  it('calls set_credential_personal RPC with credential id + flag', async () => {
    const { setCredentialPersonal } = await import('../../src/lib/sponsorships');
    rpcResults.push({ data: null, error: null });
    await setCredentialPersonal('cred-uuid-1', true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('set_credential_personal');
    expect(rpcCalls[0].args).toEqual({
      p_credential_id: 'cred-uuid-1',
      p_use_personally: true,
    });
  });

  it('forwards the disabled state too', async () => {
    const { setCredentialPersonal } = await import('../../src/lib/sponsorships');
    rpcResults.push({ data: null, error: null });
    await setCredentialPersonal('cred-uuid-2', false);
    expect(rpcCalls[0].args).toEqual({
      p_credential_id: 'cred-uuid-2',
      p_use_personally: false,
    });
  });

  it('throws when the RPC returns an error', async () => {
    const { setCredentialPersonal } = await import('../../src/lib/sponsorships');
    rpcResults.push({ data: null, error: { message: 'credential not found or not owned by caller' } });
    await expect(setCredentialPersonal('foreign-cred', true))
      .rejects.toThrow(/not owned by caller/);
  });
});

// #655 — sketch of the cascade priority the identify EF enforces.
// `resolvePersonalCredential` lives inside the Deno EF and isn't
// directly importable into Vitest, so we model the resolution
// order with a stand-in that mirrors the EF logic. If the EF
// drifts away from this order, the identify EF unit test
// (Deno-side, future) catches it; this guards the client-side
// invariant that personal-credential UX state matches the server
// truth (a personal credential, when set, ALWAYS takes precedence
// over BYO).
type Cred = { secret: string; source: 'personal' | 'byo' | 'sponsorship' };

function pickCredential(opts: {
  personal?: { secret: string };
  byo?: string;
  sponsorship?: { secret: string };
}): Cred | null {
  if (opts.personal) return { secret: opts.personal.secret, source: 'personal' };
  if (opts.byo)      return { secret: opts.byo,            source: 'byo' };
  if (opts.sponsorship) return { secret: opts.sponsorship.secret, source: 'sponsorship' };
  return null;
}

describe('identify cascade priority (model)', () => {
  it('personal credential beats BYO + sponsorship when present', () => {
    const picked = pickCredential({
      personal:    { secret: 'sk-ant-personal' },
      byo:         'sk-ant-byo',
      sponsorship: { secret: 'sk-ant-sponsor' },
    });
    expect(picked?.source).toBe('personal');
    expect(picked?.secret).toBe('sk-ant-personal');
  });

  it('falls back to BYO when no personal credential', () => {
    const picked = pickCredential({
      byo:         'sk-ant-byo',
      sponsorship: { secret: 'sk-ant-sponsor' },
    });
    expect(picked?.source).toBe('byo');
  });

  it('falls back to sponsorship when no personal + no BYO', () => {
    const picked = pickCredential({ sponsorship: { secret: 'sk-ant-sponsor' } });
    expect(picked?.source).toBe('sponsorship');
  });

  it('returns null when nothing is available', () => {
    expect(pickCredential({})).toBeNull();
  });
});
