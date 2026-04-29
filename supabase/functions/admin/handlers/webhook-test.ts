import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';
import { signWebhookBody, buildSignatureHeader } from '../_shared/webhook-signature.ts';

const Payload = z.object({
  webhookId: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

export const webhookTestHandler: ActionHandler<Payload> = {
  op: 'webhook_test',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: webhook, error: fetchErr } = await admin
      .from('admin_webhooks')
      .select('id, url, secret, enabled')
      .eq('id', payload.webhookId)
      .single();
    if (fetchErr) throw new Error(`webhook.test fetch: ${fetchErr.message}`);
    if (!webhook) throw new Error('webhook.test: webhook not found');

    const body = JSON.stringify({ test: true, webhook_id: webhook.id, sent_at: new Date().toISOString() });
    const sig = await signWebhookBody(webhook.secret as string, body);

    let statusCode: number | null = null;
    let errorText: string | null = null;
    try {
      const res = await fetch(webhook.url as string, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-rastrum-signature': buildSignatureHeader(sig),
          'x-rastrum-event': 'test',
        },
        body,
      });
      statusCode = res.status;
    } catch (err) {
      errorText = (err as Error).message;
    }

    await admin.from('admin_webhook_deliveries').insert({
      webhook_id: webhook.id,
      event: 'test',
      payload: JSON.parse(body),
      status_code: statusCode,
      error: errorText,
    });

    return {
      before: null,
      after: { status_code: statusCode, error: errorText },
      target: { type: 'admin_webhook', id: webhook.id as string },
      result: { statusCode, error: errorText },
    };
  },
};
