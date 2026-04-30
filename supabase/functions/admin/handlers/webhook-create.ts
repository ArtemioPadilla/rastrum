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
  url:    z.string().url().regex(/^https:\/\//, { message: 'webhook URL must be https://' }),
  events: z.array(z.enum(KNOWN_EVENTS)).min(1),
});
type Payload = z.infer<typeof Payload>;

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return `whsec_${hex}`;
}

export const webhookCreateHandler: ActionHandler<Payload> = {
  op: 'webhook_create',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, actor, _reason) {
    const secret = generateSecret();
    const { data: inserted, error } = await admin
      .from('admin_webhooks')
      .insert({
        url:        payload.url,
        events:     payload.events,
        secret,
        created_by: actor.id,
      })
      .select('id, url, events, enabled, created_at')
      .single();
    if (error) throw new Error(`webhook.create: ${error.message}`);

    return {
      before: null,
      after: inserted,
      target: { type: 'admin_webhook', id: (inserted as { id: string }).id },
      // The secret is returned ONCE here. The console UI shows it once, then
      // it's never readable again — admins must rotate by re-creating.
      result: { id: (inserted as { id: string }).id, secret },
    };
  },
};
