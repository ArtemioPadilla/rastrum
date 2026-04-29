/**
 * /functions/v1/delete-photo — atomic soft-delete of a single photo on
 * an observation owned by the caller. Wraps three writes in a single
 * Postgres transaction via the `delete_photo_atomic` SECURITY DEFINER
 * RPC (defined in supabase-schema.sql):
 *
 *   1. UPDATE media_files SET deleted_at = now() WHERE id = $media_id
 *   2. (when willDemote) UPDATE identifications
 *        SET validated_by=NULL, validated_at=NULL, is_research_grade=false
 *      WHERE observation_id = $obs_id AND is_primary
 *   3. (when willDemote) UPDATE observations
 *        SET last_material_edit_at = now()
 *      WHERE id = $obs_id
 *
 * Why an Edge Function and not three client-side UPDATEs:
 *   - Atomicity. A client running three sequential calls leaks a race
 *     window if the user closes the tab between calls — they end up with
 *     a soft-deleted photo but no demote, hiding the cascade source from
 *     reviewers. The RPC commits all three writes in one logical
 *     transaction.
 *   - Auth gate. The EF re-verifies `auth.uid() = observations.observer_id`
 *     before invoking the RPC, so a stolen JWT for a different user can't
 *     delete someone else's photos.
 *
 * R2 blobs are NOT removed in v1 — the runbook documents the orphan
 * policy. A `gc-orphan-media` cron is the v1.1 follow-up.
 *
 * Auth: requires a Supabase JWT (Authorization: Bearer …). The
 * function validates the JWT, looks up the observation, refuses
 * unless the caller is the observer.
 *
 * Body: { observation_id: uuid, media_id: uuid, will_demote: boolean }
 *
 * Env (set via `supabase secrets set`):
 *   SUPABASE_URL / SUPABASE_ANON_KEY (JWT validation)
 *   SUPABASE_SERVICE_ROLE_KEY (RPC invocation — RLS bypass for the
 *                              underlying writes; the EF is the gate)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}
function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return textResponse('Method not allowed', 405);

  const env = (k: string) => Deno.env.get(k);
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env(k)) return textResponse(`Function not configured: ${k}`, 500);
  }

  // Authenticate the caller.
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return textResponse('Missing Authorization header', 401);
  const supaUser = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${auth}` } },
  });
  const { data: { user }, error: userErr } = await supaUser.auth.getUser();
  if (userErr || !user) return textResponse('Invalid token', 401);

  let body: { observation_id?: string; media_id?: string; will_demote?: boolean };
  try { body = await req.json(); } catch { return textResponse('Invalid JSON', 400); }
  const obsId   = body?.observation_id;
  const mediaId = body?.media_id;
  const demote  = !!body?.will_demote;
  if (!obsId   || typeof obsId   !== 'string') return textResponse('Missing observation_id', 400);
  if (!mediaId || typeof mediaId !== 'string') return textResponse('Missing media_id', 400);

  // Ownership check — re-verifies auth.uid() = observer_id at the EF
  // boundary so a stolen anon-key JWT can't soft-delete arbitrary
  // photos. Uses the user's JWT so RLS gates the read; if the caller
  // can't see the obs, they can't delete its photos.
  const { data: obs, error: obsErr } = await supaUser
    .from('observations')
    .select('id, observer_id')
    .eq('id', obsId)
    .maybeSingle();
  if (obsErr) return textResponse('Lookup failed: ' + obsErr.message, 500);
  if (!obs) return textResponse('Observation not found', 404);
  if (obs.observer_id !== user.id) return textResponse('Not the observer', 403);

  // Sanity: media must belong to this observation. The RPC's WHERE
  // clause repeats this check, but failing fast here gives a clearer
  // error.
  const { data: media, error: mediaErr } = await supaUser
    .from('media_files')
    .select('id, observation_id, deleted_at')
    .eq('id', mediaId)
    .maybeSingle();
  if (mediaErr) return textResponse('Media lookup failed: ' + mediaErr.message, 500);
  if (!media || media.observation_id !== obsId) {
    return textResponse('Photo not found on this observation', 404);
  }

  // Run the atomic three-write transaction via the SECURITY DEFINER RPC.
  // Service role here bypasses RLS — the EF has already gated ownership.
  const supaAdmin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error: rpcErr } = await supaAdmin.rpc('delete_photo_atomic', {
    p_obs_id:   obsId,
    p_media_id: mediaId,
    p_demote:   demote,
  });
  if (rpcErr) {
    return jsonResponse({ ok: false, error: rpcErr.message }, 500);
  }

  return jsonResponse({
    ok: true,
    observation_id: obsId,
    media_id: mediaId,
    demoted: demote,
  });
});
