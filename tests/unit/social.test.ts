import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => {
  const single = { single: vi.fn() };
  const eq = { eq: vi.fn(() => eq), maybeSingle: vi.fn() };
  const builder: Record<string, unknown> = {
    select: vi.fn(() => eq),
    insert: vi.fn(() => single),
    delete: vi.fn(() => eq),
    update: vi.fn(() => eq),
  };
  const from = vi.fn(() => builder);
  const client = { from, functions: { invoke: vi.fn() }, auth: { getUser: vi.fn() } };
  return {
    getSupabase: () => client,
  };
});

import { getSupabase } from '../../src/lib/supabase';
import { followUser, unfollowUser, react, unreact, reportTarget } from '../../src/lib/social';

const supabase = getSupabase() as unknown as {
  functions: { invoke: ReturnType<typeof vi.fn> };
};

describe('social client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('followUser invokes the follow Edge Function with action=follow', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true, status: 'accepted' }, error: null,
    });
    const out = await followUser('user-uuid');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('follow', {
      body: { action: 'follow', target_user_id: 'user-uuid', tier: 'follower' },
    });
    expect(out).toEqual({ ok: true, status: 'accepted' });
  });

  it('unfollowUser invokes the follow Edge Function with action=unfollow', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true }, error: null,
    });
    await unfollowUser('user-uuid');
    expect(supabase.functions.invoke).toHaveBeenCalledWith('follow', {
      body: { action: 'unfollow', target_user_id: 'user-uuid' },
    });
  });

  it('react invokes the react Edge Function with toggle=true', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true, action: 'inserted' }, error: null,
    });
    await react({ target: 'observation', target_id: 'obs-id', kind: 'fave' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('react', {
      body: { target: 'observation', target_id: 'obs-id', kind: 'fave', toggle: true },
    });
  });

  it('unreact invokes the react Edge Function with toggle=false', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true, action: 'deleted' }, error: null,
    });
    await unreact({ target: 'observation', target_id: 'obs-id', kind: 'fave' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('react', {
      body: { target: 'observation', target_id: 'obs-id', kind: 'fave', toggle: false },
    });
  });

  it('reportTarget invokes the report Edge Function', async () => {
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true, id: 'rep-id' }, error: null,
    });
    await reportTarget({ target: 'user', target_id: 'u', reason: 'spam', note: 'x' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('report', {
      body: { target: 'user', target_id: 'u', reason: 'spam', note: 'x' },
    });
  });
});
