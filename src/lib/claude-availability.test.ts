import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./anthropic-key', () => ({ hasAnthropicKey: vi.fn() }));
vi.mock('./sponsorships', () => ({ getClaudeEligibility: vi.fn() }));

import { hasAnthropicKey } from './anthropic-key';
import { getClaudeEligibility } from './sponsorships';
import { claudeAvailable } from './claude-availability';

const mockedHasKey = vi.mocked(hasAnthropicKey);
const mockedElig   = vi.mocked(getClaudeEligibility);

describe('claudeAvailable', () => {
  beforeEach(() => {
    mockedHasKey.mockReset();
    mockedElig.mockReset();
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
  });
  afterEach(() => vi.clearAllMocks());

  it('returns true when BYO key is set', async () => {
    mockedHasKey.mockResolvedValue(true);
    expect(await claudeAvailable()).toBe(true);
  });

  it('returns true when an active sponsorship exists', async () => {
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: true, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
    expect(await claudeAvailable()).toBe(true);
  });

  it('returns true when a platform pool has capacity and caller has headroom', async () => {
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: true, pool_used_today: 3, pool_cap_today: 10 });
    expect(await claudeAvailable()).toBe(true);
  });

  it('returns false when caller has hit the daily pool cap', async () => {
    // Reviewer feedback (PR #652 ⚠️ #1): the RPC's has_pool is global; the client must
    // gate on used_today < cap_today to avoid showing ✅ in the banner when the EF
    // would actually return a cap-exhausted error.
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: true, pool_used_today: 10, pool_cap_today: 10 });
    expect(await claudeAvailable()).toBe(false);
  });

  it('returns false when has_pool is true but cap_today is 0', async () => {
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: true, pool_used_today: 0, pool_cap_today: 0 });
    expect(await claudeAvailable()).toBe(false);
  });

  it('returns false when nothing is set', async () => {
    mockedHasKey.mockResolvedValue(false);
    expect(await claudeAvailable()).toBe(false);
  });

  it('treats RPC errors as no eligibility (not a hard fail)', async () => {
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockRejectedValue(new Error('not_authenticated'));
    expect(await claudeAvailable()).toBe(false);
  });

  it('handles unauthenticated callers — RPC returns all-false defaults', async () => {
    // Reviewer feedback (PR #652 ⚠️ #2): explicit test for the auth.uid() IS NULL path.
    // The SQL function returns {false, false, 0, 0}; we mirror that contract here.
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
    expect(await claudeAvailable()).toBe(false);
  });

  it('falls back gracefully when BYO check throws', async () => {
    mockedHasKey.mockRejectedValue(new Error('localstorage off'));
    mockedElig.mockResolvedValue({ has_sponsor: true, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
    expect(await claudeAvailable()).toBe(true);
  });
});
