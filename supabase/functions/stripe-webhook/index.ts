/**
 * /functions/v1/stripe-webhook — flip users.tier on checkout completion.
 *
 * Scaffold only — not yet wired to a Stripe account. See
 * docs/runbooks/stripe-pro-tier.md for the bring-online checklist.
 *
 * Verifies the signature header against STRIPE_WEBHOOK_SECRET (HMAC-SHA256)
 * using the same algorithm as the official `stripe.webhooks.constructEvent`,
 * but without pulling the SDK (the Deno bundle is large; we only need a
 * single event type).
 *
 * Events handled:
 *   checkout.session.completed     → users.tier = 'pro'
 *   customer.subscription.deleted  → users.tier = 'free'
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  // Header format: t=<ts>,v1=<sig>[,v0=<sig>]
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=', 2)),
  );
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const expected = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time compare
  if (expected.length !== sig.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return ok === 0;
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('not configured', { status: 503 });
  const sigHeader = req.headers.get('stripe-signature');
  if (!sigHeader) return new Response('missing signature', { status: 400 });
  const payload = await req.text();
  const ok = await verifySignature(payload, sigHeader, secret);
  if (!ok) return new Response('bad signature', { status: 400 });

  const event = JSON.parse(payload) as StripeEvent;
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { client_reference_id?: string; metadata?: { user_id?: string } };
    const userId = session.client_reference_id ?? session.metadata?.user_id;
    if (!userId) return new Response('no user_id on session', { status: 400 });
    // NB: requires a `subscription_tier text` column on users (not yet
    // added — see runbook). The existing `tier` column is gamification
    // (bronze/silver/gold/platinum) and unrelated.
    const { error } = await supa.from('users').update({ subscription_tier: 'pro' }).eq('id', userId);
    if (error) {
      console.error('[stripe-webhook] tier=pro update failed', error);
      return new Response('db error', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { customer?: string; metadata?: { user_id?: string } };
    const userId = sub.metadata?.user_id;
    if (!userId) return new Response('no user_id on subscription', { status: 400 });
    const { error } = await supa.from('users').update({ subscription_tier: 'free' }).eq('id', userId);
    if (error) {
      console.error('[stripe-webhook] tier=free update failed', error);
      return new Response('db error', { status: 500 });
    }
    return new Response('ok', { status: 200 });
  }

  // Unhandled event type — Stripe expects 2xx so we don't get retried.
  return new Response('ignored', { status: 200 });
});
