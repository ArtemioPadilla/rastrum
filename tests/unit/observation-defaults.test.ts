import { describe, it, expect, beforeEach, vi } from 'vitest';

// State shared across the mocked supabase client so tests can inspect
// reads and writes the lib makes.
type Store = Record<string, unknown>;
let store: Store;
let updateCalls: { table: string; patch: Record<string, unknown>; id: string }[];
let mockedUser: { id: string } | null;

vi.mock('../../src/lib/supabase', () => ({
  getCachedUser: () => Promise.resolve(mockedUser),
  getCachedSession: () => Promise.resolve(mockedUser ? { user: mockedUser } : null),
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          single: () => Promise.resolve({ data: { last_observation_defaults: { ...store } }, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, val: string) => {
          updateCalls.push({ table, patch, id: val });
          const next = patch.last_observation_defaults as Record<string, unknown>;
          store = { ...next };
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  }),
}));

import { getObservationDefaults, setObservationDefaults } from '../../src/lib/observation-defaults';

beforeEach(() => {
  store = {};
  updateCalls = [];
  mockedUser = { id: 'user-123' };
});

describe('getObservationDefaults', () => {
  it('returns empty object when no authenticated user', async () => {
    mockedUser = null;
    const out = await getObservationDefaults();
    expect(out).toEqual({});
  });

  it('returns empty object when stored value is empty', async () => {
    store = {};
    const out = await getObservationDefaults();
    expect(out).toEqual({ habitat: undefined, weather: undefined, licenseCode: undefined });
  });

  it('extracts only string-typed fields (defends against malformed jsonb)', async () => {
    store = {
      habitat: 'forest_pine',
      weather: 'sunny',
      licenseCode: 'CC0',
      // intentional junk
      unrelated: 42,
      observation_count: { not: 'a string' },
    };
    const out = await getObservationDefaults();
    expect(out.habitat).toBe('forest_pine');
    expect(out.weather).toBe('sunny');
    expect(out.licenseCode).toBe('CC0');
  });
});

describe('setObservationDefaults', () => {
  it('early-exits without DB hit when every field is undefined', async () => {
    await setObservationDefaults({});
    expect(updateCalls).toHaveLength(0);
  });

  it('persists a single field without dropping previously stored ones', async () => {
    store = { habitat: 'forest_pine', weather: 'sunny' };
    await setObservationDefaults({ licenseCode: 'CC BY 4.0' });
    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0]!.patch.last_observation_defaults as Record<string, string>;
    expect(written.habitat).toBe('forest_pine');
    expect(written.weather).toBe('sunny');
    expect(written.licenseCode).toBe('CC BY 4.0');
  });

  it('overrides an existing field on second save', async () => {
    store = { habitat: 'forest_pine' };
    await setObservationDefaults({ habitat: 'urban' });
    const written = updateCalls[0]!.patch.last_observation_defaults as Record<string, string>;
    expect(written.habitat).toBe('urban');
  });

  it('deletes a key when partial value is empty string', async () => {
    store = { habitat: 'forest_pine', weather: 'sunny' };
    await setObservationDefaults({ habitat: '' });
    const written = updateCalls[0]!.patch.last_observation_defaults as Record<string, string>;
    expect(written.habitat).toBeUndefined();
    expect(written.weather).toBe('sunny');
  });

  it('skips DB hit when no user is signed in', async () => {
    mockedUser = null;
    await setObservationDefaults({ habitat: 'urban' });
    expect(updateCalls).toHaveLength(0);
  });
});
