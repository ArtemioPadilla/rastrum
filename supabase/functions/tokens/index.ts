/**
 * /functions/v1/tokens — Create and revoke personal API tokens.
 *
 * POST /tokens          → create new token (returns raw token once)
 * DELETE /tokens/:id    → revoke token
 * GET /tokens           → list own tokens (prefix + metadata, no raw token)
 *
 * See docs/specs/modules/14-user-api-tokens.md
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `rst_${hex}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Authenticate caller via session JWT
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401);

  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(jwt);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean); // ['tokens', ':id']
  const tokenId = segments[1]; // optional

  // ── GET /tokens ── list own tokens
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_api_tokens')
      .select('id, name, prefix, scopes, last_used_at, expires_at, created_at')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── POST /tokens ── create new token
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const {
      name = 'API Token',
      scopes = ['observe', 'identify', 'export'],
      expires_in_days,
    } = body;

    // Validate scopes
    const ALLOWED_SCOPES = ['observe', 'identify', 'export', 'read_all'];
    const invalidScopes = scopes.filter((s: string) => !ALLOWED_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      return json({ error: `Invalid scopes: ${invalidScopes.join(', ')}` }, 400);
    }

    const raw = generateToken();
    const token_hash = await sha256(raw);
    const prefix = raw.slice(0, 12); // "rst_a1b2c3d4"

    const expires_at = expires_in_days
      ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
      : null;

    const { data, error } = await supabase
      .from('user_api_tokens')
      .insert({
        user_id: user.id,
        name,
        token_hash,
        prefix,
        scopes,
        expires_at,
      })
      .select('id, name, prefix, scopes, expires_at, created_at')
      .single();

    if (error) return json({ error: error.message }, 500);

    // Return raw token ONCE — never stored, never logged
    return json({ ...data, token: raw }, 201);
  }

  // ── DELETE /tokens/:id ── revoke
  if (req.method === 'DELETE' && tokenId) {
    const { error } = await supabase
      .from('user_api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('user_id', user.id); // ensure ownership

    if (error) return json({ error: error.message }, 500);
    return json({ revoked: true });
  }

  return json({ error: 'Not found' }, 404);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
