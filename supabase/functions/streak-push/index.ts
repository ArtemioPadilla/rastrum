/**
 * /functions/v1/streak-push — nightly streak-reminder push fan-out.
 *
 * Spec: docs/runbooks/ux-backlog.md → ux-streak-push.
 *
 * Fires once at 19:55 local time per timezone (cron triggers at 01:55 UTC,
 * which is 19:55 America/Mexico_City UTC-6 — v1.0.x scope is single-tz).
 * For every push subscription whose owner has streak_digest_opt_in = true
 * and whose `user_streaks.last_qualifying_day` is exactly *yesterday*
 * (== streak alive but at risk of breaking tomorrow), send one Web Push
 * via the VAPID-authenticated transport.
 *
 * Required env vars:
 *   SUPABASE_URL                  Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     Bypasses RLS to read subscriptions
 *   VAPID_PUBLIC_KEY              Base64-URL public key
 *   VAPID_PRIVATE_KEY             Base64-URL EC private key (P-256)
 *   VAPID_SUBJECT                 mailto:owner@rastrum.org or https://rastrum.org
 *
 * If any VAPID secret is unset the function exits with `vapid_unconfigured`
 * — the operator hasn't run the steps in docs/runbooks/rotate-secret.md
 * yet. The cron continues to fire nightly; nothing breaks.
 *
 * Schedule via pg_cron — see docs/specs/infra/cron-schedules.sql
 * (`streak-push-nightly` job, 01:55 UTC).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';

interface PushSub {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
}

// ─────────────── VAPID JWT ───────────────
//
// The bare minimum to satisfy the "VAPID protocol":
//   1. ES256 JWT with `aud` (origin of the push endpoint), `exp`,
//      `sub` (operator contact).
//   2. Authorization: vapid t=<jwt>, k=<public-key-base64url>
//
// Web crypto does the signing — no native deps. Skips encrypted
// payloads (we send the request with no body, which is valid Web Push)
// and instead relies on the SW to fetch the actual content. That keeps
// this function tiny and the VAPID-only path testable.

function b64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const norm = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importVapidPrivateKey(privateKeyB64Url: string, publicKeyB64Url: string): Promise<CryptoKey> {
  // VAPID keys are raw 32-byte EC scalars. Wrap into a JWK so SubtleCrypto
  // can import. The public key is needed for the `crv`/`x`/`y` JWK fields.
  const priv = b64UrlDecode(privateKeyB64Url);
  const pub = b64UrlDecode(publicKeyB64Url);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be uncompressed (65 bytes, starts with 0x04)');
  }
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: b64UrlEncode(priv),
    x: b64UrlEncode(x),
    y: b64UrlEncode(y),
    ext: true,
  };
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function signVapidJwt(
  privateKey: CryptoKey,
  audience: string,
  subject: string,
  ttlSeconds = 12 * 3600,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: subject,
  };
  const headerB64 = b64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64UrlEncode(sig)}`;
}

async function sendPushNoPayload(
  endpoint: string,
  privateKey: CryptoKey,
  publicKeyB64Url: string,
  subject: string,
): Promise<{ ok: boolean; status: number }> {
  const aud = new URL(endpoint).origin;
  const jwt = await signVapidJwt(privateKey, aud, subject);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${publicKeyB64Url}`,
      'TTL': '86400',
      'Content-Length': '0',
    },
  });
  return { ok: res.ok, status: res.status };
}

// ─────────────── tz / "yesterday" helper ───────────────
//
// "Streak about to break" == last_qualifying_day is exactly one day before
// today *in the user's local tz*. We compute the tz-local date with
// Intl.DateTimeFormat — Deno supports it without extra deps.
function tzLocalDate(tz: string, when = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(when);
}

function tzYesterday(tz: string, when = new Date()): string {
  const d = new Date(when.getTime() - 24 * 3600 * 1000);
  return tzLocalDate(tz, d);
}

// ─────────────── HTTP handler ───────────────

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:owner@rastrum.org';

  if (!url || !role) return new Response('Function not configured', { status: 500 });
  if (!vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'vapid_unconfigured', sent: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = createClient(url, role);
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, tz')
    .returns<PushSub[]>();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, candidates: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // Filter by user opt-in + at-risk streak. We pull the join in two
  // batched queries to keep this in service-role land.
  const userIds = Array.from(new Set(subs.map(s => s.user_id)));
  const { data: users } = await db
    .from('users')
    .select('id, streak_digest_opt_in')
    .in('id', userIds)
    .returns<{ id: string; streak_digest_opt_in: boolean | null }[]>();
  const optedIn = new Set((users ?? []).filter(u => u.streak_digest_opt_in).map(u => u.id));

  const { data: streaks } = await db
    .from('user_streaks')
    .select('user_id, last_qualifying_day, current_days')
    .in('user_id', userIds)
    .returns<{ user_id: string; last_qualifying_day: string | null; current_days: number }[]>();
  const streakByUser = new Map<string, { last: string | null; days: number }>();
  (streaks ?? []).forEach(s => streakByUser.set(s.user_id, { last: s.last_qualifying_day, days: s.current_days }));

  const privateKey = await importVapidPrivateKey(vapidPriv, vapidPub);

  let sent = 0;
  let candidates = 0;
  let errored = 0;

  for (const sub of subs) {
    if (!optedIn.has(sub.user_id)) continue;
    const streak = streakByUser.get(sub.user_id);
    if (!streak || streak.days < 1) continue;
    // "1 day from breaking" == last qualifying day was yesterday in their tz.
    if (streak.last !== tzYesterday(sub.tz)) continue;
    candidates++;

    try {
      const r = await sendPushNoPayload(sub.endpoint, privateKey, vapidPub, vapidSubject);
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 410) {
        // Subscription is gone — clean it up so we don't keep retrying.
        await db.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        errored++;
      }
    } catch {
      errored++;
    }
  }

  return new Response(JSON.stringify({ sent, candidates, errored, total: subs.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
