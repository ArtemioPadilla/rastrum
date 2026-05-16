import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const REACT_RATE_PER_HOUR = 200;

const TARGETS = {
  observation:    { table: 'observation_reactions',    col: 'observation_id'   },
  photo:          { table: 'photo_reactions',          col: 'media_file_id'    },
  identification: { table: 'identification_reactions', col: 'identification_id'},
} as const;

const KIND_BY_TARGET: Record<keyof typeof TARGETS, ReadonlyArray<string>> = {
  observation:    ['fave', 'agree_id', 'needs_id', 'confirm_id', 'helpful'],
  photo:          ['fave', 'helpful'],
  identification: ['agree_id', 'disagree_id', 'helpful'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export async function handler(req: Request): Promise<Response> {
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

  const target = String(body.target ?? '') as keyof typeof TARGETS;
  const kind = String(body.kind ?? '');
  const targetId = String(body.target_id ?? '');
  const toggle = body.toggle !== false;

  if (!(target in TARGETS)) return json({ error: 'bad_target' }, 400);
  if (!KIND_BY_TARGET[target].includes(kind)) return json({ error: 'bad_kind' }, 400);
  if (!targetId) return json({ error: 'bad_target_id' }, 400);

  const { table, col } = TARGETS[target];

  // Rate-limit: count this user's reactions in the last hour.
  const { count: hourCount } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 3600_000).toISOString());
  if ((hourCount ?? 0) >= REACT_RATE_PER_HOUR) {
    return json({ error: 'rate_limited', retry_after_s: 3600 }, 429);
  }

  // Idempotent toggle.
  const { data: existing } = await supabase
    .from(table)
    .select('id')
    .eq('user_id', userId)
    .eq(col, targetId)
    .eq('kind', kind)
    .maybeSingle();

  if (existing) {
    if (toggle) {
      await supabase.from(table).delete().eq('id', existing.id);
      return json({ ok: true, action: 'deleted' });
    }
    return json({ ok: true, action: 'noop' });
  }

  const insertRow: Record<string, unknown> = { user_id: userId, kind };
  insertRow[col] = targetId;
  const { error } = await supabase.from(table).insert(insertRow);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, action: 'inserted' });
}

Deno.serve(handler);

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
