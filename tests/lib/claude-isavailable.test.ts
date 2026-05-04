import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const mockSession = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: () => mockSession() },
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock('../../src/lib/byo-keys', () => ({
  getKey: vi.fn(() => null),
}));

import { claudeIdentifier } from '../../src/lib/identifiers/claude';
import { getKey } from '../../src/lib/byo-keys';

const getKeyMock = getKey as ReturnType<typeof vi.fn>;

describe('claudeIdentifier.isAvailable (#595)', () => {
  beforeEach(() => {
    store.clear();
    getKeyMock.mockReset().mockReturnValue(null);
    mockSession.mockReset();
    mockRpc.mockReset();
  });

  it('ready when BYO key is set (skips RPC entirely)', async () => {
    getKeyMock.mockReturnValueOnce('sk-ant-test');
    const result = await claudeIdentifier.isAvailable();
    expect(result).toEqual({ ready: true });
    expect(mockSession).not.toHaveBeenCalled();
  });

  it('not ready when no key + no session', async () => {
    mockSession.mockResolvedValueOnce({ data: { session: null } });
    const result = await claudeIdentifier.isAvailable();
    expect(result.ready).toBe(false);
    expect((result as { reason: string }).reason).toBe('needs_key');
  });

  it('not ready when no key + session but RPC returns false', async () => {
    mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    const result = await claudeIdentifier.isAvailable();
    expect(result.ready).toBe(false);
  });

  it('ready when no key but RPC reports active sponsorship', async () => {
    mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    const result = await claudeIdentifier.isAvailable();
    expect(result).toEqual({ ready: true });
  });

  it('hits cache on second call within TTL window', async () => {
    mockSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    await claudeIdentifier.isAvailable();
    const result2 = await claudeIdentifier.isAvailable();
    expect(result2).toEqual({ ready: true });
    expect(mockSession).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
