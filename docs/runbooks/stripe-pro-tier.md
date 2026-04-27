# Stripe Pro tier — wiring guide

> The schema already has `users.tier` (default `'free'`). Switching a
> user to `'pro'` lets the app gate features (bulk export, expert
> review priority, etc.). This runbook documents the minimal wiring
> needed to flip that column on a successful Stripe checkout.
>
> Status: **scaffolded, not enabled.** Files exist; webhook URL is not
> registered with Stripe yet. Bring this online once you have a
> reason to charge.

## Status checklist

- [x] Edge Function `stripe-webhook` scaffolded (this PR).
- [ ] Schema column `users.subscription_tier text DEFAULT 'free'` (the
      existing `users.tier` is gamification — bronze/silver/gold/platinum
      — and is unrelated). Add via:
      ```sql
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free';
      ALTER TABLE public.users ADD CONSTRAINT users_subscription_tier_check CHECK (subscription_tier IN ('free','pro'));
      ```
- [ ] Stripe account created / restricted API key minted.
- [ ] Webhook endpoint registered in the Stripe dashboard.
- [ ] Pricing page wired to a Stripe Checkout session.
- [ ] Tier-gated features built (bulk export quota, etc.).

## Architecture

```
Browser → Stripe Checkout → user pays
                         ↓
        Stripe → POST /functions/v1/stripe-webhook
                         ↓
        verify signature → upsert users.tier='pro'
```

We deliberately do NOT trust the browser. The tier flip only happens
on a verified `checkout.session.completed` event from Stripe's signed
webhook.

## Steps to bring online

### 1. Mint API keys

- Stripe Dashboard → Developers → API Keys → Restricted Key
- Capabilities: `Customers (Read)`, `Checkout Sessions (Write)`,
  `Webhook Endpoints (Read)`.
- Save as Supabase secret:
  ```
  supabase secrets set STRIPE_SECRET_KEY=rk_live_...
  ```

### 2. Register webhook

- Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://reppvlqejgoqvitturxp.supabase.co/functions/v1/stripe-webhook`
- Events to send: `checkout.session.completed`, `customer.subscription.deleted`
- Copy the signing secret (`whsec_...`):
  ```
  supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
  ```

### 3. Deploy the function

```
gh workflow run deploy-functions.yml -f function=stripe-webhook
```

### 4. Wire a Checkout button

In the pricing page, on click:

```ts
const supabase = getSupabase();
const { data: { user } } = await supabase.auth.getUser();
const res = await supabase.functions.invoke('stripe-create-session', {
  body: { user_id: user!.id, price_id: 'price_...' },
});
window.location.href = res.data.url;
```

(`stripe-create-session` is a separate function — write when needed.)

### 5. Verify

- Use Stripe's test cards in test mode.
- After a successful checkout, `users.tier` should flip to `'pro'`
  within seconds.
- `customer.subscription.deleted` flips it back to `'free'`.

## Rollback

Disable the webhook in Stripe (one click). The function stops
receiving events. Existing `tier='pro'` users keep their flag until
manually cleared via SQL.
