/**
 * PR14 unit tests for the webhook _meta envelope helper. Mirrors the
 * shape that dispatch_admin_webhooks() stamps into every signed body
 * so receivers can dedupe + reject stale replays.
 *
 * The pure helper lives at supabase/functions/admin/_shared/webhook-meta.ts
 * — no Deno-only imports, so Vitest can exercise it directly.
 */
import { describe, it, expect } from 'vitest';
import {
  buildWebhookMeta,
  attachMeta,
  isFreshTimestamp,
} from '../../supabase/functions/admin/_shared/webhook-meta';

describe('buildWebhookMeta', () => {
  it('produces a v1 envelope with all required fields', () => {
    const m = buildWebhookMeta({ event: 'user_banned' });
    expect(m.version).toBe(1);
    expect(m.event).toBe('user_banned');
    expect(m.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('honours explicit eventId / nonce overrides', () => {
    const m = buildWebhookMeta({
      event: 'user_banned',
      eventId: 'fixed-event',
      nonce: 'fixed-nonce',
    });
    expect(m.event_id).toBe('fixed-event');
    expect(m.nonce).toBe('fixed-nonce');
  });

  it('uses the provided now for the timestamp', () => {
    const fixed = new Date('2026-04-29T17:32:11Z');
    const m = buildWebhookMeta({ event: 'user_banned', now: fixed });
    expect(m.timestamp).toBe('2026-04-29T17:32:11Z');
  });

  it('drops sub-second precision so the receiver sees a fixed-width string', () => {
    const fixed = new Date('2026-04-29T17:32:11.123Z');
    const m = buildWebhookMeta({ event: 'role_granted', now: fixed });
    expect(m.timestamp.endsWith('Z')).toBe(true);
    expect(m.timestamp).not.toMatch(/\./); // no millisecond decimal
  });

  it('produces unique event_id and nonce on successive calls', () => {
    const a = buildWebhookMeta({ event: 'user_banned' });
    const b = buildWebhookMeta({ event: 'user_banned' });
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe('attachMeta', () => {
  it('attaches the _meta envelope without mutating the original payload', () => {
    const meta = buildWebhookMeta({ event: 'user_banned', eventId: 'e', nonce: 'n', now: new Date('2026-04-29T00:00:00Z') });
    const payload = { id: 'audit-row', actor_id: 'a', target_id: 't' };
    const out = attachMeta(payload, meta);
    expect(out._meta).toBe(meta);
    expect(out.id).toBe('audit-row');
    expect((payload as Record<string, unknown>)._meta).toBeUndefined();
  });
});

describe('isFreshTimestamp', () => {
  const now = new Date('2026-04-29T17:32:11Z');

  it('accepts a timestamp inside the tolerance window', () => {
    expect(isFreshTimestamp('2026-04-29T17:30:00Z', 300, now)).toBe(true);
    expect(isFreshTimestamp('2026-04-29T17:34:00Z', 300, now)).toBe(true);
  });

  it('rejects a timestamp older than the tolerance window', () => {
    expect(isFreshTimestamp('2026-04-29T17:20:00Z', 300, now)).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    expect(isFreshTimestamp('2026-04-29T17:40:00Z', 300, now)).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(isFreshTimestamp('not-a-date', 300, now)).toBe(false);
    expect(isFreshTimestamp('', 300, now)).toBe(false);
  });

  it('uses 300s as the default tolerance', () => {
    expect(isFreshTimestamp('2026-04-29T17:30:00Z', undefined, now)).toBe(true);
    expect(isFreshTimestamp('2026-04-29T17:25:00Z', undefined, now)).toBe(false);
  });
});
