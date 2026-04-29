import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const KNOWN_EVENTS = [
  'anomaly_created',
  'user_banned',
  'user_unbanned',
  'role_granted',
  'role_revoked',
] as const;

const Payload = z.object({
  webhookId: z.string().uuid(),
  url:       z.string().url().regex(/^https:\/\//).optional(),
  events:    z.array(z.enum(KNOWN_EVENTS)).min(1).optional(),
  enabled:   z.boolean().optional(),
});
type Payload = z.infer<typeof Payload>;

export const webhookUpdateHandler: ActionHandler<Payload> = {
  op: 'webhook_update',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    const { data: before, error: fetchErr } = await admin
      .from('admin_webhooks')
      .select('id, url, events, enabled')
      .eq('id', payload.webhookId)
      .single();
    if (fetchErr) throw new Error(`webhook.update fetch: ${fetchErr.message}`);
    if (!before) throw new Error('webhook.update: webhook not found');

    const update: Record<string, unknown> = {};
    if (payload.url     !== undefined) update.url     = payload.url;
    if (payload.events  !== undefined) update.events  = payload.events;
    if (payload.enabled !== undefined) {
      update.enabled = payload.enabled;
      // Re-enabling resets the consecutive-failures counter so the next
      // delivery has a fresh circuit-breaker window.
      if (payload.enabled === true) update.consecutive_failures = 0;
    }
    if (Object.keys(update).length === 0) {
      return { before, after: before, target: { type: 'admin_webhook', id: payload.webhookId } };
    }

    const { data: after, error: updateErr } = await admin
      .from('admin_webhooks')
      .update(update)
      .eq('id', payload.webhookId)
      .select('id, url, events, enabled, consecutive_failures, last_delivery_at')
      .single();
    if (updateErr) throw new Error(`webhook.update: ${updateErr.message}`);

    return {
      before,
      after,
      target: { type: 'admin_webhook', id: payload.webhookId },
    };
  },
};
