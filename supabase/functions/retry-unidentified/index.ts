/**
 * retry-unidentified — cron-triggered Edge Function
 *
 * Finds synced observations that have no identification yet and kicks off
 * the identify cascade for each one. Runs every 30 minutes via pg_cron.
 *
 * Design constraints:
 *   - Cost 0 to run: uses the existing identify EF (no extra AI spend here —
 *     identify itself selects the cheapest available provider via cascade).
 *   - Fire-and-forget: calls identify async (no await on each response) so
 *     the cron job completes in < 10 s regardless of batch size.
 *   - Idempotent: only targets observations without ANY identification row.
 *   - Rate-safe: caps at 20 observations per run to avoid thundering herd.
 *   - Requires: SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase runtime)
 *
 * Auth: cron-only — no user JWT needed. Deploy with --no-verify-jwt.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const BATCH_SIZE = 20;
// Only retry observations that have been synced for at least 10 minutes
// (give the normal identify flow time to complete before we interfere).
const MIN_AGE_MINUTES = 10;

serve(async (req) => {
  // Accept cron calls (no auth header needed — deployed --no-verify-jwt).
  // Reject non-POST for hygiene.
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRole  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRole) {
    return new Response(JSON.stringify({ error: 'missing env' }), { status: 500 });
  }

  const db = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });

  // Find synced observations with no identification, at least MIN_AGE_MINUTES old,
  // that have at least one media file (can't identify without a photo/audio).
  const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  const { data: obs, error } = await db
    .from('observations')
    .select('id, observed_at')
    .eq('sync_status', 'synced')
    .is('primary_taxon_id', null)
    .lt('observed_at', cutoff)
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[retry-unidentified] query failed', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!obs || obs.length === 0) {
    return new Response(JSON.stringify({ queued: 0, message: 'nothing to retry' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // For each observation, fetch the primary media URL then kick off identify.
  const identifyUrl = `${supabaseUrl}/functions/v1/identify`;
  let queued = 0;

  for (const o of obs) {
    // Get primary media file
    const { data: media } = await db
      .from('media_files')
      .select('url, media_type')
      .eq('observation_id', o.id)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!media?.url) {
      console.warn(`[retry-unidentified] obs ${o.id} has no media — skipping`);
      continue;
    }

    // Fire-and-forget: don't await so we don't block the cron response
    fetch(identifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({
        observation_id: o.id,
        image_url: media.url,
        cascade: true,
      }),
    }).catch(err => {
      console.warn(`[retry-unidentified] identify fire failed for ${o.id}:`, err);
    });

    queued++;
  }

  console.log(`[retry-unidentified] queued ${queued}/${obs.length} observations`);
  return new Response(JSON.stringify({ queued, total_found: obs.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
