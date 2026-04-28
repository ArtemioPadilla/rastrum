import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FOLLOW_RATE_PER_HOUR = 30;
const COLLAB_REQUEST_PER_DAY = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'no_jwt' }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'invalid_jwt' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const action = String(body.action ?? '');

  // Rate-limit: count follows by this user in last hour.
  const { count: hourCount } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId)
    .gte('requested_at', new Date(Date.now() - 3600_000).toISOString());

  if ((hourCount ?? 0) >= FOLLOW_RATE_PER_HOUR && action !== 'unfollow' && action !== 'accept') {
    return json({ error: 'rate_limited', retry_after_s: 3600 }, 429);
  }

  if (action === 'follow') {
    const target = String(body.target_user_id ?? '');
    const tier = (body.tier === 'collaborator' ? 'collaborator' : 'follower') as 'follower' | 'collaborator';
    if (!target || target === userId) return json({ error: 'bad_target' }, 400);

    if (tier === 'collaborator') {
      const { count: dayCount } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId)
        .eq('tier', 'collaborator')
        .gte('requested_at', new Date(Date.now() - 86400_000).toISOString());
      if ((dayCount ?? 0) >= COLLAB_REQUEST_PER_DAY) {
        return json({ error: 'rate_limited', retry_after_s: 86400 }, 429);
      }
    }

    // Profile-privacy gate: if target's profile_privacy.profile = 'private', store as pending.
    const { data: target_user } = await supabase
      .from('users').select('profile_privacy').eq('id', target).single();

    const profileMode = (target_user?.profile_privacy as Record<string, string> | null)
      ?.profile ?? 'signed_in';
    const requiresApproval =
      profileMode === 'private'
      || tier === 'collaborator';

    const { error } = await supabase.from('follows').upsert({
      follower_id: userId,
      followee_id: target,
      tier,
      status: requiresApproval ? 'pending' : 'accepted',
      requested_at: new Date().toISOString(),
      accepted_at: requiresApproval ? null : new Date().toISOString(),
    }, { onConflict: 'follower_id,followee_id' });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, status: requiresApproval ? 'pending' : 'accepted' });
  }

  if (action === 'unfollow') {
    const target = String(body.target_user_id ?? '');
    const { error } = await supabase
      .from('follows').delete()
      .eq('follower_id', userId).eq('followee_id', target);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'accept') {
    const follower = String(body.follower_id ?? '');
    const { error } = await supabase
      .from('follows')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('follower_id', follower).eq('followee_id', userId).eq('status', 'pending');
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'reject') {
    const follower = String(body.follower_id ?? '');
    const { error } = await supabase
      .from('follows').delete()
      .eq('follower_id', follower).eq('followee_id', userId).eq('status', 'pending');
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
});
