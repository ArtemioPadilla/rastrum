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

  it('returns true when a platform pool has capacity', async () => {
    mockedHasKey.mockResolvedValue(false);
    mockedElig.mockResolvedValue({ has_sponsor: false, has_pool: true, pool_used_today: 0, pool_cap_today: 10 });
    expect(await claudeAvailable()).toBe(true);
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

  it('falls back gracefully when BYO check throws', async () => {
    mockedHasKey.mockRejectedValue(new Error('localstorage off'));
    mockedElig.mockResolvedValue({ has_sponsor: true, has_pool: false, pool_used_today: 0, pool_cap_today: 0 });
    expect(await claudeAvailable()).toBe(true);
  });
});
