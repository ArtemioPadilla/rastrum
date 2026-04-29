# Admin webhooks

Outbound HMAC-SHA256-signed webhooks for external integrations
(SIEM ingest, Slack notifiers, custom dashboards). Ships in PR13 with
full CRUD + a Test affordance.

## Events

v1 emits five event types. Adding a new one requires extending the
trigger function on `admin_audit` (see schema lines around
`admin_audit_dispatch_trigger`):

| Event | Source trigger | Payload (partial) |
|---|---|---|
| `anomaly_created` | AFTER INSERT on `admin_anomalies` | `{kind, actor_id, window_start, event_count, details, …}` |
| `user_banned` | `admin_audit` op=`user_ban` | `{actor_id, target_id, reason, before, after, …}` |
| `user_unbanned` | `admin_audit` op=`user_unban` | same shape |
| `role_granted` | `admin_audit` op=`role_grant` | same shape |
| `role_revoked` | `admin_audit` op=`role_revoke` | same shape |

The body is the row itself (`to_jsonb(NEW)`), so receivers see the
full audit context for non-anomaly events.

## Signing

Every body is signed with HMAC-SHA256 using the per-subscription
secret. The signature lives in:

```
X-Rastrum-Signature: sha256=<lowercase hex digest>
X-Rastrum-Event:     <event name>
Content-Type:        application/json
```

The secret is generated server-side at `webhook.create` time as
`whsec_` + 32 random bytes hex-encoded (= 64 hex chars). It's
returned **once** in the create response and is never readable
again. To rotate, delete and recreate.

### Receiver verification (Node example)

```js
import crypto from 'node:crypto';

function verifyRastrumSignature(rawBody, header, secret) {
  const [scheme, hex] = (header ?? '').split('=', 2);
  if (scheme !== 'sha256' || !hex) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  // Constant-time compare to avoid timing leaks.
  if (hex.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(expected));
}
```

## Failure handling

`dispatch_admin_webhooks(event, payload)` posts to every enabled
matching subscription via `pg_net.http_post`. Each delivery writes a
row to `admin_webhook_deliveries` with the resolved `status_code`.

Circuit breaker: after **10 consecutive failures**
(`consecutive_failures` counter), the webhook is auto-disabled
(`enabled = false`). Re-enable from the Webhooks tab — the toggle
also resets the counter so the next delivery has a fresh window.

## Replay protection (caveat)

v1 does **not** include a timestamp in the signed body or a nonce
header — receivers should still verify the signature, but cannot
reject replayed messages on their own. For now, the recommendation
is to ignore duplicate event ids on the receiver side (every payload
that goes through `admin_audit` includes `id` and `created_at`;
anomalies have `id` and `created_at`). v1.1 may add an explicit
`X-Rastrum-Timestamp` + a `tolerance` window to allow strict replay
rejection.

## Operator workflow

1. `/console/webhooks` (admin only).
2. Fill the "New webhook" form: HTTPS URL + event checkboxes + a
   reason. The subscription's secret is shown **once** — copy it now
   into the receiver's secret manager.
3. Click "Test" on the row to fire a `{test: true}` ping. The recent
   deliveries section shows the response status code.
4. To rotate the secret: delete the subscription, create a new one.
   The receiver gets a fresh secret either way.
