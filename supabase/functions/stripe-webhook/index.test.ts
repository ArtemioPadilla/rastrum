/**
 * Smoke contract tests for the `stripe-webhook` Edge Function (#1031 Tier 1a).
 *
 * Pinned behavior (no Stripe SDK / no live HMAC keys):
 *   1. Non-POST methods → 405.
 *   2. Without STRIPE_WEBHOOK_SECRET configured → 503.
 *   3. With secret set + no `stripe-signature` header → 400.
 *   4. With secret set + malformed signature header → 400 (bad signature).
 *
 * Real HMAC verification + Stripe event handlers are exercised via
 * Stripe's CLI fixtures in the bring-online checklist (see
 * docs/runbooks/stripe-pro-tier.md).
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('stripe-webhook: GET → 405', async () => {
  const res = await handler(new Request('http://localhost/stripe-webhook', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('stripe-webhook: DELETE → 405', async () => {
  const res = await handler(new Request('http://localhost/stripe-webhook', { method: 'DELETE' }));
  assertEquals(res.status, 405);
});

Deno.test('stripe-webhook: POST without secret env → 503', async () => {
  const originalSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  Deno.env.delete('STRIPE_WEBHOOK_SECRET');
  try {
    const res = await handler(new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' }));
    assertEquals(res.status, 503);
  } finally {
    if (originalSecret) Deno.env.set('STRIPE_WEBHOOK_SECRET', originalSecret);
  }
});

Deno.test('stripe-webhook: POST with secret but no signature header → 400', async () => {
  const originalSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec_test_fixture_not_real');
  try {
    const res = await handler(new Request('http://localhost/stripe-webhook', { method: 'POST', body: '{}' }));
    assertEquals(res.status, 400);
  } finally {
    if (originalSecret) Deno.env.set('STRIPE_WEBHOOK_SECRET', originalSecret);
    else Deno.env.delete('STRIPE_WEBHOOK_SECRET');
  }
});

Deno.test('stripe-webhook: POST with malformed signature → 400', async () => {
  const originalSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec_test_fixture_not_real');
  try {
    const res = await handler(new Request('http://localhost/stripe-webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'garbage' },
    }));
    assertEquals(res.status, 400);
  } finally {
    if (originalSecret) Deno.env.set('STRIPE_WEBHOOK_SECRET', originalSecret);
    else Deno.env.delete('STRIPE_WEBHOOK_SECRET');
  }
});

Deno.test.ignore('stripe-webhook: valid signature dispatches to handler', () => {
  // TODO: requires real HMAC with STRIPE_WEBHOOK_SECRET + a fixture event
  // shape + live Supabase to apply the tier update. See
  // docs/runbooks/stripe-pro-tier.md for the integration fixture.
});
