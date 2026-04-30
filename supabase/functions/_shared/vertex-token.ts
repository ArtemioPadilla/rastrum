/**
 * Google Vertex AI access-token auto-rotation (#155).
 *
 * Vertex tokens last 1 hour; v1 of M32 expected operators to mint
 * the token offline and store the literal `ya29.…` string. This
 * helper instead accepts a service-account JSON envelope, signs a
 * JWT inside the Edge Function, exchanges it at
 * `https://oauth2.googleapis.com/token`, and caches the resulting
 * access token in-process for ~50 minutes (5-minute safety margin).
 *
 * Cache key is `client_email + scope` so multiple beneficiaries on
 * the same Vertex credential share a token. Cache is per-EF-instance
 * (Deno isolates) — there's no cross-instance shared cache; a cold
 * isolate just mints a fresh token.
 */

export interface ServiceAccountJSON {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  /** PEM-encoded RSA private key, with `\n` newlines. */
  private_key: string;
  client_email: string;
  client_id?: string;
  token_uri?: string;
}

export interface VertexAccessToken {
  access_token: string;
  expires_at: number; // ms epoch
}

/**
 * Parse a service-account JSON envelope. Returns null when the
 * required fields are missing or the input is malformed.
 */
export function parseServiceAccount(secret: string): ServiceAccountJSON | null {
  try {
    const o = JSON.parse(secret) as Partial<ServiceAccountJSON>;
    if (o.type !== 'service_account') return null;
    if (typeof o.private_key  !== 'string') return null;
    if (typeof o.client_email !== 'string') return null;
    if (typeof o.project_id   !== 'string') return null;
    return o as ServiceAccountJSON;
  } catch {
    return null;
  }
}

const tokenCache = new Map<string, VertexAccessToken>();
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
/** Refresh when the cached token has < 5 minutes of life left. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Get a valid access token for the supplied service-account.
 * Mints a new one when the cache is empty or the cached token is
 * close to expiry. Throws on JWT signing or token-exchange failure.
 */
export async function getAccessToken(sa: ServiceAccountJSON): Promise<VertexAccessToken> {
  const key = `${sa.client_email}|${SCOPE}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expires_at - Date.now() > REFRESH_MARGIN_MS) {
    return cached;
  }
  const fresh = await mintAccessToken(sa);
  tokenCache.set(key, fresh);
  return fresh;
}

/** Force-refresh — used by validators that need to confirm the
 *  service-account works without consulting the cache. */
export async function mintAccessToken(sa: ServiceAccountJSON): Promise<VertexAccessToken> {
  const now  = Math.floor(Date.now() / 1000);
  const exp  = now + 3600;  // GCP allows up to 1 hour
  const header  = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const payload = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp,
    iat: now,
  };

  const encodedHeader  = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const signature = await rsaSha256Sign(toSign, sa.private_key);
  const jwt = `${toSign}.${signature}`;

  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vertex token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  return {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in * 1000),
  };
}

/** Drop a cached token — used in tests or after a credential is revoked. */
export function clearCache(): void {
  tokenCache.clear();
}

// ── PEM + crypto helpers ────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToDer(pem: string): Uint8Array {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g,   '')
    .replace(/\s+/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function rsaSha256Sign(data: string, pem: string): Promise<string> {
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(data),
  );
  return base64url(new Uint8Array(sig));
}
