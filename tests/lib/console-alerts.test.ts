import { describe, it, expect } from 'vitest';
import type { AlertItem } from '../../src/lib/console-alerts';
import { runAllChecks } from '../../src/lib/console-alerts';

describe('console-alerts', () => {
  it('returns empty array when all checks pass', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          gte: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
          in: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: [{ id: 1 }], error: null }) }) }),
          is: () => ({ gte: () => Promise.resolve({ count: 0, error: null }) }),
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };
    const alerts = await runAllChecks(mockSupabase as any);
    expect(alerts).toEqual([]);
  });
});
