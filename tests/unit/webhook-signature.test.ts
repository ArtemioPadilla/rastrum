/**
 * Unit test for the HMAC-SHA256 webhook signing helper consumed by the
 * webhook.test handler and (logically equivalent to) the SECURITY DEFINER
 * dispatch_admin_webhooks() Postgres function.
 *
 * The helper lives in supabase/functions/admin/_shared/webhook-signature.ts
 * with no Deno-only imports — it uses Web Crypto's crypto.subtle.sign which
 * Node 22 ships natively. Same pattern as audit-export-csv.test.ts.
 *
 * Coverage targets:
 *   1. Stable signature for a fixed (secret, body) pair.
 *   2. Different secrets produce different signatures for the same body.
 *   3. Different bodies produce different signatures for the same secret.
 *   4. Empty-body case is well-defined.
 *   5. Signatures match a known reference vector (computed via OpenSSL CLI).
 *   6. timingSafeEqual rejects mismatched lengths and mismatched content.
 */
import { describe, it, expect } from 'vitest';
import {
  signWebhookBody,
  buildSignatureHeader,
  timingSafeEqual,
} from '../../supabase/functions/admin/_shared/webhook-signature';

describe('signWebhookBody', () => {
  it('returns a 64-char hex string for any input', async () => {
    const sig = await signWebhookBody('secret', '{"k":"v"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same (secret, body) pair', async () => {
    const a = await signWebhookBody('s', 'b');
    const b = await signWebhookBody('s', 'b');
    expect(a).toBe(b);
  });

  it('changes when the secret changes', async () => {
    const a = await signWebhookBody('s1', 'body');
    const b = await signWebhookBody('s2', 'body');
    expect(a).not.toBe(b);
  });

  it('changes when the body changes', async () => {
    const a = await signWebhookBody('secret', 'body1');
    const b = await signWebhookBody('secret', 'body2');
    expect(a).not.toBe(b);
  });

  it('handles an empty body', async () => {
    const sig = await signWebhookBody('secret', '');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the reference HMAC-SHA256 vector for ("key", "")', async () => {
    // Reference: openssl dgst -sha256 -hmac key </dev/null
    // → 5d5d139563c95b5967b9bd9a8c9b233a9dedb45072794cd232dc1b74832607d0
    const sig = await signWebhookBody('key', '');
    expect(sig).toBe('5d5d139563c95b5967b9bd9a8c9b233a9dedb45072794cd232dc1b74832607d0');
  });
});

describe('buildSignatureHeader', () => {
  it('prefixes the hex with sha256=', () => {
    expect(buildSignatureHeader('abc123')).toBe('sha256=abc123');
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for strings of different length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns false for same-length but different strings', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
