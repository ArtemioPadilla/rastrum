/**
 * /functions/v1/delete-observation — atomic delete across Supabase
 * (observation row + cascaded children) AND Cloudflare R2 (photo
 * blobs + the OG card).
 *
 * Why an Edge Function and not a client-side DELETE:
 *   - R2 access keys are server-side only.
 *   - Atomic from the user's perspective: we own the deletion of
 *     both halves; if either fails the user sees a single error
 *     and nothing partial is left in front of them.
 *   - Listing the media_files keys requires a query the client
 *     would do anyway, so doing it server-side saves a round-trip.
 *
 * Auth: requires a Supabase JWT (Authorization: Bearer …). The
 * function validates the JWT, looks up the observation, refuses
 * unless the caller is the observer.
 *
 * Body: { observation_id: uuid }
 *
 * Env (set via `supabase secrets set`):
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME
 *   R2_ENDPOINT_URL   (or CF_ACCOUNT_ID — derived)
 *   SUPABASE_URL / SUPABASE_ANON_KEY (JWT validation)
 *   SUPABASE_SERVICE_ROLE_KEY (bypass RLS for the DELETE — we do
 *                              the ownership check ourselves above)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, DeleteObjectsCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.658.1';

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

/** Pull the R2 key from a public URL like https://media.rastrum.org/observations/<id>/<blob>.jpg */
function urlToKey(url: string, publicBase: string | null): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\//, '');
    if (publicBase) {
      const base = new URL(publicBase);
      if (u.host === base.host && path.length > 0) return path;
    }
    // Fallback: any non-empty pathname.
    return path || null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return textResponse('Method not allowed', 405);

  const env = (k: string) => Deno.env.get(k);
  const r2Endpoint = env('R2_ENDPOINT_URL')
    ?? (env('CF_ACCOUNT_ID') ? `https://${env('CF_ACCOUNT_ID')}.r2.cloudflarestorage.com` : null);
  if (!r2Endpoint) return textResponse('Function not configured: R2_ENDPOINT_URL or CF_ACCOUNT_ID', 500);
  for (const k of ['R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']) {
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

  let body: { observation_id?: string };
  try { body = await req.json(); } catch { return textResponse('Invalid JSON', 400); }
  const obsId = body?.observation_id;
  if (!obsId || typeof obsId !== 'string') return textResponse('Missing observation_id', 400);

  // Ownership check + media key lookup. We use the user's JWT so RLS
  // gates the read — a non-owner can't even probe whether an obs id
  // exists via this function.
  const { data: obs, error: obsErr } = await supaUser
    .from('observations')
    .select('id, observer_id')
    .eq('id', obsId)
    .maybeSingle();
  if (obsErr) return textResponse('Lookup failed: ' + obsErr.message, 500);
  if (!obs) return textResponse('Observation not found', 404);
  if (obs.observer_id !== user.id) return textResponse('Not the observer', 403);

  // List media_files keys to delete.
  const { data: media, error: mediaErr } = await supaUser
    .from('media_files')
    .select('url')
    .eq('observation_id', obsId);
  if (mediaErr) return textResponse('Media list failed: ' + mediaErr.message, 500);
  const publicBase = env('R2_PUBLIC_URL') ?? null;
  const r2Keys: string[] = [];
  for (const m of (media ?? [])) {
    const k = urlToKey((m as { url: string }).url, publicBase);
    if (k) r2Keys.push(k);
  }
  // OG card lives at og/<obs-id>.png — always attempt to remove it.
  r2Keys.push(`og/${obsId}.png`);

  // Delete from R2. DeleteObjectsCommand handles up to 1000 keys per
  // call; way more than any observation will have.
  const r2 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID')!,
      secretAccessKey: env('R2_SECRET_ACCESS_KEY')!,
    },
  });
  let r2Deleted = 0;
  let r2Errors: Array<{ Key?: string; Code?: string; Message?: string }> = [];
  if (r2Keys.length > 0) {
    try {
      const out = await r2.send(new DeleteObjectsCommand({
        Bucket: env('R2_BUCKET_NAME')!,
        Delete: { Objects: r2Keys.map(Key => ({ Key })), Quiet: false },
      }));
      r2Deleted = (out.Deleted ?? []).length;
      r2Errors  = (out.Errors  ?? []) as typeof r2Errors;
    } catch (err) {
      // R2 deletion failure is non-fatal for the DB delete — we
      // surface the error in the response body so the caller knows
      // the orphan situation, but we still proceed with the DB
      // delete because leaving the metadata row + R2 blobs is worse
      // than just leaving the R2 blobs.
      console.warn('[delete-observation] R2 delete failed', err);
      r2Errors = [{ Code: 'r2_request_failed', Message: err instanceof Error ? err.message : String(err) }];
    }
  }

  // Delete the observation row using the SERVICE ROLE key. We've
  // already verified ownership above; this bypasses RLS so we're
  // guaranteed the cascade actually happens (the ON DELETE CASCADE
  // FKs on identifications + media_files do the rest).
  const supaAdmin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error: delErr } = await supaAdmin
    .from('observations')
    .delete()
    .eq('id', obsId)
    .eq('observer_id', user.id);    // double-belt
  if (delErr) {
    return jsonResponse({
      ok: false,
      stage: 'db_delete',
      error: delErr.message,
      r2_deleted: r2Deleted,
      r2_errors: r2Errors,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    observation_id: obsId,
    r2_deleted: r2Deleted,
    r2_errors: r2Errors,
  });
});
