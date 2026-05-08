import { describe, it, expect, beforeEach, vi } from 'vitest';

// Map-backed localStorage shim for Node (vitest runs in Node, not browser)
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  },
  writable: true,
  configurable: true,
});

import { getPlantNetQuota, incrementPlantNetQuota } from '../../src/lib/plantnet-quota';

describe('plantnet-quota', () => {
  beforeEach(() => store.clear());

  it('returns 0 used_today and 500 daily_limit when no quota stored', () => {
    const q = getPlantNetQuota();
    expect(q).not.toBeNull();
    expect(q!.used_today).toBe(0);
    expect(q!.daily_limit).toBe(500);
  });

  it('increments used_today on each call to incrementPlantNetQuota', () => {
    incrementPlantNetQuota();
    incrementPlantNetQuota();
    incrementPlantNetQuota();
    const q = getPlantNetQuota();
    expect(q!.used_today).toBe(3);
  });

  it('resets counter when stored day differs from today', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    store.set('rastrum.plantnet.quota', JSON.stringify({ used: 400, day: yesterday }));
    const q = getPlantNetQuota();
    expect(q!.used_today).toBe(0);
  });

  it('returns null-safe result on corrupt storage', () => {
    store.set('rastrum.plantnet.quota', 'not-json{{{');
    const q = getPlantNetQuota();
    expect(q).not.toBeNull();
    expect(q!.used_today).toBe(0);
  });

  it('includes reset_at as an ISO string', () => {
    const q = getPlantNetQuota();
    expect(q!.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
