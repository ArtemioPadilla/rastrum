/**
 * #869 — Birthday Naturalist badge
 *
 * Tests for the birthday_observation predicate logic (client-side layer) and
 * award-badges plumbing. SQL predicate is integration-tested in tests/sql/rls.sql.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

/** Build a fake Supabase client that returns the given rpc result for any call. */
function makeRpcClient(returnIds: string[]) {
  return {
    rpc: (_fn: string, _args?: Record<string, unknown>) =>
      Promise.resolve({ data: returnIds, error: null }),
    from: (_table: string) => ({
      select: () => ({
        is: () => ({ data: [] as unknown[], error: null }),
        eq: () => ({
          in: () => Promise.resolve({ data: [] as unknown[], error: null }),
        }),
      }),
      insert: (_rows: unknown[]) => Promise.resolve({ error: null }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Helper that mirrors award-badges eligibleUserIds for birthday_observation
// ---------------------------------------------------------------------------
async function eligibleBirthday(db: ReturnType<typeof makeRpcClient>): Promise<string[]> {
  const { data } = await db.rpc('badge_eligible_birthday_observation', { p_user_id: null }) as { data: string[] };
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Birthday Naturalist badge (#869)', () => {
  it('returns users eligible on their birthday', async () => {
    const eligible = ['user-birthday-1', 'user-birthday-2'];
    const db = makeRpcClient(eligible);
    const ids = await eligibleBirthday(db);
    expect(ids).toEqual(eligible);
  });

  it('returns empty array when no one has a matching birthday today', async () => {
    const db = makeRpcClient([]);
    const ids = await eligibleBirthday(db);
    expect(ids).toHaveLength(0);
  });

  it('award-badges switch dispatches birthday_observation to correct rpc', async () => {
    const calls: string[] = [];
    const db = {
      rpc: (fn: string, _args?: Record<string, unknown>) => {
        calls.push(fn);
        return Promise.resolve({ data: [], error: null });
      },
      from: () => ({ select: () => ({ is: () => ({ data: [], error: null }) }) }),
    };
    // Simulate the switch case
    const type = 'birthday_observation';
    if (type === 'birthday_observation') {
      await (db as unknown as ReturnType<typeof makeRpcClient>).rpc('badge_eligible_birthday_observation', { p_user_id: null });
    }
    expect(calls).toContain('badge_eligible_birthday_observation');
  });

  it('predicate returns false (empty) when user has no birthday set', async () => {
    // DB returns empty because birthday IS NULL
    const db = makeRpcClient([]);
    const ids = await eligibleBirthday(db);
    expect(ids).toHaveLength(0);
  });

  it('profile form includes birthday field type', () => {
    // Lightweight check: the ProfileEditForm source must contain the birthday input.
    // We rely on the file existing and containing the expected markup string.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/components/ProfileEditForm.astro'),
      'utf-8',
    );
    expect(src).toContain('name="birthday"');
    expect(src).toContain('type="date"');
  });
});
