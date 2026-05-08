import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showKarmaToast,
  showMilestoneToast,
  findCrossedMilestone,
  subscribeToKarmaEvents,
  _resetToastContainer,
  _resetMilestonesCache,
  _setMilestonesCacheForTest,
  type KarmaToast,
  type KarmaMilestone,
} from './karma-toast';

const SEED_MILESTONES: KarmaMilestone[] = [
  { threshold: 100, label_en: 'First 100 karma', label_es: 'Primer 100 de karma', icon: '✨' },
  { threshold: 500, label_en: '500 karma observer', label_es: 'Observador con 500 de karma', icon: '🌱' },
  { threshold: 1000, label_en: '1,000 karma — research-grade ally', label_es: '1.000 de karma — aliado', icon: '🌳' },
  { threshold: 5000, label_en: '5,000 karma — power observer', label_es: '5.000 de karma — observador experto', icon: '🌟' },
];

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

function makeFakeSupabase(opts: { karmaTotal?: number | null; milestones?: KarmaMilestone[] | null } = {}) {
  const channels: Array<FakeChannel & { name: string }> = [];
  const removed: string[] = [];

  function makeUsersBuilder() {
    return {
      select() { return this; },
      eq() { return this; },
      async maybeSingle() {
        return { data: opts.karmaTotal === undefined ? null : { karma_total: opts.karmaTotal }, error: null };
      },
    };
  }

  function makeMilestonesBuilder() {
    const rows = opts.milestones ?? null;
    return {
      select() { return this; },
      async order() {
        if (rows === null) return { data: null, error: { message: 'no rows' } };
        return { data: rows, error: null };
      },
    };
  }

  const supabase = {
    from(table: string) {
      if (table === 'users') return makeUsersBuilder();
      if (table === 'karma_milestones') return makeMilestonesBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
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

describe('findCrossedMilestone', () => {
  it('returns the 100 milestone when prev=99 and new=101', () => {
    const m = findCrossedMilestone(99, 101, SEED_MILESTONES);
    expect(m?.threshold).toBe(100);
  });

  it('returns the 500 milestone when prev=499 and new=500 (exact hit)', () => {
    const m = findCrossedMilestone(499, 500, SEED_MILESTONES);
    expect(m?.threshold).toBe(500);
  });

  it('returns only the 500 milestone (highest in window) when prev=499 and new=600 — not 100', () => {
    const m = findCrossedMilestone(499, 600, SEED_MILESTONES);
    expect(m?.threshold).toBe(500);
  });

  it('returns the 1000 milestone when crossing both 500 and 1000 in one event', () => {
    const m = findCrossedMilestone(499, 1001, SEED_MILESTONES);
    expect(m?.threshold).toBe(1000);
  });

  it('returns null on no crossing', () => {
    expect(findCrossedMilestone(50, 80, SEED_MILESTONES)).toBeNull();
    expect(findCrossedMilestone(100, 100, SEED_MILESTONES)).toBeNull();
    expect(findCrossedMilestone(120, 110, SEED_MILESTONES)).toBeNull();
  });

  it('does not fire for negative deltas', () => {
    expect(findCrossedMilestone(105, 95, SEED_MILESTONES)).toBeNull();
  });
});

describe('showMilestoneToast', () => {
  beforeEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  it('renders a gold-accented toast with icon and label', () => {
    showMilestoneToast({ threshold: 100, label: 'First 100 karma', icon: '✨' });
    const el = document.querySelector('#karma-toast-container > [data-milestone="100"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.className).toContain('bg-amber-500');
    expect(el?.className).toContain('ring-yellow-400');
    expect(el?.textContent).toContain('First 100 karma');
    expect(el?.textContent).toContain('✨');
  });
});

describe('subscribeToKarmaEvents — milestone toasts', () => {
  beforeEach(() => {
    _resetToastContainer();
    _resetMilestonesCache();
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
  });

  afterEach(() => {
    _resetToastContainer();
    _resetMilestonesCache();
    document.body.innerHTML = '';
    document.documentElement.lang = '';
  });

  it('fires the 100 milestone when prev=99, delta=2 (new=101)', async () => {
    _setMilestonesCacheForTest(SEED_MILESTONES);
    const { supabase, channels } = makeFakeSupabase({ karmaTotal: 99, milestones: SEED_MILESTONES });
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);
    await Promise.resolve();
    await Promise.resolve();

    channels[0].handler?.({
      new: {
        id: 1, user_id: 'u1', delta: 2, reason: 'consensus_win',
        created_at: new Date().toISOString(),
      },
    });

    const el = document.querySelector('[data-milestone="100"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('First 100 karma');
  });

  it('fires the 500 milestone on exact-hit (prev=499, delta=1)', async () => {
    _setMilestonesCacheForTest(SEED_MILESTONES);
    const { supabase, channels } = makeFakeSupabase({ karmaTotal: 499, milestones: SEED_MILESTONES });
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);
    await Promise.resolve();
    await Promise.resolve();

    channels[0].handler?.({
      new: {
        id: 2, user_id: 'u1', delta: 1, reason: 'consensus_win',
        created_at: new Date().toISOString(),
      },
    });

    const el = document.querySelector('[data-milestone="500"]') as HTMLElement | null;
    expect(el).not.toBeNull();
  });

  it('fires only the 500 milestone (not 100) when prev=499 and new=600', async () => {
    _setMilestonesCacheForTest(SEED_MILESTONES);
    const { supabase, channels } = makeFakeSupabase({ karmaTotal: 499, milestones: SEED_MILESTONES });
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);
    await Promise.resolve();
    await Promise.resolve();

    channels[0].handler?.({
      new: {
        id: 3, user_id: 'u1', delta: 101, reason: 'consensus_win',
        created_at: new Date().toISOString(),
      },
    });

    expect(document.querySelector('[data-milestone="500"]')).not.toBeNull();
    expect(document.querySelector('[data-milestone="100"]')).toBeNull();
  });

  it('does not fire on negative delta', async () => {
    _setMilestonesCacheForTest(SEED_MILESTONES);
    const { supabase, channels } = makeFakeSupabase({ karmaTotal: 105, milestones: SEED_MILESTONES });
    subscribeToKarmaEvents('u1', supabase as unknown as Parameters<typeof subscribeToKarmaEvents>[1]);
    await Promise.resolve();
    await Promise.resolve();

    channels[0].handler?.({
      new: {
        id: 4, user_id: 'u1', delta: -10, reason: 'consensus_loss',
        created_at: new Date().toISOString(),
      },
    });

    expect(document.querySelector('[data-milestone]')).toBeNull();
  });
});
