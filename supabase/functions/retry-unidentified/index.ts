/**
 * retry-unidentified — cron-triggered Edge Function
 *
 * Retries identification for synced observations that don't have a primary
 * taxon yet. Refactored for #590 to coordinate with the client-side idQueue
 * retry worker (#588): we now SKIP obs whose observer was recently active —
 * those will retry client-side with the full plugin cascade (MegaDetector,
 * BirdNET, on-device EfficientNet, BYO key Claude). The cron's job is to
 * be a fallback for dormant users only.
 *
 * Behaviour:
 *   - Skip when the owner was active in the last 7 days.
 *   - Cap at MAX_AGE_DAYS (30) — older obs flip to identification_status
 *     'abandoned' so /console/identifications/ can flag them for human ID.
 *   - Pass user_hint derived from evidence_type to bias PlantNet vs Claude.
 *   - Fire-and-forget the identify EF (no await on each call).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { deriveHint } from './_helpers.ts';

const BATCH_SIZE = 20;
const MIN_AGE_MINUTES = 10;
const SKIP_ACTIVE_USER_DAYS = 7;
const MAX_AGE_DAYS = 30;

serve(async (req) => {
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

  const cutoffMin = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  const cutoffMax = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
  const activeCutoff = new Date(Date.now() - SKIP_ACTIVE_USER_DAYS * 86_400_000).toISOString();

  const { data: obs, error } = await db
    .from('observations')
    .select('id, observer_id, evidence_type, observed_at')
    .eq('sync_status', 'synced')
    .is('primary_taxon_id', null)
    .neq('identification_status', 'abandoned')
    .lt('observed_at', cutoffMin)
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[retry-unidentified] query failed', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!obs || obs.length === 0) {
    return new Response(JSON.stringify({ queued: 0, abandoned: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const identifyUrl = `${supabaseUrl}/functions/v1/identify`;
  let queued = 0;
  let abandoned = 0;
  let skippedActive = 0;

  for (const o of obs) {
    if (o.observed_at < cutoffMax) {
      await db.from('observations')
        .update({ identification_status: 'abandoned' })
        .eq('id', o.id);
      abandoned++;
      continue;
    }

    if (o.observer_id) {
      const { data: ownerRow } = await db
        .from('users')
        .select('last_active_at')
        .eq('id', o.observer_id)
        .maybeSingle();
      if (ownerRow?.last_active_at && ownerRow.last_active_at > activeCutoff) {
        skippedActive++;
        continue;
      }
    }

    const { data: media } = await db
      .from('media_files')
      .select('url, media_type')
      .eq('observation_id', o.id)
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!media?.url) continue;

    const hint = deriveHint(o.evidence_type as string | null);
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
        user_hint: hint,
        force_provider: hint === 'plant' ? 'plantnet' : undefined,
      }),
    }).catch(err => {
      console.warn(`[retry-unidentified] identify fire failed for ${o.id}:`, err);
    });

    queued++;
  }

  console.log(`[retry-unidentified] queued=${queued} abandoned=${abandoned} skipped_active=${skippedActive}/${obs.length}`);
  return new Response(JSON.stringify({ queued, abandoned, skipped_active: skippedActive, total_found: obs.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
