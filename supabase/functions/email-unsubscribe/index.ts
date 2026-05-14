/**
 * /functions/v1/email-unsubscribe — public (no JWT) unsubscribe endpoint.
 *
 * GET /email-unsubscribe?token=<hmac>&uid=<user_id>
 *
 * Validates HMAC-SHA256(uid + 'weekly-digest', UNSUBSCRIBE_SECRET) against token.
 * On success: sets email_notifications_enabled = false for the user.
 * Returns an HTML confirmation page or redirects to /en/profile/notifications.
 *
 * Issue #868: Weekly email digest for inactive users.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function validateHmac(uid: string, token: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(uid + 'weekly-digest');

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Convert hex token back to bytes
    const tokenBytes = new Uint8Array(
      token.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []
    );

    return await crypto.subtle.verify('HMAC', cryptoKey, tokenBytes, msgData);
  } catch {
    return false;
  }
}

function htmlPage(lang: string, success: boolean): string {
  const isEs = lang === 'es';
  const title = success
    ? (isEs ? 'Suscripción cancelada' : 'Unsubscribed')
    : (isEs ? 'Enlace inválido' : 'Invalid link');
  const heading = success
    ? (isEs ? '✅ Te has dado de baja' : '✅ You\'ve been unsubscribed')
    : (isEs ? '❌ Enlace inválido o expirado' : '❌ Invalid or expired link');
  const body = success
    ? (isEs
      ? 'Ya no recibirás el resumen semanal de Rastrum. Puedes volver a activarlo desde tu perfil.'
      : 'You will no longer receive the Rastrum weekly digest. You can re-enable it from your profile.')
    : (isEs
      ? 'Este enlace no es válido. Por favor, usa el enlace de tu correo más reciente.'
      : 'This link is not valid. Please use the link from your most recent email.');
  const profileLink = `https://rastrum.org/${lang}/profile/notifications`;
  const profileLabel = isEs ? 'Ir a preferencias' : 'Go to preferences';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Rastrum</title>
  <style>
    body { font-family: sans-serif; background: #f8fafc; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 8px; padding: 40px 32px; max-width: 480px;
            width: 100%; box-shadow: 0 1px 4px rgba(0,0,0,.08); text-align: center; }
    h1 { font-size: 22px; color: #1e293b; margin: 0 0 12px; }
    p { color: #475569; font-size: 15px; line-height: 1.5; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:40px;margin-bottom:8px;">🌿</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <p><a href="${profileLink}">${profileLabel}</a></p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(req: Request): Promise<Response> {
  const reqUrl = new URL(req.url);
  const token = reqUrl.searchParams.get('token') ?? '';
  const uid = reqUrl.searchParams.get('uid') ?? '';
  const lang = reqUrl.searchParams.get('lang') === 'es' ? 'es' : 'en';

  const secret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!token || !uid) {
    return new Response(htmlPage(lang, false), {
      status: 400,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (!secret) {
    console.error('[email-unsubscribe] UNSUBSCRIBE_SECRET not set');
    return new Response(htmlPage(lang, false), {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const valid = await validateHmac(uid, token, secret);
  if (!valid) {
    return new Response(htmlPage(lang, false), {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Valid token — disable notifications
  if (!supabaseUrl || !serviceRole) {
    return new Response(htmlPage(lang, false), {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const db = createClient(supabaseUrl, serviceRole);
  const { error } = await db
    .from('users')
    .update({ email_notifications_enabled: false })
    .eq('id', uid);

  if (error) {
    console.error('[email-unsubscribe] DB update error:', error.message);
    return new Response(htmlPage(lang, false), {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // Redirect to profile/notifications on success
  const redirectUrl = `https://rastrum.org/${lang}/profile/notifications`;
  return new Response(null, {
    status: 302,
    headers: { Location: redirectUrl },
  });
}

serve(handler);
