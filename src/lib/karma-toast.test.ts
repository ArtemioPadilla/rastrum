import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showKarmaToast,
  subscribeToKarmaEvents,
  _resetToastContainer,
  type KarmaToast,
} from './karma-toast';

function makeToast(overrides: Partial<KarmaToast> = {}): KarmaToast {
  return {
    delta: 5,
    reason: 'consensus_win',
    label: 'Consensus win',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('showKarmaToast', () => {
  beforeEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  it('creates the toast container on first call', () => {
    expect(document.getElementById('karma-toast-container')).toBeNull();
    showKarmaToast(makeToast());
    const container = document.getElementById('karma-toast-container');
    expect(container).not.toBeNull();
    expect(container?.parentElement).toBe(document.body);
  });

  it('reuses the same container on subsequent calls', () => {
    showKarmaToast(makeToast());
    showKarmaToast(makeToast({ delta: 1, reason: 'observation_synced', label: 'Observation synced' }));
    const containers = document.querySelectorAll('#karma-toast-container');
    expect(containers.length).toBe(1);
    expect(containers[0].children.length).toBe(2);
  });

  it('applies emerald styling for positive delta', () => {
    showKarmaToast(makeToast({ delta: 10 }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('bg-emerald-100');
    expect(el?.className).toContain('text-emerald-800');
    expect(el?.textContent).toContain('+10 karma');
  });

  it('applies red styling for negative delta', () => {
    showKarmaToast(makeToast({ delta: -2, reason: 'consensus_loss', label: 'Consensus loss' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('bg-red-100');
    expect(el?.className).toContain('text-red-800');
    expect(el?.textContent).toContain('-2 karma');
  });

  it('renders the label in the toast text', () => {
    showKarmaToast(makeToast({ delta: 10, label: 'First in Rastrum' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('First in Rastrum');
  });

  it('rounds fractional deltas', () => {
    showKarmaToast(makeToast({ delta: 0.5, label: 'Comment reaction' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('+1 karma');
  });
});

interface FakeChannel {
  filter: { event: string; schema: string; table: string; filter: string } | null;
  handler: ((payload: { new: Record<string, unknown> }) => void) | null;
  subscribed: boolean;
  on: (event: string, filter: unknown, handler: (payload: { new: Record<string, unknown> }) => void) => FakeChannel;
  subscribe: () => FakeChannel;
}

function makeFakeSupabase() {
  const channels: Array<FakeChannel & { name: string }> = [];
  const removed: string[] = [];

  const supabase = {
    channel(name: string) {
      const ch: FakeChannel & { name: string } = {
        name,
        filter: null,
        handler: null,
        subscribed: false,
        on(_event, filter, handler) {
          ch.filter = filter as FakeChannel['filter'];
          ch.handler = handler;
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch: FakeChannel & { name: string }) {
      removed.push(ch.name);
    },
  };

  return { supabase, channels, removed };
}

describe('subscribeToKarmaEvents', () => {
  beforeEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
  });

  afterEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
    document.documentElement.lang = '';
  });

  it('opens a channel filtered by user_id and fires a toast on INSERT', () => {
    const { supabase, channels } = makeFakeSupabase();
    subscribeToKarmaEvents('user-abc', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);

    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('karma_events:user-abc');
    expect(channels[0].subscribed).toBe(true);
    expect(channels[0].filter).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'karma_events',
      filter: 'user_id=eq.user-abc',
    });

    channels[0].handler?.({
      new: {
        id: 1,
        user_id: 'user-abc',
        delta: 5,
        reason: 'consensus_win',
        created_at: new Date().toISOString(),
      },
    });

    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('+5 karma');
    expect(el?.textContent).toContain('Consensus win');
  });

  it('resolves the bilingual label from <html lang>', () => {
    document.documentElement.lang = 'es';
    const { supabase, channels } = makeFakeSupabase();
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);

    channels[0].handler?.({
      new: {
        id: 2,
        user_id: 'u1',
        delta: 10,
        reason: 'first_in_rastrum',
        created_at: new Date().toISOString(),
      },
    });

    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('Primero en Rastrum');
  });

  it('falls back to the raw reason when no label is registered', () => {
    const { supabase, channels } = makeFakeSupabase();
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);

    channels[0].handler?.({
      new: {
        id: 3,
        user_id: 'u1',
        delta: 1,
        reason: 'unknown_reason_xyz',
        created_at: new Date().toISOString(),
      },
    });

    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('unknown_reason_xyz');
  });

  it('returns an unsubscribe function that removes the channel exactly once', () => {
    const { supabase, channels, removed } = makeFakeSupabase();
    const unsubscribe = subscribeToKarmaEvents(
      'u1',
      supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1],
    );

    unsubscribe();
    unsubscribe();

    expect(removed).toEqual([channels[0].name]);
  });

  it('ignores payloads without a numeric delta', () => {
    const { supabase, channels } = makeFakeSupabase();
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);

    channels[0].handler?.({ new: {} });

    expect(document.querySelector('#karma-toast-container')).toBeNull();
  });

  it('swallows removeChannel errors so callers can dispose blindly', () => {
    const { supabase, channels } = makeFakeSupabase();
    const throwingSupabase = {
      ...supabase,
      removeChannel: vi.fn(() => {
        throw new Error('already torn down');
      }),
    };
    const unsubscribe = subscribeToKarmaEvents(
      'u1',
      throwingSupabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1],
    );

    expect(() => unsubscribe()).not.toThrow();
    expect(channels.length).toBe(1);
    expect(throwingSupabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
