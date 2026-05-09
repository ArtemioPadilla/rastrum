/**
 * /functions/v1/kairos-fire — kairos contextual prompt fan-out.
 *
 * Spec: docs/specs/modules/33-kairos-prompts.md (#724).
 *
 * Fires every 15 minutes via pg_cron. For each user with
 * `kairos_subscriptions.kind = 'golden_hour' AND opt_in = true`:
 *   1. Compute their local sunset using the centroid of their last
 *      observation, falling back to CDMX if none.
 *   2. If now() ∈ [sunset - 30 min, sunset - 15 min] AND last_sent_at
 *      is NULL or earlier than today (in their tz), send one Web Push.
 *   3. Update last_sent_at on success — guarantees max 1 push/user/day.
 *
 * Required env vars:
 *   SUPABASE_URL                  Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     Bypasses RLS to read subscriptions
 *   VAPID_PUBLIC_KEY              Base64-URL public key
 *   VAPID_PRIVATE_KEY             Base64-URL EC private key (P-256)
 *   VAPID_SUBJECT                 mailto:owner@rastrum.org or https://rastrum.org
 *   CRON_SECRET                   Header-based gating (X-Cron-Secret)
 *
 * Schedule via pg_cron — see docs/specs/infra/cron-schedules.sql
 * (`kairos-fire-15min` job).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';
import { computeSunset, inGoldenHourPromptWindow, tzLocalDate } from '../_shared/sun.ts';
import { importVapidPrivateKey, sendPushNoPayload } from '../_shared/web-push.ts';

interface KairosRow {
  user_id: string;
  kind: string;
  last_sent_at: string | null;
}

interface PushSub {
  id: string;
  user_id: string;
  endpoint: string;
  tz: string;
}

interface ObsRow {
  observer_id: string;
  location: { coordinates?: [number, number] } | null;
  observed_at: string;
}

const FALLBACK_LAT = 19.4326;       // Mexico City
const FALLBACK_LNG = -99.1332;
const FALLBACK_TZ  = 'America/Mexico_City';

serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:owner@rastrum.org';

  if (!url || !role) return new Response('Function not configured', { status: 500 });
  if (!vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'vapid_unconfigured', sent: 0 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  const db = createClient(url, role);

  const { data: subs, error: subsErr } = await db
    .from('kairos_subscriptions')
    .select('user_id, kind, last_sent_at')
    .eq('kind', 'golden_hour')
    .eq('opt_in', true)
    .returns<KairosRow[]>();
  if (subsErr) {
    return new Response(JSON.stringify({ error: subsErr.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, candidates: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const userIds = subs.map(s => s.user_id);

  const { data: pushes } = await db
    .from('push_subscriptions')
    .select('id, user_id, endpoint, tz')
    .in('user_id', userIds)
    .returns<PushSub[]>();
  const pushesByUser = new Map<string, PushSub[]>();
  (pushes ?? []).forEach(p => {
    const list = pushesByUser.get(p.user_id) ?? [];
    list.push(p);
    pushesByUser.set(p.user_id, list);
  });

  // Pull each user's most recent located observation. Limit defensive.
  const { data: lastObs } = await db
    .from('observations')
    .select('observer_id, location, observed_at')
    .in('observer_id', userIds)
    .not('location', 'is', null)
    .order('observed_at', { ascending: false })
    .limit(500)
    .returns<ObsRow[]>();
  const lastObsByUser = new Map<string, ObsRow>();
  (lastObs ?? []).forEach(o => {
    if (!lastObsByUser.has(o.observer_id)) lastObsByUser.set(o.observer_id, o);
  });

  const privateKey = await importVapidPrivateKey(vapidPriv, vapidPub);
  const now = new Date();

  let sent = 0, candidates = 0, errored = 0;

  for (const sub of subs) {
    const userPushes = pushesByUser.get(sub.user_id);
    if (!userPushes?.length) continue;

    const obs = lastObsByUser.get(sub.user_id);
    const coords = obs?.location?.coordinates;
    const lat = coords ? coords[1] : FALLBACK_LAT;
    const lng = coords ? coords[0] : FALLBACK_LNG;
    const tz = userPushes[0].tz || FALLBACK_TZ;

    const sunset = computeSunset(lat, lng, now);
    if (!sunset) continue;
    if (!inGoldenHourPromptWindow(sunset, now)) continue;

    // Already sent today?
    if (sub.last_sent_at) {
      const sentDate = tzLocalDate(tz, new Date(sub.last_sent_at));
      const todayDate = tzLocalDate(tz, now);
      if (sentDate === todayDate) continue;
    }

    candidates++;
    let anySuccess = false;

    for (const p of userPushes) {
      try {
        const r = await sendPushNoPayload(p.endpoint, privateKey, vapidPub, vapidSubject);
        if (r.ok) {
          sent++;
          anySuccess = true;
        } else if (r.status === 404 || r.status === 410) {
          await db.from('push_subscriptions').delete().eq('id', p.id);
        } else {
          errored++;
        }
      } catch {
        errored++;
      }
    }

    if (anySuccess) {
      await db.from('kairos_subscriptions')
        .update({ last_sent_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('user_id', sub.user_id)
        .eq('kind', sub.kind);
    }
  }

  return new Response(JSON.stringify({ sent, candidates, errored, total: subs.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
