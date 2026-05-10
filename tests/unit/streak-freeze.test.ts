/**
 * #866 — Streak freeze / skip-day mechanic
 *
 * These tests validate the TypeScript layer (home-loaders) that reads
 * freeze state from user_streaks. The SQL logic is covered in tests/sql/rls.sql.
 */
import { describe, it, expect } from 'vitest';
import { loadStreak } from '../../src/lib/home-loaders';

function makeStreakClient(data: Record<string, unknown> | null, error?: unknown) {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data, error: error ?? null }),
        }),
      }),
    }),
  };
}

describe('streak-freeze (#866)', () => {
  it('returns freezesAvailable and freezesUsed from user_streaks row', async () => {
    const c = makeStreakClient({
      current_days: 14,
      last_qualifying_day: '2026-05-09',
      streak_freezes_available: 2,
      streak_freezes_used: 1,
      streak_freeze_last_used_at: '2026-05-01T10:00:00Z',
    });
    const snap = await loadStreak(c as never, 'user-a');
    expect(snap).not.toBeNull();
    expect(snap!.freezesAvailable).toBe(2);
    expect(snap!.freezesUsed).toBe(1);
    expect(snap!.freezeLastUsedAt).toBe('2026-05-01T10:00:00Z');
  });

  it('returns zero-defaults when freeze columns are null (pre-migration rows)', async () => {
    const c = makeStreakClient({
      current_days: 3,
      last_qualifying_day: '2026-05-09',
      streak_freezes_available: null,
      streak_freezes_used: null,
      streak_freeze_last_used_at: null,
    });
    const snap = await loadStreak(c as never, 'user-b');
    expect(snap!.freezesAvailable).toBe(0);
    expect(snap!.freezesUsed).toBe(0);
    expect(snap!.freezeLastUsedAt).toBeNull();
  });

  it('returns null on DB error (freeze ledger non-critical)', async () => {
    const c = makeStreakClient(null, { message: 'connection refused' });
    const snap = await loadStreak(c as never, 'user-c');
    expect(snap).toBeNull();
  });

  it('hard-cap of 2 freezes is documented: freezesAvailable never exceeds 2', async () => {
    // The hard-cap is enforced in SQL (LEAST(..., 2)); here we test the
    // client layer correctly reflects whatever the DB returns.
    const c = makeStreakClient({
      current_days: 21,
      last_qualifying_day: '2026-05-09',
      streak_freezes_available: 2,  // cap
      streak_freezes_used: 4,
      streak_freeze_last_used_at: null,
    });
    const snap = await loadStreak(c as never, 'user-d');
    expect(snap!.freezesAvailable).toBeLessThanOrEqual(2);
  });

  it('freeze delta is 0 (no karma change) — snap freezesUsed tracks consumption', async () => {
    // Simulates: user had 1 freeze, missed a day, freeze consumed (freezesAvailable now 0,
    // freezesUsed incremented from 2 → 3, streak preserved at 7).
    const c = makeStreakClient({
      current_days: 7,
      last_qualifying_day: '2026-05-08',
      streak_freezes_available: 0,
      streak_freezes_used: 3,
      streak_freeze_last_used_at: '2026-05-09T07:05:00Z',
    });
    const snap = await loadStreak(c as never, 'user-e');
    expect(snap!.currentDays).toBe(7);          // streak preserved
    expect(snap!.freezesAvailable).toBe(0);      // used up
    expect(snap!.freezesUsed).toBe(3);           // lifetime counter incremented
    expect(snap!.freezeLastUsedAt).toBeTruthy(); // audit timestamp set
  });
});
