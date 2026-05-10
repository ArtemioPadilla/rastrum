/**
 * Unit tests for getCachedSession() and getCachedUser() in src/lib/supabase.ts
 *
 * Strategy: mock @supabase/supabase-js entirely, then import supabase.ts fresh
 * per describe block using vi.resetModules() so each block gets its own cache state.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock factory — called once per module instantiation
// ---------------------------------------------------------------------------
const mockGetSession = vi.fn().mockResolvedValue({
  data: { session: { access_token: 'tok-1', user: { id: 'u1' } } },
});
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'u1' } },
});
const mockOnAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

// ---------------------------------------------------------------------------
// getCachedSession — two calls, only one getSession() fired
// ---------------------------------------------------------------------------
describe('getCachedSession', () => {
  let getCachedSession: () => Promise<unknown>;

  beforeAll(async () => {
    vi.resetModules();
    mockGetSession.mockClear();
    const mod = await import('../../src/lib/supabase');
    getCachedSession = mod.getCachedSession;
  });

  it('returns session with access_token on first call', async () => {
    const session = await getCachedSession() as { access_token: string } | null;
    expect(session?.access_token).toBe('tok-1');
  });

  it('returns same session on second call without calling getSession again', async () => {
    const session = await getCachedSession() as { access_token: string } | null;
    expect(session?.access_token).toBe('tok-1');
    // getSession should have been called exactly once across both calls
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// getCachedUser — two calls, only one getUser() fired
// ---------------------------------------------------------------------------
describe('getCachedUser', () => {
  let getCachedUser: () => Promise<unknown>;

  beforeAll(async () => {
    vi.resetModules();
    mockGetUser.mockClear();
    const mod = await import('../../src/lib/supabase');
    getCachedUser = mod.getCachedUser;
  });

  it('returns user with id on first call', async () => {
    const user = await getCachedUser() as { id: string } | null;
    expect(user?.id).toBe('u1');
  });

  it('returns same user on second call without calling getUser again', async () => {
    const user = await getCachedUser() as { id: string } | null;
    expect(user?.id).toBe('u1');
    // getUser should have been called exactly once across both calls
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });
});
