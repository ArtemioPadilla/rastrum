import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';
import { signWebhookBody, buildSignatureHeader } from '../_shared/webhook-signature.ts';

const Payload = z.object({
  deliveryId: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

interface SourceDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
}

interface ParentWebhook {
  id: string;
  url: string;
  secret: string;
  enabled: boolean;
}

export const webhookReplayDeliveryHandler: ActionHandler<Payload> = {
  op: 'webhook_replay',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: source, error: fetchErr } = await admin
      .from('admin_webhook_deliveries')
      .select('id, webhook_id, event, payload')
      .eq('id', payload.deliveryId)
      .maybeSingle();
    if (fetchErr) throw new Error(`webhook.replay_delivery fetch: ${fetchErr.message}`);
    if (!source) throw new Error('webhook.replay_delivery: source delivery not found');

    const sourceRow = source as unknown as SourceDelivery;

    const { data: webhook, error: parentErr } = await admin
      .from('admin_webhooks')
      .select('id, url, secret, enabled')
      .eq('id', sourceRow.webhook_id)
      .maybeSingle();
    if (parentErr) throw new Error(`webhook.replay_delivery parent: ${parentErr.message}`);
    if (!webhook) throw new Error('webhook.replay_delivery: parent webhook missing');

    const parent = webhook as unknown as ParentWebhook;

    // Strip any prior _meta envelope from the source body so the replay
    // gets a fresh event_id + nonce + timestamp. dispatch_admin_webhooks()
    // builds the same envelope when sending live; we mirror it here.
    const innerPayload: Record<string, unknown> = { ...(sourceRow.payload ?? {}) };
    delete innerPayload._meta;

    const eventId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const signedPayload: Record<string, unknown> = {
      ...innerPayload,
      _meta: {
        event_id: eventId,
        event: sourceRow.event,
        timestamp,
        nonce,
        version: 1,
        replay_of: sourceRow.id,
      },
    };
    const body = JSON.stringify(signedPayload);
    const sig = await signWebhookBody(parent.secret, body);

    let statusCode: number | null = null;
    let errorText: string | null = null;
    try {
      const res = await fetch(parent.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-rastrum-signature': buildSignatureHeader(sig),
          'x-rastrum-event': sourceRow.event,
          'x-rastrum-event-id': eventId,
          'x-rastrum-timestamp': timestamp,
          'x-rastrum-nonce': nonce,
          'x-rastrum-replay': 'true',
        },
        body,
      });
      statusCode = res.status;
    } catch (err) {
      errorText = (err as Error).message;
    }

    const { data: inserted, error: insertErr } = await admin
      .from('admin_webhook_deliveries')
      .insert({
        webhook_id: parent.id,
        event: sourceRow.event,
        payload: signedPayload,
        nonce,
        status_code: statusCode,
        error: errorText,
      })
      .select('id')
      .single();
    if (insertErr) throw new Error(`webhook.replay_delivery insert: ${insertErr.message}`);

    return {
      before: { source_delivery_id: sourceRow.id },
      after: {
        new_delivery_id: (inserted as { id: string }).id,
        new_event_id: eventId,
        status_code: statusCode,
        error: errorText,
      },
      target: { type: 'admin_webhook_delivery', id: (inserted as { id: string }).id },
      result: {
        statusCode,
        error: errorText,
        newDeliveryId: (inserted as { id: string }).id,
        newEventId: eventId,
      },
    };
  },
};
