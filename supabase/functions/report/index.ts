import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const OPERATOR_EMAIL = Deno.env.get('OPERATOR_EMAIL') ?? 'artemiopadilla@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const REPORT_RATE_PER_DAY = 10;

const TARGETS = ['user','observation','photo','identification','comment'] as const;
const REASONS = ['spam','harassment','wrong_id','privacy_violation','copyright','other'] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
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

  const target = String(body.target ?? '');
  const reason = String(body.reason ?? '');
  const targetId = String(body.target_id ?? '');
  const note = (typeof body.note === 'string') ? body.note.slice(0, 1000) : null;

  if (!TARGETS.includes(target as typeof TARGETS[number])) return json({ error: 'bad_target' }, 400);
  if (!REASONS.includes(reason as typeof REASONS[number])) return json({ error: 'bad_reason' }, 400);
  if (!targetId) return json({ error: 'bad_target_id' }, 400);

  const { count: dayCount } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true })
    .eq('reporter_id', userId)
    .gte('created_at', new Date(Date.now() - 86400_000).toISOString());
  if ((dayCount ?? 0) >= REPORT_RATE_PER_DAY) {
    return json({ error: 'rate_limited', retry_after_s: 86400 }, 429);
  }

  const { data: inserted, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: userId,
      target_type: target,
      target_id: targetId,
      reason,
      note,
    })
    .select('id')
    .single();
  if (error) return json({ error: error.message }, 400);

  // Best-effort operator email; never fail the request on email error.
  if (RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'reports@rastrum.org',
          to: [OPERATOR_EMAIL],
          subject: `[Rastrum] Report: ${reason} on ${target}`,
          text: `Reporter: ${userId}\nTarget: ${target}/${targetId}\nReason: ${reason}\nNote: ${note ?? '(none)'}\n\nReport ID: ${inserted.id}`,
        }),
      });
    } catch { /* ignore */ }
  }

  return json({ ok: true, id: inserted.id });
});
