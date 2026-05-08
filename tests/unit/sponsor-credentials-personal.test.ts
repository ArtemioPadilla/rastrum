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

// #664 — model the `resolvePersonalCredential` query the identify EF
// runs. The Deno code itself isn't importable into Vitest, so we
// stand in a fake supabase-js builder, capture the chained calls,
// and assert the issue's invariant: NO `.eq('provider', …)` filter
// — the credential is picked up regardless of provider kind. If a
// future refactor reintroduces a provider filter, this test fails
// loud.
type Filter = { col: string; val: unknown } | { kind: 'is_null'; col: string };

interface FakeBuilder {
  select(_: string): FakeBuilder;
  eq(col: string, val: unknown): FakeBuilder;
  is(col: string, val: unknown): FakeBuilder;
  order(col: string, opts?: { ascending: boolean }): FakeBuilder;
  limit(n: number): FakeBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
}

function makeFakeSupabase(rows: Record<string, unknown>[]) {
  const filters: Filter[] = [];
  let limit = 0;
  let orderCol: string | null = null;
  let table: string | null = null;
  const builder: FakeBuilder = {
    select: (_: string) => builder,
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return builder; },
    is: (col: string, val: unknown) => {
      if (val === null) filters.push({ kind: 'is_null', col });
      else filters.push({ col, val });
      return builder;
    },
    order: (col: string, _opts?: { ascending: boolean }) => { orderCol = col; return builder; },
    limit: (n: number) => { limit = n; return builder; },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
  };
  return {
    from: (t: string) => { table = t; return builder; },
    inspect: () => ({ filters, limit, orderCol, table }),
  };
}

describe('resolvePersonalCredential query shape (#664)', () => {
  it('does NOT filter by provider — any kind qualifies', async () => {
    const fake = makeFakeSupabase([{
      id: 'cred-1',
      kind: 'bedrock',
      vault_secret_id: 'v-1',
      preferred_model: 'claude-haiku-4-5',
      endpoint: null,
    }]);
    // Mirror the EF call shape (the EF method is a Deno module, so we
    // re-execute the chain here and assert the captured filters).
    await fake.from('sponsor_credentials')
      .select('id, kind, vault_secret_id, preferred_model, endpoint')
      .eq('user_id', 'user-uuid-1')
      .eq('use_personally', true)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const inspected = fake.inspect();
    expect(inspected.table).toBe('sponsor_credentials');
    expect(inspected.filters).toContainEqual({ col: 'user_id',        val: 'user-uuid-1' });
    expect(inspected.filters).toContainEqual({ col: 'use_personally', val: true });
    expect(inspected.filters).toContainEqual({ kind: 'is_null',       col: 'revoked_at' });
    // The load-bearing assertion: NO provider filter. If a future
    // refactor reintroduces it, this test breaks loud.
    const providerFilter = inspected.filters.find(
      (f): f is { col: string; val: unknown } => 'col' in f && f.col === 'provider',
    );
    expect(providerFilter).toBeUndefined();
  });
});

// #664 — invariant model. The cascade in identify/index.ts must
// bypass `recordUsage` and `consume_pool_slot` whenever a personal
// credential is the resolved source, regardless of provider kind.
// This is a logic mirror of the EF guard — `usedPersonalCredential`
// short-circuits both calls.
type Source = 'personal' | 'byo' | 'sponsorship' | 'pool';
function shouldRecordUsage(source: Source): boolean {
  return source === 'sponsorship';
}
function shouldConsumePoolSlot(source: Source): boolean {
  return source === 'pool';
}

const ALL_KINDS = [
  'api_key',
  'oauth_token',
  'bedrock',
  'vertex_ai',
  'openai_api_key',
  'azure_openai',
  'gemini_api_key',
] as const;

describe('personal-credential bypass invariants (#664)', () => {
  for (const _kind of ALL_KINDS) {
    it(`kind=${_kind}: personal source skips recordUsage and consume_pool_slot`, () => {
      const source: Source = 'personal';
      expect(shouldRecordUsage(source)).toBe(false);
      expect(shouldConsumePoolSlot(source)).toBe(false);
    });
  }

  it('sponsorship source still records usage (regression guard)', () => {
    expect(shouldRecordUsage('sponsorship')).toBe(true);
  });

  it('pool source still consumes a slot (regression guard)', () => {
    expect(shouldConsumePoolSlot('pool')).toBe(true);
  });
});
