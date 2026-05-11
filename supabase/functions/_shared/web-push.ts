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

/**
 * Build an RFC 8291 (AES-128-GCM + ECDH) encrypted Web Push payload.
 *
 * Algorithm:
 *   1. Generate ephemeral ECDH key pair (P-256)
 *   2. ECDH shared secret with subscriber's p256dh public key
 *   3. HKDF to derive Content-Encryption-Key (16 bytes) and IV (12 bytes)
 *      from the shared secret + PRK, per RFC 8291 §3.3
 *   4. AES-128-GCM encrypt the padded plaintext
 *
 * Returns an object with:
 *   - ciphertext: Uint8Array of the encrypted payload
 *   - serverPublicKey: Uint8Array uncompressed ephemeral public key (65 bytes)
 *   - salt: Uint8Array 16-byte random salt
 *
 * If anything fails, returns null so the caller can fall back to payload-less push.
 */
export async function buildEncryptedPayload(
  p256dhB64Url: string,
  authB64Url: string,
  payloadObj: { title: string; body: string; url?: string },
): Promise<{ ciphertext: Uint8Array; serverPublicKey: Uint8Array; salt: Uint8Array } | null> {
  try {
    // ── 1. Import subscriber public key (receiver key) ────────────────────
    const receiverPubBytes = b64UrlDecode(p256dhB64Url);
    const receiverKey = await crypto.subtle.importKey(
      'raw',
      receiverPubBytes,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );

    // ── 2. Generate ephemeral sender ECDH key pair ────────────────────────
    const senderPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const senderPubJwk = await crypto.subtle.exportKey('jwk', senderPair.publicKey);
    // Convert JWK x/y to uncompressed 65-byte point
    const senderX = b64UrlDecode(senderPubJwk.x!);
    const senderY = b64UrlDecode(senderPubJwk.y!);
    const serverPublicKey = new Uint8Array(65);
    serverPublicKey[0] = 0x04;
    serverPublicKey.set(senderX, 1);
    serverPublicKey.set(senderY, 33);

    // ── 3. ECDH shared secret ────────────────────────────────────────────
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: receiverKey },
      senderPair.privateKey,
      256,
    );
    const sharedSecret = new Uint8Array(sharedBits);

    // ── 4. Random salt (16 bytes) ────────────────────────────────────────
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // ── 5. HKDF to derive PRK (RFC 8291 §3.3) ────────────────────────────
    // auth_info = "Content-Encoding: auth\0"
    const authSecret = b64UrlDecode(authB64Url);
    const enc = new TextEncoder();
    const authInfo = enc.encode('Content-Encoding: auth\x00');
    const ikm = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
    // PRK = HKDF-Extract(auth_secret, shared_secret)
    const prkBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo },
      ikm,
      256,
    );

    // context = 0x00 || receiver_key_length (2 bytes) || receiver_key
    //                 || sender_key_length (2 bytes)   || sender_key
    const ctx = new Uint8Array(1 + 2 + receiverPubBytes.length + 2 + serverPublicKey.length);
    let pos = 0;
    ctx[pos++] = 0x00; // label separator
    ctx[pos++] = 0x00; ctx[pos++] = receiverPubBytes.length;
    ctx.set(receiverPubBytes, pos); pos += receiverPubBytes.length;
    ctx[pos++] = 0x00; ctx[pos++] = serverPublicKey.length;
    ctx.set(serverPublicKey, pos);

    // CEK = HKDF-Expand(PRK, "Content-Encoding: aesgcm" + context, 16 bytes)
    const cekInfo = new Uint8Array(enc.encode('Content-Encoding: aesgcm\x00').length + ctx.length);
    cekInfo.set(enc.encode('Content-Encoding: aesgcm\x00'), 0);
    cekInfo.set(ctx, enc.encode('Content-Encoding: aesgcm\x00').length);

    const prkKey = await crypto.subtle.importKey('raw', prkBits, 'HKDF', false, ['deriveBits']);
    const cekBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: cekInfo },
      prkKey,
      128,
    );

    // IV = HKDF-Expand(PRK, "Content-Encoding: nonce" + context, 12 bytes)
    const nonceInfo = new Uint8Array(enc.encode('Content-Encoding: nonce\x00').length + ctx.length);
    nonceInfo.set(enc.encode('Content-Encoding: nonce\x00'), 0);
    nonceInfo.set(ctx, enc.encode('Content-Encoding: nonce\x00').length);

    const ivBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: nonceInfo },
      prkKey,
      96,
    );

    // ── 6. AES-128-GCM encrypt ───────────────────────────────────────────
    const plaintext = enc.encode(JSON.stringify(payloadObj));
    // Add 2-byte padding length header (0 = no padding) per RFC 8291
    const padded = new Uint8Array(2 + plaintext.length);
    padded[0] = 0x00; padded[1] = 0x00; // padding_length = 0
    padded.set(plaintext, 2);

    const cekKey = await crypto.subtle.importKey(
      'raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt'],
    );
    const ciphertextBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBits), tagLength: 128 },
      cekKey,
      padded,
    );

    return { ciphertext: new Uint8Array(ciphertextBuf), serverPublicKey, salt };
  } catch {
    return null; // fall back to payload-less push
  }
}

/**
 * Send a VAPID-authenticated push with an RFC 8291 encrypted payload.
 * Falls back to payload-less push if encryption fails.
 */
export async function sendPushWithPayload(
  endpoint: string,
  privateKey: CryptoKey,
  publicKeyB64Url: string,
  subject: string,
  p256dhB64Url: string,
  authB64Url: string,
  payload: { title: string; body: string; url?: string },
): Promise<{ ok: boolean; status: number }> {
  const encrypted = await buildEncryptedPayload(p256dhB64Url, authB64Url, payload);
  if (!encrypted) {
    // Encryption failed — fall back to payload-less push (existing behavior).
    return sendPushNoPayload(endpoint, privateKey, publicKeyB64Url, subject);
  }

  const { ciphertext, serverPublicKey, salt } = encrypted;
  const aud = new URL(endpoint).origin;
  const jwt = await signVapidJwt(privateKey, aud, subject);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${publicKeyB64Url}`,
      'TTL': '86400',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aesgcm',
      'Crypto-Key': `dh=${b64UrlEncode(serverPublicKey)}; vapid`,
      'Encryption': `salt=${b64UrlEncode(salt)}`,
      'Content-Length': String(ciphertext.length),
    },
    body: ciphertext,
  });
  return { ok: res.ok, status: res.status };
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
