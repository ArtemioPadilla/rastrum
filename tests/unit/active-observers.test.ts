import { describe, it, expect, vi } from 'vitest';
import { formatActiveObserversBanner, subscribeToActiveObservers } from '../../src/lib/active-observers';

const COPY_EN = {
  today_n: 'Today {count} people are observing in {region} · join in',
  today_one: 'Today 1 person is observing in {region} · join in',
  empty: 'No observations in {region} yet today — open the season',
};

const COPY_ES = {
  today_n: 'Hoy {count} personas observan en {region} · únete',
  today_one: 'Hoy 1 persona observa en {region} · únete',
  empty: 'Todavía no hay obs en {region} hoy — abre la temporada',
};

describe('formatActiveObserversBanner', () => {
  it('renders the plural copy with count + region (EN)', () => {
    const out = formatActiveObserversBanner({ count: 7, region: 'Oaxaca' }, COPY_EN);
    expect(out).toEqual({
      text: 'Today 7 people are observing in Oaxaca · join in',
      isEmpty: false,
    });
  });

  it('renders the plural copy with count + region (ES)', () => {
    const out = formatActiveObserversBanner({ count: 7, region: 'Oaxaca' }, COPY_ES);
    expect(out.text).toBe('Hoy 7 personas observan en Oaxaca · únete');
    expect(out.isEmpty).toBe(false);
  });

  it('uses the singular branch for count = 1 (EN)', () => {
    const out = formatActiveObserversBanner({ count: 1, region: 'Oaxaca' }, COPY_EN);
    expect(out.text).toBe('Today 1 person is observing in Oaxaca · join in');
    expect(out.isEmpty).toBe(false);
  });

  it('uses the singular branch for count = 1 (ES)', () => {
    const out = formatActiveObserversBanner({ count: 1, region: 'Oaxaca' }, COPY_ES);
    expect(out.text).toBe('Hoy 1 persona observa en Oaxaca · únete');
  });

  it('renders the empty-state copy when count = 0 (EN)', () => {
    const out = formatActiveObserversBanner({ count: 0, region: 'Oaxaca' }, COPY_EN);
    expect(out).toEqual({
      text: 'No observations in Oaxaca yet today — open the season',
      isEmpty: true,
    });
  });

  it('renders the empty-state copy when count = 0 (ES)', () => {
    const out = formatActiveObserversBanner({ count: 0, region: 'Oaxaca' }, COPY_ES);
    expect(out.text).toBe('Todavía no hay obs en Oaxaca hoy — abre la temporada');
    expect(out.isEmpty).toBe(true);
  });

  it('returns text=null when region is null — graceful no-banner fallback', () => {
    const out = formatActiveObserversBanner({ count: 7, region: null }, COPY_EN);
    expect(out).toEqual({ text: null, isEmpty: false });
  });

  it('returns text=null when region is empty / whitespace-only', () => {
    expect(formatActiveObserversBanner({ count: 7, region: '' }, COPY_EN).text).toBeNull();
    expect(formatActiveObserversBanner({ count: 7, region: '   ' }, COPY_EN).text).toBeNull();
  });

  it('NEVER renders raw "NULL" / placeholder leakage', () => {
    const out = formatActiveObserversBanner({ count: 0, region: null }, COPY_EN);
    expect(out.text).toBeNull();
    // Belt-and-suspenders: the empty template still has a placeholder; we
    // must not emit it as visible copy.
    expect(out.text ?? '').not.toMatch(/\{region\}/);
    expect(out.text ?? '').not.toMatch(/null/i);
  });

  it('clamps negative counts to 0 (treats as empty)', () => {
    const out = formatActiveObserversBanner({ count: -3, region: 'Oaxaca' }, COPY_EN);
    expect(out.isEmpty).toBe(true);
    expect(out.text).toContain('open the season');
  });

  it('truncates fractional counts to int', () => {
    const out = formatActiveObserversBanner({ count: 7.9, region: 'Oaxaca' }, COPY_EN);
    expect(out.text).toBe('Today 7 people are observing in Oaxaca · join in');
  });
});

describe('subscribeToActiveObservers', () => {
  it('returns an unsubscribe function', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockSupabase = { channel: vi.fn().mockReturnValue(mockChannel) };

    const unsub = subscribeToActiveObservers(mockSupabase as any, 'MX', vi.fn());
    expect(typeof unsub).toBe('function');
    expect(mockSupabase.channel).toHaveBeenCalledWith('active-observers:MX');
  });

  it('calls onCount callback when postgres_changes fires and RPC returns count', async () => {
    let changeHandler: (() => Promise<void>) | null = null;
    const mockChannel = {
      on: vi.fn().mockImplementation((_type: any, _opts: any, handler: any) => {
        changeHandler = handler;
        return mockChannel;
      }),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockRpc = vi.fn().mockResolvedValue({ data: 7 });
    const mockSupabase = {
      channel: vi.fn().mockReturnValue(mockChannel),
      rpc: mockRpc,
    };
    const onCount = vi.fn();

    subscribeToActiveObservers(mockSupabase as any, 'MX', onCount);
    if (changeHandler) await (changeHandler as () => Promise<void>)();

    expect(mockRpc).toHaveBeenCalledWith('community_active_observers_today', { p_country: 'MX' });
    expect(onCount).toHaveBeenCalledWith(7);
  });

  it('unsubscribes channel on returned function call', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockSupabase = { channel: vi.fn().mockReturnValue(mockChannel) };

    const unsub = subscribeToActiveObservers(mockSupabase as any, 'MX', vi.fn());
    unsub();
    expect(mockChannel.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
