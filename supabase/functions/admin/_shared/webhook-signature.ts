/**
 * HMAC-SHA256 signing helper for outbound admin webhooks.
 *
 * Receivers verify by recomputing hex(hmac_sha256(body, secret)) and
 * comparing against the X-Rastrum-Signature header (which is shaped
 * 'sha256=<hex>'). The pure function lives here so it can be unit-tested
 * from Vitest without importing any Deno-only globals.
 */

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function signWebhookBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return bytesToHex(new Uint8Array(sig));
}

export function buildSignatureHeader(hex: string): string {
  return `sha256=${hex}`;
}

/**
 * Constant-time string comparison. Avoids early-exit timing leaks when
 * receivers verify our signatures (or vice-versa); use this rather than
 * `===` for any signature compare.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
