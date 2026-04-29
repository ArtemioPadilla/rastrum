import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  webhookId: z.string().uuid(),
});
type Payload = z.infer<typeof Payload>;

export const webhookDeleteHandler: ActionHandler<Payload> = {
  op: 'webhook_delete',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('admin_webhooks')
      .select('id, url, events, enabled')
      .eq('id', payload.webhookId)
      .single();
    if (fetchErr) throw new Error(`webhook.delete fetch: ${fetchErr.message}`);
    if (!before) throw new Error('webhook.delete: webhook not found');

    const { error: deleteErr } = await admin
      .from('admin_webhooks')
      .delete()
      .eq('id', payload.webhookId);
    if (deleteErr) throw new Error(`webhook.delete: ${deleteErr.message}`);

    return {
      before,
      after: null,
      target: { type: 'admin_webhook', id: payload.webhookId },
    };
  },
};
