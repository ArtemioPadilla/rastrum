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
secret. PR14 added a `_meta` envelope to the body — the HMAC commits
to the entire body string including `_meta`, so a replayed body
provably maps to a specific event id, nonce, and timestamp.

```
X-Rastrum-Signature: sha256=<lowercase hex digest>
X-Rastrum-Event:     <event name>
X-Rastrum-Event-Id:  <uuid — same as body._meta.event_id>
X-Rastrum-Timestamp: <RFC3339 UTC — same as body._meta.timestamp>
X-Rastrum-Nonce:     <uuid — same as body._meta.nonce>
Content-Type:        application/json
```

Body shape (every event):

```json
{
  "id": "<row uuid>",
  "...": "<event-specific fields>",
  "_meta": {
    "event_id":  "9ec6…",
    "event":     "user_banned",
    "timestamp": "2026-04-29T17:32:11Z",
    "nonce":     "1aa4…",
    "version":   1
  }
}
```

The secret is generated server-side at `webhook.create` time as
`whsec_` + 32 random bytes hex-encoded (= 64 hex chars). It's
returned **once** in the create response and is never readable
again. To rotate, delete and recreate.

### Receiver verification (Node example)

```js
import crypto from 'node:crypto';

const TOLERANCE_SECONDS = 300; // 5 minutes
const seenEventIds = new Map(); // swap for Redis SETEX in production

function verifyRastrumWebhook(rawBody, headers, secret) {
  // 1. HMAC signature.
  const [scheme, hex] = (headers['x-rastrum-signature'] ?? '').split('=', 2);
  if (scheme !== 'sha256' || !hex) return { ok: false, reason: 'bad-sig-scheme' };
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (hex.length !== expected.length) return { ok: false, reason: 'bad-sig-length' };
  if (!crypto.timingSafeEqual(Buffer.from(hex), Buffer.from(expected))) {
    return { ok: false, reason: 'bad-sig' };
  }

  const body = JSON.parse(rawBody);
  const meta = body._meta ?? {};

  // 2. Timestamp freshness — guards against captured replays.
  const drift = Math.abs(Date.now() - Date.parse(meta.timestamp));
  if (!Number.isFinite(drift) || drift > TOLERANCE_SECONDS * 1000) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  // 3. Dedupe on event_id. Also confirms the header matches the body
  //    (the header is signed by the body, but consistency is cheap).
  if (!meta.event_id || meta.event_id !== headers['x-rastrum-event-id']) {
    return { ok: false, reason: 'event-id-mismatch' };
  }
  if (seenEventIds.has(meta.event_id)) return { ok: false, reason: 'replay' };
  seenEventIds.set(meta.event_id, Date.now());

  return { ok: true, event: meta.event, body };
}
```

Production receivers should swap the in-memory `seenEventIds` Map for
a Redis SETEX with a 24-hour TTL — anything longer than the
TOLERANCE_SECONDS window is fine.

## Failure handling

`dispatch_admin_webhooks(event, payload)` posts to every enabled
matching subscription via `pg_net.http_post`. The function captures
the bigint request id pg_net returns, persists it on the
`admin_webhook_deliveries` row alongside the per-delivery nonce, and
returns immediately — pg_net is async by design.

A `reconcile-webhook-deliveries` cron at every 2 minutes calls
`public.reconcile_webhook_deliveries()`, which JOINs pending rows
(`status_code IS NULL`) against `net._http_response` and writes back
the resolved `status_code` + any error / timeout flag. The same pass
recomputes each affected webhook's `consecutive_failures` counter
from the latest 10 minutes of deliveries.

Circuit breaker: after **10 consecutive failures**
(`consecutive_failures` counter), the webhook is auto-disabled
(`enabled = false`). Re-enable from the Webhooks tab — the toggle
also resets the counter so the next delivery has a fresh window.

Manual reconcile fire (useful when a receiver was down and you want
to update statuses sooner than the cron's 2-minute cadence):

```sql
SELECT public.reconcile_webhook_deliveries();
```

## Replay protection (v1.1)

The `_meta` envelope above gives receivers everything they need to
reject replays. The `X-Rastrum-Signature` covers the entire body,
including `_meta.event_id`, `_meta.timestamp`, and `_meta.nonce`, so:

* Receiver dedupe on `_meta.event_id` defeats simple replays.
* Timestamp freshness check (recommended ±300s tolerance) defeats
  captured replays once the window passes.
* Per-delivery nonce defeats accidental cross-subscription replays
  (the same body signed for webhook A is rejected by webhook B's
  signature check before nonce matters, but the nonce is also
  surfaced as `X-Rastrum-Nonce` for receivers that want a redundant
  dedupe key).

Receivers that don't implement timestamp + dedupe still get the
benefit of HMAC integrity. Implementing the receiver-side checks is
strongly recommended for any production listener.

## Operator workflow

1. `/console/webhooks` (admin only).
2. Fill the "New webhook" form: HTTPS URL + event checkboxes + a
   reason. The subscription's secret is shown **once** — copy it now
   into the receiver's secret manager.
3. Click "Test" on the row to fire a `{test: true}` ping. The recent
   deliveries section shows the response status code.
4. To rotate the secret: delete the subscription, create a new one.
   The receiver gets a fresh secret either way.

## Per-delivery drill-down + replay (PR15)

Each row in the webhooks list has a **Deliveries** button. Clicking it
expands an inline drilldown beneath the row showing the **last 50
deliveries** for that specific webhook. The drilldown is per-row state
so two webhooks can be open at once without filter state bleeding
across.

### Status-code chips

| Status         | Chip color | Meaning                                       |
|----------------|------------|-----------------------------------------------|
| 2xx            | green      | delivered                                     |
| 4xx            | amber      | client error — receiver returned but rejected |
| 5xx            | red        | receiver outage / signature drift             |
| NULL (pending) | zinc       | request fired, response not yet reconciled    |

The reconcile cron (`reconcile-webhook-deliveries`, every 2 min)
flips pending rows to a real status_code; if a row stays pending
longer than that, the receiver is timing out beyond pg_net's
configured deadline.

### Filter chips

Inside each drilldown: `All / Successful / Failed / Pending`.
Successful = 2xx; Failed = 4xx + 5xx; Pending = no status_code yet.

### Nonce copy

Each delivery's nonce is rendered click-to-copy via the Clipboard
API. Useful when correlating a delivery to a receiver-side dedupe log
or a `_meta.nonce` value from an actual payload capture.

### Replay last delivery

The **Replay last delivery** button at the top of each drilldown
fires the `webhook.replay_delivery` admin handler. Server-side:

1. Loads the source delivery row + the parent webhook.
2. Strips any prior `_meta` envelope from the source body.
3. Builds a fresh envelope with new `event_id`, `nonce`, `timestamp`,
   and a `replay_of: <source_delivery_id>` pointer.
4. HMAC-signs the body with the parent webhook's current secret.
5. POSTs synchronously (replay is rare + ad-hoc, so we capture the
   response inline rather than via `pg_net`).
6. Inserts a fresh `admin_webhook_deliveries` row with the new
   nonce + status_code + (if any) error.
7. Writes an `admin_audit` row with `op = 'webhook_replay'` and
   `details: { source_delivery_id, new_event_id }`.

The new envelope's `replay_of` pointer lets the receiver correlate
the two sends if it cares about audit-of-audit.
