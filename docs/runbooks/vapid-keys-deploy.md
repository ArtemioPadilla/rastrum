# VAPID Keys — Production Deploy Runbook

> Cross-reference: [`kairos-prompts.md`](kairos-prompts.md) (inline VAPID deploy section) and [`cron-secret-rotation.md`](cron-secret-rotation.md) (parallel CRON_SECRET rotation procedure).
> Closes #815.

## What are VAPID keys?

**VAPID** (Voluntary Application Server Identification — [RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292)) is the authentication mechanism that lets a push server (FCM, Mozilla Push Service, etc.) verify the identity of the application server sending a Web Push notification.

The VAPID key pair consists of:

| Key | Format | Where it lives | Who reads it |
|-----|--------|---------------|-------------|
| **Public key** (`VAPID_PUBLIC_KEY`) | Base64url ECDSA P-256 uncompressed (65 bytes, starts with `0x04`) | Supabase Vault → EF env var | `kairos-fire` Edge Function + browser SW |
| **Private key** (`VAPID_PRIVATE_KEY`) | Base64url 32-byte EC scalar | Supabase Vault → EF env var | `kairos-fire` Edge Function only |
| **Subject** (`VAPID_SUBJECT`) | `mailto:…` or `https://…` URL (RFC 8292 §3.2) | Supabase Vault → EF env var | `kairos-fire` Edge Function (JWT `sub` claim) |
| **Public key (client)** (`PUBLIC_VAPID_PUBLIC_KEY`) | Same value as `VAPID_PUBLIC_KEY` | GitHub Actions secret → Astro build | Browser SW `pushManager.subscribe()` |

> **Why two public key secrets?** Supabase Vault secrets stay server-side. The browser needs the public key at subscription time — it's embedded in the static bundle via `PUBLIC_VAPID_PUBLIC_KEY`. Both values must be identical or all push endpoints will be rejected with 401/404.

---

## Prerequisites

- Access to the Supabase dashboard (Project Settings → Vault) **or** the `gh` CLI with write permission to the repo's GitHub Secrets.
- Node.js ≥ 18 locally (for `npx web-push`).
- The `CRON_SECRET` is already configured (see [`cron-secret-rotation.md`](cron-secret-rotation.md)).

---

## One-time setup (new deployment or fresh Supabase project)

### Step 1 — Generate the key pair

Use the official `web-push` CLI — it handles the P-256 curve and base64url encoding correctly:

```bash
npx web-push generate-vapid-keys --json
# → { "publicKey": "B…", "privateKey": "Y…" }
```

Save both values in your password manager. **Never commit them to version control.**

Alternative (OpenSSL — more steps, same result):

```bash
openssl ecparam -genkey -name prime256v1 -out vapid-private.pem
openssl ec -in vapid-private.pem -pubout -outform DER \
  | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=' > vapid-public.b64
openssl ec -in vapid-private.pem -outform DER \
  | tail -c 32 | base64 -w0 | tr '+/' '-_' | tr -d '=' > vapid-private.b64
```

### Step 2 — Set Supabase Vault secrets (Edge Function env vars)

Via the Supabase dashboard:
1. **Project Settings → Edge Functions → Secrets**
2. Add or update the following 3 secrets:

| Secret name | Value |
|-------------|-------|
| `VAPID_PUBLIC_KEY` | the `publicKey` from step 1 |
| `VAPID_PRIVATE_KEY` | the `privateKey` from step 1 |
| `VAPID_SUBJECT` | `mailto:ops@rastrum.org` (must be `mailto:` or `https://` per RFC 8292) |

Or via `gh` CLI (requires `gh` to be authenticated with repo write access):

```bash
gh secret set VAPID_PUBLIC_KEY   # paste publicKey when prompted
gh secret set VAPID_PRIVATE_KEY  # paste privateKey when prompted
gh secret set VAPID_SUBJECT      # paste mailto:ops@rastrum.org
```

### Step 3 — Set the client-exposed env var (static bundle)

The browser needs the public key embedded at build time:

```bash
gh secret set PUBLIC_VAPID_PUBLIC_KEY  # same value as VAPID_PUBLIC_KEY
```

> ⚠️ This must be the **exact same string** as `VAPID_PUBLIC_KEY`. Any mismatch will cause the browser to pin subscriptions to a key that the EF does not recognise, and every push will return 401 or 404.

### Step 4 — Deploy the Edge Function and rebuild the static bundle

Secrets don't take effect until the EF is redeployed:

```bash
gh workflow run deploy-functions.yml --ref main -f function=kairos-fire
gh workflow run deploy.yml --ref main
gh run watch
```

### Step 5 — Verify

```bash
curl -sS -X POST \
  https://reppvlqejgoqvitturxp.supabase.co/functions/v1/kairos-fire \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: { "sent": 0, "candidates": 0, "errored": 0, "total": <n> }
# NOT expected: { "error": "vapid_unconfigured", "sent": 0 }
```

If the response is `vapid_unconfigured`, the secrets did not reach the EF — re-check the Supabase dashboard Secrets list and redeploy.

**End-to-end smoke test:**

1. Sign in at `/profile/notifications/` (EN) or `/perfil/notificaciones/` (ES).
2. Toggle on Kairos golden-hour notifications — the browser must prompt for permission, call `pushManager.subscribe()` with `PUBLIC_VAPID_PUBLIC_KEY`, and upsert a row in `push_subscriptions`.
3. Verify the row exists:
   ```sql
   SELECT user_id, endpoint, created_at
     FROM public.push_subscriptions
    ORDER BY created_at DESC
    LIMIT 5;
   ```
4. Force a test push (out-of-window):
   ```sql
   UPDATE public.kairos_subscriptions
      SET last_sent_at = NULL
    WHERE user_id = '<your-uuid>' AND kind = 'golden_hour';
   ```
   Then run the `curl` above again. Expect `"sent": 1` and a push notification rendered by the SW.

---

## Key rotation (yearly hygiene or after suspected leak)

Follow the **same 4 steps** above with newly generated keys. Additional notes:

- **Existing subscriptions survive rotation** — the browser-side endpoint (`PushSubscription.endpoint`) is independent of the VAPID key. However, the **browser-side `applicationServerKey`** (the public key used at subscribe time) is pinned to the old public key. After rotation:
  - The next push attempt to each stale subscription returns **401 Unauthorized** from the push service.
  - The `kairos-fire` EF auto-deletes 401 and 410 endpoints from `push_subscriptions`.
  - Users see the in-app toast: *"Notifications re-subscribed required after operator key rotation."* and must re-toggle on `/profile/notifications/`.
- **Force-clear stale rows** (optional — EF reaps on the next 15-min tick anyway):
  ```sql
  DELETE FROM public.push_subscriptions;
  ```
- **Cloudflare Pages caching** — `PUBLIC_VAPID_PUBLIC_KEY` is baked in at build time. Updating the GitHub secret only takes effect after a fresh build+deploy via `deploy.yml`. Do not skip the redeploy step.

---

## Secrets inventory for `kairos-fire`

The following env vars must ALL be set for the `kairos-fire` EF to operate:

| Secret | Surface | Description |
|--------|---------|-------------|
| `VAPID_PUBLIC_KEY` | Supabase Vault (EF) | P-256 public key, base64url |
| `VAPID_PRIVATE_KEY` | Supabase Vault (EF) | P-256 private key, base64url |
| `VAPID_SUBJECT` | Supabase Vault (EF) | `mailto:` or `https://` contact URI (RFC 8292) |
| `CRON_SECRET` | Supabase Vault (EF) + GitHub Secrets | Guards the POST endpoint against unauthenticated calls |
| `PUBLIC_VAPID_PUBLIC_KEY` | GitHub Secrets (build) | Same value as `VAPID_PUBLIC_KEY`; embedded in static bundle for browser `pushManager.subscribe()` |

---

## SW registration

The Service Worker (`public/sw.js`) must include a `push` event listener. The public key is read from the page-level meta tag or injected at build time via `import.meta.env.PUBLIC_VAPID_PUBLIC_KEY`. Verify the import is present:

```js
// public/sw.js (excerpt)
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Rastrum', {
      body: data.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url ?? '/' },
    })
  );
});
```

---

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{ "error": "vapid_unconfigured" }` | `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` missing on the EF | Re-set Supabase Vault secrets and redeploy `kairos-fire` |
| Push 401 from FCM/Mozilla | `VAPID_SUBJECT` not a valid `mailto:` or `https://` URI, or public/private keys are mismatched | Verify `VAPID_SUBJECT` format; regenerate the pair with `npx web-push generate-vapid-keys --json` |
| Push 410 Gone (subscription dead) | Browser uninstalled the SW or user revoked permission | EF auto-deletes 404/410 endpoints; no action needed |
| No `push_subscriptions` row after opt-in | `PUBLIC_VAPID_PUBLIC_KEY` missing or doesn't match `VAPID_PUBLIC_KEY` | Re-set the GitHub secret to the same value and redeploy `deploy.yml` |
| `errored` > 0 with 5xx | Transient FCM/Mozilla outage | Retry on the next 15-min tick; EF does not queue |
| Push fires `sent: 1` but no notification arrives | SW push event listener not wired, or SW version stale | Check `public/sw.js` for the `push` listener; force-update the SW |

---

## Cross-links

- Full kairos pipeline: [`kairos-prompts.md`](kairos-prompts.md)
- CRON_SECRET rotation (parallel procedure): [`cron-secret-rotation.md`](cron-secret-rotation.md)
- Module spec: [`../specs/modules/34-kairos-prompts.md`](../specs/modules/34-kairos-prompts.md)
- Parent feature PR: [#777](https://github.com/ArtemioPadilla/rastrum/pull/777)
- RFC 8292: <https://datatracker.ietf.org/doc/html/rfc8292>
