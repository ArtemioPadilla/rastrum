/**
 * /functions/v1/kairos-fire — kairos contextual prompt fan-out.
 *
 * Spec: docs/specs/modules/34-kairos-prompts.md (#724).
 *
 * Fires every 15 minutes via pg_cron. Triggers in priority order:
 *   golden_hour   — now() ∈ [sunset - 30 min, sunset - 15 min]
 *   lunar_event   — full moon / new moon / eclipse today in user's timezone
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';
import { computeSunset, inGoldenHourPromptWindow, tzLocalDate } from '../_shared/sun.ts';
import { importVapidPrivateKey, sendPushNoPayload } from '../_shared/web-push.ts';
import { isLunarEventToday } from '../_shared/moon.ts';

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

const FALLBACK_LAT = 19.4326;
const FALLBACK_LNG = -99.1332;
const FALLBACK_TZ  = 'America/Mexico_City';

// ── Golden-hour pick ─────────────────────────────────────────────────

function pickGoldenHour(params: {
  lat: number; lng: number; tz: string;
  lastSentAt: string | null; now: Date;
}): boolean {
  const { lat, lng, tz, lastSentAt, now } = params;
  const sunset = computeSunset(lat, lng, now);
  if (!sunset) return false;
  if (!inGoldenHourPromptWindow(sunset, now)) return false;
  if (lastSentAt && tzLocalDate(tz, new Date(lastSentAt)) === tzLocalDate(tz, now)) return false;
  return true;
}

// ── Lunar event pick ─────────────────────────────────────────────────

function pickLunarEvent(params: {
  tz: string; lastSentAt: string | null; now: Date;
}): 'full' | 'new' | 'eclipse' | null {
  const { tz, lastSentAt, now } = params;
  if (lastSentAt && tzLocalDate(tz, new Date(lastSentAt)) === tzLocalDate(tz, now)) return null;
  return isLunarEventToday(now, tz);
}

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
    .in('kind', ['golden_hour', 'lunar_event'])
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

  const userIds = [...new Set(subs.map(s => s.user_id))];

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

  const subsByUser = new Map<string, KairosRow[]>();
  for (const sub of subs) {
    const list = subsByUser.get(sub.user_id) ?? [];
    list.push(sub);
    subsByUser.set(sub.user_id, list);
  }

  let sent = 0, candidates = 0, errored = 0;

  for (const [userId, userSubs] of subsByUser) {
    const userPushes = pushesByUser.get(userId);
    if (!userPushes?.length) continue;

    const obs = lastObsByUser.get(userId);
    const coords = obs?.location?.coordinates;
    const lat = coords ? coords[1] : FALLBACK_LAT;
    const lng = coords ? coords[0] : FALLBACK_LNG;
    const tz = userPushes[0].tz || FALLBACK_TZ;

    const lastSentAt = userSubs.reduce<string | null>((best, s) => {
      if (!s.last_sent_at) return best;
      if (!best) return s.last_sent_at;
      return s.last_sent_at > best ? s.last_sent_at : best;
    }, null);

    const goldenHourSub = userSubs.find(s => s.kind === 'golden_hour');
    const lunarSub = userSubs.find(s => s.kind === 'lunar_event');

    let shouldFire = false;

    if (goldenHourSub) {
      shouldFire = pickGoldenHour({ lat, lng, tz, lastSentAt, now });
    }
    if (!shouldFire && lunarSub) {
      const lunarKind = pickLunarEvent({ tz, lastSentAt, now });
      shouldFire = lunarKind !== null;
    }

    if (!shouldFire) continue;
    candidates++;

    let anySuccess = false;
    for (const p of userPushes) {
      try {
        const r = await sendPushNoPayload(p.endpoint, privateKey, vapidPub, vapidSubject);
        if (r.ok) { sent++; anySuccess = true; }
        else if (r.status === 404 || r.status === 410) {
          await db.from('push_subscriptions').delete().eq('id', p.id);
        } else { errored++; }
      } catch { errored++; }
    }

    if (anySuccess) {
      const iso = now.toISOString();
      for (const s of userSubs) {
        await db.from('kairos_subscriptions')
          .update({ last_sent_at: iso, updated_at: iso })
          .eq('user_id', userId)
          .eq('kind', s.kind);
      }
    }
  }

  return new Response(JSON.stringify({ sent, candidates, errored, total: subs.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
