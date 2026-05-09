/**
 * VAPID-authenticated payload-less Web Push. Shared between
 * `streak-push` and `kairos-fire` Edge Functions.
 *
 * The bare minimum to satisfy the Voluntary Application Server
 * Identification protocol:
 *   1. ES256 JWT with `aud` (origin of the push endpoint), `exp`,
 *      `sub` (operator contact mailto:).
 *   2. `Authorization: vapid t=<jwt>, k=<public-key-base64url>` header.
 *
 * We do NOT encrypt a payload — sending an empty body is valid Web Push,
 * and the SW renders fixed bilingual copy for each notification kind.
 * That keeps this helper tiny (no AES-128-GCM / ECDH / HKDF) and the
 * SW deterministic.
 */

function b64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const norm = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function importVapidPrivateKey(
  privateKeyB64Url: string,
  publicKeyB64Url: string,
): Promise<CryptoKey> {
  const priv = b64UrlDecode(privateKeyB64Url);
  const pub = b64UrlDecode(publicKeyB64Url);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be uncompressed (65 bytes, starts with 0x04)');
  }
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: b64UrlEncode(priv),
    x: b64UrlEncode(x),
    y: b64UrlEncode(y),
    ext: true,
  };
  return await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
}

async function signVapidJwt(
  privateKey: CryptoKey,
  audience: string,
  subject: string,
  ttlSeconds = 12 * 3600,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: subject,
  };
  const headerB64 = b64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = b64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64UrlEncode(sig)}`;
}

export async function sendPushNoPayload(
  endpoint: string,
  privateKey: CryptoKey,
  publicKeyB64Url: string,
  subject: string,
): Promise<{ ok: boolean; status: number }> {
  const aud = new URL(endpoint).origin;
  const jwt = await signVapidJwt(privateKey, aud, subject);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${publicKeyB64Url}`,
      'TTL': '86400',
      'Content-Length': '0',
    },
  });
  return { ok: res.ok, status: res.status };
}
