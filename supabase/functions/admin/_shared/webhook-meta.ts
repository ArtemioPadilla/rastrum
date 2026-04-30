/**
 * PR14 webhook replay-protection helpers.
 *
 * The authoritative dispatch path lives in `dispatch_admin_webhooks()`
 * (Postgres SECURITY DEFINER function) — pg_net is the cheapest async
 * HTTP client we have for the trigger fan-out. This TypeScript helper
 * mirrors the same `_meta` block shape so:
 *
 *   1. The webhook.test handler (which fires a synchronous probe POST
 *      from Deno) builds the same _meta envelope receivers expect.
 *   2. Unit tests can exercise the meta builder without needing a live
 *      Postgres connection.
 *
 * Receivers verify by:
 *   * timing-safe comparing X-Rastrum-Signature against
 *     hex(hmac_sha256(rawBody, secret))
 *   * deduping on _meta.event_id
 *   * rejecting when |now - parse(_meta.timestamp)| > 5 minutes
 */

export interface WebhookMeta {
  event_id: string;
  event: string;
  timestamp: string;
  nonce: string;
  version: 1;
}

export function buildWebhookMeta(input: {
  event: string;
  eventId?: string;
  nonce?: string;
  now?: Date;
}): WebhookMeta {
  const now = input.now ?? new Date();
  return {
    event_id: input.eventId ?? cryptoRandomId(),
    event: input.event,
    timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce: input.nonce ?? cryptoRandomId(),
    version: 1,
  };
}

export function attachMeta<T extends Record<string, unknown>>(
  payload: T,
  meta: WebhookMeta,
): T & { _meta: WebhookMeta } {
  return { ...payload, _meta: meta };
}

/**
 * Returns true when `timestampIso` is within `toleranceSeconds` of
 * `now`. Exposed so receiver-side libraries can reuse the same
 * tolerance window we recommend in the runbook (default 300s = 5 min).
 */
export function isFreshTimestamp(
  timestampIso: string,
  toleranceSeconds = 300,
  now: Date = new Date(),
): boolean {
  const t = Date.parse(timestampIso);
  if (Number.isNaN(t)) return false;
  return Math.abs(now.getTime() - t) <= toleranceSeconds * 1000;
}

function cryptoRandomId(): string {
  // Web Crypto's randomUUID is in Deno + Node 22; both runtimes that
  // import this file have it. No fallback needed.
  return crypto.randomUUID();
}
