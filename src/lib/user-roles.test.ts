import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supabase client ──
// Intercept at the module boundary before the module-under-test loads so
// getSupabase() never tries to read import.meta.env.
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockFrom = vi.fn();
const mockOnAuthStateChange = vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
const mockSupabase = {
  from: mockFrom,
  auth: { onAuthStateChange: mockOnAuthStateChange },
};

vi.mock('./supabase', () => ({
  getSupabase: () => mockSupabase,
}));

// Import AFTER mock is registered.
import { getUserRoles } from './user-roles';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module-level cache and in-flight state between tests by
  // re-importing a fresh copy isn't easily possible with Vitest's ESM
  // cache; instead we drain the cache by advancing time past TTL via
  // Date.now mock or by calling with a unique userId each time.
  // We use unique userIds per assertion group to sidestep the TTL issue.

  // Wire up the default mock chain: from → select → eq → resolved value.
  mockEq.mockResolvedValue({ data: [], error: null });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockFrom.mockReturnValue({ select: mockSelect });
});

describe('getUserRoles', () => {
  it('returns empty set for null userId', async () => {
    const result = await getUserRoles(null);
    expect(result).toEqual(new Set());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns empty set for undefined userId', async () => {
    const result = await getUserRoles(undefined);
    expect(result).toEqual(new Set());
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('two concurrent calls for the same userId trigger only ONE fetch', async () => {
    mockEq.mockResolvedValue({
      data: [{ role: 'admin', revoked_at: null }],
      error: null,
    });

    const uid = 'user-dedupe-test';
    const [r1, r2] = await Promise.all([getUserRoles(uid), getUserRoles(uid)]);

    // Both results contain the role.
    expect(r1.has('admin')).toBe(true);
    expect(r2.has('admin')).toBe(true);

    // Only ONE network call should have been made.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('user_roles');
  });

  it('a cached result is returned for subsequent same-uid calls without fetching again', async () => {
    mockEq.mockResolvedValue({
      data: [{ role: 'moderator', revoked_at: null }],
      error: null,
    });

    const uid = 'user-cache-test';
    const r1 = await getUserRoles(uid);
    // Second call — should hit cache, no new fetch.
    const r2 = await getUserRoles(uid);

    expect(r1.has('moderator')).toBe(true);
    expect(r2.has('moderator')).toBe(true);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('a different userId bypasses the cache and fetches independently', async () => {
    mockEq
      .mockResolvedValueOnce({ data: [{ role: 'admin', revoked_at: null }], error: null })
      .mockResolvedValueOnce({ data: [{ role: 'expert', revoked_at: null }], error: null });

    const r1 = await getUserRoles('user-a-bypass');
    const r2 = await getUserRoles('user-b-bypass');

    expect(r1.has('admin')).toBe(true);
    expect(r2.has('expert')).toBe(true);

    // Two distinct fetches — one per userId.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('filters out revoked roles (revoked_at in the past)', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    mockEq.mockResolvedValue({
      data: [
        { role: 'admin', revoked_at: null },
        { role: 'moderator', revoked_at: pastDate },
      ],
      error: null,
    });

    const roles = await getUserRoles('user-revoke-test');
    expect(roles.has('admin')).toBe(true);
    expect(roles.has('moderator')).toBe(false);
  });

  it('returns empty set when the fetch errors', async () => {
    mockEq.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const roles = await getUserRoles('user-error-test');
    expect(roles).toEqual(new Set());
  });
});
