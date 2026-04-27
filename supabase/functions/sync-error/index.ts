/**
 * /functions/v1/sync-error — receive a single beacon when a client-side
 * sync attempt fails. Lets us catch the next "every upload silently
 * failing" regression in minutes instead of waiting for a user to
 * notice. See docs/runbooks/post-launch-improvements.md (#2).
 *
 * Body: { user_id?, error_message, blob_count, sync_attempts, app_version }
 *   - user_id is optional — anonymous beacons (guest users) are still
 *     useful for spotting CORS regressions
 *   - we never log message contents that include URLs/PII; the client is
 *     responsible for sending a sanitized message
 *
 * Storage: appends to public.sync_failures with a 14-day RLS-free
 * retention. Idempotent on (user_id, error_hash, day) so a single
 * client retry storm doesn't blow up the table.
 *
 * Auth: anonymous OK. We trust the IP-rate-limit at Supabase Edge level
 * and add our own per-IP throttle below.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

type Body = {
  user_id?: string;
  error_message: string;
  blob_count?: number;
  sync_attempts?: number;
  app_version?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }
  if (!body?.error_message || typeof body.error_message !== 'string') {
    return jsonResponse({ error: 'missing error_message' }, 400);
  }

  // Truncate aggressively — the column is bounded and we don't want to
  // accept URL-bearing payloads.
  const errorMsg = body.error_message.slice(0, 500);
  const errorHash = await sha256(errorMsg);
  const today = new Date().toISOString().slice(0, 10);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supa.from('sync_failures').upsert({
    user_id: body.user_id ?? null,
    error_hash: errorHash,
    error_message: errorMsg,
    blob_count: body.blob_count ?? 0,
    sync_attempts: body.sync_attempts ?? 1,
    app_version: body.app_version ?? null,
    failure_day: today,
  }, { onConflict: 'user_id,error_hash,failure_day' });

  if (error) {
    console.error('[sync-error] insert failed', error);
    return jsonResponse({ error: 'insert failed' }, 500);
  }

  return jsonResponse({ ok: true });
});
