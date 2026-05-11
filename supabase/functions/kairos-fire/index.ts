/**
 * /functions/v1/kairos-fire — kairos contextual prompt fan-out.
 *
 * Spec: docs/specs/modules/34-kairos-prompts.md (#724).
 *
 * Fires every 15 minutes via pg_cron. For each user with an opted-in
 * kairos subscription, picks the best trigger and sends one Web Push.
 *
 * Triggers (in priority order for 1/day cap):
 *   after_rain   — ≥ 5 mm in last 12 h at user's last-obs geohash5
 *   golden_hour  — now() ∈ [sunset - 30 min, sunset - 15 min]
 *   lunar_event  — full moon / new moon / eclipse today in user's timezone
 *
 * Required env vars:
 *   SUPABASE_URL                  Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     Bypasses RLS to read subscriptions
 *   VAPID_PUBLIC_KEY              Base64-URL public key
 *   VAPID_PRIVATE_KEY             Base64-URL EC private key (P-256)
 *   VAPID_SUBJECT                 mailto:owner@rastrum.org or https://rastrum.org
 *   CRON_SECRET                   Header-based gating (X-Cron-Secret)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';
import { computeSunset, inGoldenHourPromptWindow, tzLocalDate } from '../_shared/sun.ts';
import { importVapidPrivateKey, sendPushNoPayload, sendPushWithPayload } from '../_shared/web-push.ts';
import { isLunarEventToday } from '../_shared/moon.ts';
import { getRecentRainfallMm } from '../_shared/weather.ts';
import { captureServerEvent } from '../_shared/analytics.ts';

// Ngeohash-compatible 5-char encode (pure, no deps).
function encodeGeohash5(lat: number, lng: number): string {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let result = '';
  let bits = 0, numBits = 0, isEven = true;
  while (result.length < 5) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) | 1; minLng = mid; }
      else             { bits = (bits << 1);     maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; }
      else            { bits = (bits << 1);     maxLat = mid; }
    }
    isEven = !isEven;
    numBits++;
    if (numBits === 5) {
      result += BASE32[bits];
      bits = 0;
      numBits = 0;
    }
  }
  return result;
}

interface KairosRow {
  user_id: string;
  kind: string;
  last_sent_at: string | null;
}

interface Day3NudgeUser {
  id: string;
  created_at: string;
  observation_count: number;
}

interface PushSub {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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
const AFTER_RAIN_THRESHOLD_MM = 5;

// ── Day-3 nudge push payloads ────────────────────────────────────────
function buildDay3Nudge(lang: 'en' | 'es', weatherContext?: string | null): { title: string; body: string } {
  const weatherLine = weatherContext ? `\n${weatherContext}` : '';
  return lang === 'es'
    ? {
        title: '¡Sal a explorar! 🌿',
        body: `Ya llevas 3 días en Rastrum y aún no has registrado tu primera observación.${weatherLine} ¿Qué hay afuera hoy?`,
      }
    : {
        title: 'Go explore! 🌿',
        body: `You've been on Rastrum for 3 days but haven't logged your first observation yet.${weatherLine} What's out there today?`,
      };
}

// ── Golden-hour pick ─────────────────────────────────────────────────

function pickGoldenHour(params: {
  lat: number;
  lng: number;
  tz: string;
  lastSentAt: string | null;
  now: Date;
}): boolean {
  const { lat, lng, tz, lastSentAt, now } = params;
  const sunset = computeSunset(lat, lng, now);
  if (!sunset) return false;
  if (!inGoldenHourPromptWindow(sunset, now)) return false;
  if (lastSentAt) {
    const sentDate = tzLocalDate(tz, new Date(lastSentAt));
    if (sentDate === tzLocalDate(tz, now)) return false;
  }
  return true;
}

// ── After-rain pick ──────────────────────────────────────────────────

async function pickAfterRain(params: {
  db: ReturnType<typeof createClient>;
  lat: number;
  lng: number;
  tz: string;
  lastSentAt: string | null;
  now: Date;
}): Promise<boolean> {
  const { db, lat, lng, tz, lastSentAt, now } = params;

  // 1/day cap shared with golden_hour — if already sent today, skip.
  if (lastSentAt) {
    const sentDate = tzLocalDate(tz, new Date(lastSentAt));
    if (sentDate === tzLocalDate(tz, now)) return false;
  }

  const geohash5 = encodeGeohash5(lat, lng);
  const since = new Date(now.getTime() - 12 * 60 * 60 * 1_000);
  const rainfall = await getRecentRainfallMm(db, geohash5, since);
  if (rainfall === null) return false;
  return rainfall >= AFTER_RAIN_THRESHOLD_MM;
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
  const posthogKey = Deno.env.get('POSTHOG_PROJECT_KEY');

  if (!url || !role) return new Response('Function not configured', { status: 500 });
  if (!vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'vapid_unconfigured', sent: 0 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  const db = createClient(url, role);
  const now = new Date();

  // ── Day-3 nudge: fire for users who signed up 3 days ago with 0 observations ──
  let day3Sent = 0;
  let day3Candidates = 0;
  {
    const since4d = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1_000).toISOString();
    const since3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000).toISOString();

    const { data: day3Users } = await db
      .from('users')
      .select('id, created_at, observation_count')
      .gte('created_at', since4d)
      .lte('created_at', since3d)
      .eq('observation_count', 0)
      .returns<Day3NudgeUser[]>();

    if (day3Users?.length) {
      const day3UserIds = day3Users.map(u => u.id);

      // Ensure we haven't already sent a day3_nudge today (dedupe via kairos_subscriptions).
      const { data: alreadySent } = await db
        .from('kairos_subscriptions')
        .select('user_id, last_sent_at')
        .eq('kind', 'day3_nudge')
        .in('user_id', day3UserIds)
        .returns<{ user_id: string; last_sent_at: string | null }[]>();

      const sentToday = new Set<string>();
      const todayDateStr = now.toLocaleDateString('en-CA', { timeZone: 'UTC' });
      for (const row of alreadySent ?? []) {
        if (!row.last_sent_at) continue;
        const sentDate = new Date(row.last_sent_at).toLocaleDateString('en-CA', { timeZone: 'UTC' });
        if (sentDate === todayDateStr) sentToday.add(row.user_id);
      }

      const { data: day3Pushes } = await db
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth, tz')
        .in('user_id', day3UserIds)
        .returns<PushSub[]>();

      const day3PushesByUser = new Map<string, PushSub[]>();
      for (const p of day3Pushes ?? []) {
        const list = day3PushesByUser.get(p.user_id) ?? [];
        list.push(p);
        day3PushesByUser.set(p.user_id, list);
      }

      const privateKey = await importVapidPrivateKey(vapidPriv, vapidPub);

      for (const user of day3Users) {
        if (sentToday.has(user.id)) continue;
        const pushes = day3PushesByUser.get(user.id);
        if (!pushes?.length) continue;

        day3Candidates++;

        // Enrich with golden-hour / weather context if available.
        const tz = pushes[0].tz || FALLBACK_TZ;
        let weatherContext: string | null = null;
        try {
          const sunset = computeSunset(FALLBACK_LAT, FALLBACK_LNG, now);
          if (sunset && inGoldenHourPromptWindow(sunset, now)) {
            weatherContext = tz.startsWith('America') ? 'La luz dorada está perfecta ahora. ☀️' : 'The golden hour light is perfect right now. ☀️';
          }
        } catch { /* weather enrichment is best-effort */ }

        const lang = tz.startsWith('America') ? 'es' : 'en';
        const payload = buildDay3Nudge(lang, weatherContext);

        let anyOk = false;
        for (const p of pushes) {
          try {
            const r = await sendPushWithPayload(
              p.endpoint, privateKey, vapidPub, vapidSubject,
              p.p256dh, p.auth, { title: payload.title, body: payload.body },
            );
            if (r.ok) { day3Sent++; anyOk = true; }
            else if (r.status === 404 || r.status === 410) {
              await db.from('push_subscriptions').delete().eq('id', p.id);
            }
          } catch { /* best effort */ }
        }
if (anyOk) {
          await captureServerEvent(posthogKey, user.id, 'push_sent', {
            trigger: 'day3_nudge',
            lang,
          });
          const iso = now.toISOString();
          // Upsert a day3_nudge subscription record so we track last_sent_at.
          await db.from('kairos_subscriptions').upsert(
            { user_id: user.id, kind: 'day3_nudge', opt_in: true, last_sent_at: iso, updated_at: iso },
            { onConflict: 'user_id,kind' },
          );
        }
      }
    }
  }

  const { data: subs, error: subsErr } = await db
    .from('kairos_subscriptions')
    .select('user_id, kind, last_sent_at')
    .in('kind', ['golden_hour', 'after_rain', 'lunar_event'])
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
    .select('id, user_id, endpoint, p256dh, auth, tz')
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

  // Group by user_id: after_rain has priority over golden_hour in 1/day cap.
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

    // Find last_sent_at across all kinds (shared 1/day cap).
    const lastSentAt = userSubs.reduce<string | null>((best, s) => {
      if (!s.last_sent_at) return best;
      if (!best) return s.last_sent_at;
      return s.last_sent_at > best ? s.last_sent_at : best;
    }, null);

    // After_rain takes priority over golden_hour.
    const afterRainSub = userSubs.find(s => s.kind === 'after_rain');
    const lunarSub = userSubs.find(s => s.kind === 'lunar_event');
    const goldenHourSub = userSubs.find(s => s.kind === 'golden_hour');

    let shouldFire = false;
    let firedKind: string | null = null;

    if (afterRainSub) {
      shouldFire = await pickAfterRain({ db, lat, lng, tz, lastSentAt, now });
      if (shouldFire) firedKind = 'after_rain';
    }
    if (!shouldFire && lunarSub) {
      const lunarKind = pickLunarEvent({ tz, lastSentAt, now });
      if (lunarKind !== null) { shouldFire = true; firedKind = 'lunar_event'; }
    }
    if (!shouldFire && goldenHourSub) {
      shouldFire = pickGoldenHour({ lat, lng, tz, lastSentAt, now });
      if (shouldFire) firedKind = 'golden_hour';
    }

    if (!shouldFire || !firedKind) continue;
    candidates++;

    let anySuccess = false;

    // Check granular notification preference (#870).
    // notification_prefs_get returns true by default (opt-out model),
    // so this only skips when the user explicitly disabled it.
    const { data: prefAllowed } = await db.rpc('notification_prefs_get', {
      p_uid: sub.user_id,
      p_channel: 'push',
      p_trigger: 'kairos_golden_hour',
    });
    if (prefAllowed === false) continue;

    // Determine the push payload to send for this trigger.
    const kairosPayload = firedKind === 'golden_hour'
      ? (tz.startsWith('America')
          ? { title: 'Atardecer en ~30 min', body: 'Buena hora para aves y polinizadores. ¿20 min de caminata?', url: '/es/observar/' }
          : { title: 'Sunset in ~30 min', body: 'Good time for birds and pollinators. 20-min walk?', url: '/en/observe/' })
      : firedKind === 'after_rain'
      ? (tz.startsWith('America')
          ? { title: 'Después de la lluvia 🌿', body: '¿Saliste a ver qué emergió?', url: '/es/observar/' }
          : { title: 'After the rain 🌿', body: 'Time to see what emerged.', url: '/en/observe/' })
      : (tz.startsWith('America')
          ? { title: 'Evento lunar esta noche 🌕', body: '¿Qué está activo en la oscuridad?', url: '/es/observar/' }
          : { title: 'Lunar event tonight 🌕', body: 'What's active in the dark?', url: '/en/observe/' });

    for (const p of userPushes) {
      try {
        const r = await sendPushWithPayload(
          p.endpoint, privateKey, vapidPub, vapidSubject,
          p.p256dh, p.auth, kairosPayload,
        );
        if (r.ok) { sent++; anySuccess = true; }
        else if (r.status === 404 || r.status === 410) {
          await db.from('push_subscriptions').delete().eq('id', p.id);
        } else { errored++; }
      } catch { errored++; }
    }

    if (anySuccess) {
      await captureServerEvent(posthogKey, userId, 'push_sent', {
        trigger: firedKind,
        tz,
      });
      const iso = now.toISOString();
      // Update last_sent_at on all opted-in kinds for this user (shared cap).
      for (const s of userSubs) {
        await db.from('kairos_subscriptions')
          .update({ last_sent_at: iso, updated_at: iso })
          .eq('user_id', userId)
          .eq('kind', s.kind);
      }
    }
  }

  return new Response(JSON.stringify({ sent, candidates, errored, total: subs.length, day3_sent: day3Sent, day3_candidates: day3Candidates }), {
    headers: { 'content-type': 'application/json' },
  });
});
