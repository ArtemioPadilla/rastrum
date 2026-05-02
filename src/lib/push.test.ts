import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock navigator.serviceWorker + PushManager ──
// happy-dom doesn't provide a full PushManager, so we wire up the
// minimum surface that push.ts touches.

const mockUnsubscribe = vi.fn().mockResolvedValue(true);
const mockSubscription = {
  endpoint: 'https://push.example.com/sub/abc',
  unsubscribe: mockUnsubscribe,
  toJSON: () => ({ keys: { p256dh: 'dGVzdA', auth: 'dGVzdA' } }),
  getKey: () => new ArrayBuffer(0),
};

const mockGetSubscription = vi.fn<() => Promise<PushSubscription | null>>();
const mockPushManager = { getSubscription: mockGetSubscription };
const mockRegistration = { pushManager: mockPushManager, showNotification: vi.fn() };

Object.defineProperty(navigator, 'serviceWorker', {
  configurable: true,
  value: { ready: Promise.resolve(mockRegistration) },
});

// PushManager must exist on window for pushSupported() to return true.
if (!('PushManager' in window)) {
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
}

// Notification must exist for pushSupported().
if (typeof globalThis.Notification === 'undefined') {
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { requestPermission: vi.fn().mockResolvedValue('granted') },
  });
}

// ── Mock supabase client ──
const mockDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } });
const mockSupabase = { from: mockFrom, auth: { getUser: mockGetUser } };

vi.mock('./supabase', () => ({
  getSupabase: () => mockSupabase,
}));

import { disableStreakPush, isStreakPushEnabled } from './push';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('disableStreakPush', () => {
  it('returns unsupported when push APIs are missing', async () => {
    // Temporarily remove PushManager to simulate unsupported browser.
    const origSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    // @ts-expect-error — deleting to simulate unsupported env
    delete (navigator as Record<string, unknown>).serviceWorker;

    const result = await disableStreakPush();
    expect(result).toEqual({ ok: false, reason: 'unsupported' });

    // Restore.
    if (origSW) Object.defineProperty(navigator, 'serviceWorker', origSW);
  });

  it('unsubscribes and deletes the push subscription from the DB', async () => {
    mockGetSubscription.mockResolvedValue(mockSubscription as unknown as PushSubscription);

    const eqUser = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockDelete.mockReturnValue({ eq: eqUser });

    const result = await disableStreakPush();
    expect(result).toEqual({ ok: true });
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('push_subscriptions');
    expect(mockDelete).toHaveBeenCalled();
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-123');
  });

  it('returns ok even when there is no active subscription', async () => {
    mockGetSubscription.mockResolvedValue(null);

    const result = await disableStreakPush();
    expect(result).toEqual({ ok: true });
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });
});

describe('isStreakPushEnabled', () => {
  it('returns true when a subscription exists', async () => {
    mockGetSubscription.mockResolvedValue(mockSubscription as unknown as PushSubscription);
    expect(await isStreakPushEnabled()).toBe(true);
  });

  it('returns false when no subscription exists', async () => {
    mockGetSubscription.mockResolvedValue(null);
    expect(await isStreakPushEnabled()).toBe(false);
  });
});
