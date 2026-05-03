import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { detectKind, validateAnthropicCredential } from '../_shared/anthropic-validate.ts';
import { decryptCredential } from '../_shared/sponsorship.ts';

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SPONSORSHIPS_CRON_TOKEN = Deno.env.get('SPONSORSHIPS_CRON_TOKEN');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

async function withUser(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse(401, { error: 'no_auth' });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const { data, error } = await supabase.auth.getUser(auth.slice('Bearer '.length));
  if (error || !data.user) return jsonResponse(401, { error: 'invalid_token' });
  return { userId: data.user.id };
}

function withCronToken(req: Request): boolean {
  if (!SPONSORSHIPS_CRON_TOKEN) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${SPONSORSHIPS_CRON_TOKEN}`;
}

const UUID_RE = /^[0-9a-f-]{36}$/;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/sponsorships/, '') || '/';

  // ───────────── Heartbeat (cron-only) ─────────────
  if (req.method === 'POST' && path === '/heartbeat') {
    if (!withCronToken(req)) return jsonResponse(401, { error: 'no_cron_token' });
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const { data: stale } = await supabase
      .from('sponsor_credentials')
      .select('id, vault_secret_id, user_id, label')
      .is('revoked_at', null)
      .or(`validated_at.is.null,validated_at.lt.${sevenDaysAgo}`)
      .limit(50);

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const cred of (stale ?? []) as Array<{ id: string; vault_secret_id: string }>) {
      try {
        const secret = await decryptCredential(supabase, cred.vault_secret_id);
        const result = await validateAnthropicCredential(secret);
        if (result.valid) {
          await supabase.from('sponsor_credentials')
            .update({ validated_at: new Date().toISOString() })
            .eq('id', cred.id);
          results.push({ id: cred.id, ok: true });
        } else {
          await supabase.from('sponsor_credentials')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', cred.id);
          await supabase.from('sponsorships').update({
            status: 'paused', paused_reason: 'cred:invalid', paused_at: new Date().toISOString(),
          }).eq('credential_id', cred.id);
          results.push({ id: cred.id, ok: false, error: result.error });
        }
      } catch (e) {
        results.push({ id: cred.id, ok: false, error: (e as Error).message });
      }
    }
    return jsonResponse(200, { processed: results.length, results });
  }

  // ───────────── User-gated endpoints ─────────────
  const ctx = await withUser(req);
  if (ctx instanceof Response) return ctx;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // POST /credentials
  if (req.method === 'POST' && path === '/credentials') {
    const body = await req.json().catch(() => ({}));
    const { label, secret, provider = 'anthropic' } = body as { label?: string; secret?: string; provider?: string };
    if (!label || !secret) return jsonResponse(400, { error: 'label_and_secret_required' });
    if (label.length < 1 || label.length > 64) return jsonResponse(400, { error: 'label_length_1_64' });

    const kind = detectKind(secret);
    if (!kind) return jsonResponse(400, { error: 'unrecognized_secret_prefix' });

    const validation = await validateAnthropicCredential(secret);
    if (!validation.valid) return jsonResponse(400, { error: 'validation_failed', detail: validation.error });

    const { data: vaultRow, error: vaultErr } = await supabase.rpc('create_vault_secret', {
      p_secret: secret, p_name: `sponsor_credential:${ctx.userId}:${label}`,
    });
    if (vaultErr || !vaultRow) return jsonResponse(500, { error: 'vault_insert_failed', detail: vaultErr?.message });

    const { data: cred, error: insErr } = await supabase
      .from('sponsor_credentials')
      .insert({
        user_id:         ctx.userId,
        provider,
        kind,
        label,
        vault_secret_id: vaultRow as string,
        validated_at:    new Date().toISOString(),
      })
      .select('id, label, provider, kind, validated_at, created_at')
      .single();
    if (insErr) {
      await supabase.rpc('delete_vault_secret', { p_secret_id: vaultRow });
      return jsonResponse(500, { error: 'credential_insert_failed', detail: insErr.message });
    }

    await supabase.from('admin_audit').insert({
      actor_id:    ctx.userId,
      op:          'ai_credential_create',
      target_type: 'sponsor_credential',
      target_id:   cred?.id ?? null,
      reason:      'user_created_credential',
      after:       { label, kind },
    });
    return jsonResponse(201, cred);
  }

  // GET /credentials
  if (req.method === 'GET' && path === '/credentials') {
    const { data, error } = await supabase
      .from('sponsor_credentials')
      .select('id, label, provider, kind, validated_at, last_used_at, revoked_at, created_at')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[sponsorships] GET /credentials failed:', JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }));
      return jsonResponse(500, { error: 'list_failed', detail: error.message, hint: error.hint });
    }
    return jsonResponse(200, data ?? []);
  }

  // POST /credentials/:id/rotate
  {
    const m = path.match(/^\/credentials\/([0-9a-f-]{36})\/rotate$/);
    if (m && req.method === 'POST') {
      const credId = m[1];
      const { data: cred } = await supabase
        .from('sponsor_credentials').select('user_id, vault_secret_id, label')
        .eq('id', credId).single();
      if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) {
        return jsonResponse(404, { error: 'not_found' });
      }
      const body = await req.json().catch(() => ({}));
      const { secret } = body as { secret?: string };
      if (!secret) return jsonResponse(400, { error: 'secret_required' });
      const kind = detectKind(secret);
      if (!kind) return jsonResponse(400, { error: 'unrecognized_secret_prefix' });
      const validation = await validateAnthropicCredential(secret);
      if (!validation.valid) return jsonResponse(400, { error: 'validation_failed', detail: validation.error });

      const { data: newSecretId, error: vaultErr } = await supabase.rpc('create_vault_secret', {
        p_secret: secret,
        p_name: `sponsor_credential:${ctx.userId}:${(cred as { label: string }).label}:rotated:${Date.now()}`,
      });
      if (vaultErr || !newSecretId) return jsonResponse(500, { error: 'vault_insert_failed', detail: vaultErr?.message });

      const { error: updErr } = await supabase
        .from('sponsor_credentials')
        .update({ vault_secret_id: newSecretId, kind, validated_at: new Date().toISOString() })
        .eq('id', credId);
      if (updErr) return jsonResponse(500, { error: 'rotate_failed', detail: updErr.message });

      await supabase.rpc('delete_vault_secret', { p_secret_id: (cred as { vault_secret_id: string }).vault_secret_id });

      await supabase
        .from('sponsorships')
        .update({ status: 'active', paused_reason: null, paused_at: null, updated_at: new Date().toISOString() })
        .eq('credential_id', credId)
        .eq('status', 'paused')
        .eq('paused_reason', 'cred:invalid');

      await supabase.from('admin_audit').insert({
        actor_id:    ctx.userId,
        op:          'ai_credential_rotate',
        target_type: 'sponsor_credential',
        target_id:   credId,
        reason:      'user_rotated_credential',
      });
      return jsonResponse(200, { ok: true });
    }
  }

  // DELETE /credentials/:id
  {
    const m = path.match(/^\/credentials\/([0-9a-f-]{36})$/);
    if (m && req.method === 'DELETE') {
      const credId = m[1];
      const { data: cred } = await supabase
        .from('sponsor_credentials').select('user_id, vault_secret_id')
        .eq('id', credId).single();
      if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) {
        return jsonResponse(404, { error: 'not_found' });
      }
      await supabase.from('sponsorships').update({
        status: 'paused', paused_reason: 'credential_revoked', paused_at: new Date().toISOString(),
      }).eq('credential_id', credId);
      await supabase.from('sponsor_credentials')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', credId);
      await supabase.rpc('delete_vault_secret', { p_secret_id: (cred as { vault_secret_id: string }).vault_secret_id });
      await supabase.from('admin_audit').insert({
        actor_id:    ctx.userId,
        op:          'ai_credential_revoke',
        target_type: 'sponsor_credential',
        target_id:   credId,
        reason:      'user_revoked_credential',
      });
      return jsonResponse(204, {});
    }
  }

  // POST /sponsorships
  if (req.method === 'POST' && path === '/sponsorships') {
    const body = await req.json().catch(() => ({}));
    const {
      beneficiary_username, credential_id,
      monthly_call_cap = 200, priority = 100, sponsor_public = true,
      provider = 'anthropic',
    } = body as {
      beneficiary_username?: string; credential_id?: string;
      monthly_call_cap?: number; priority?: number; sponsor_public?: boolean;
      provider?: string;
    };
    if (!beneficiary_username || !credential_id) return jsonResponse(400, { error: 'missing_fields' });
    if (monthly_call_cap < 1 || monthly_call_cap > 10000) return jsonResponse(400, { error: 'cap_out_of_range' });
    if (!UUID_RE.test(credential_id)) return jsonResponse(400, { error: 'invalid_credential_id' });

    const { data: beneficiary } = await supabase
      .from('users').select('id').eq('username', beneficiary_username).single();
    if (!beneficiary) return jsonResponse(404, { error: 'beneficiary_not_found' });

    const { data: cred } = await supabase
      .from('sponsor_credentials').select('user_id, provider, revoked_at')
      .eq('id', credential_id).single();
    if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) return jsonResponse(404, { error: 'credential_not_found' });
    if ((cred as { revoked_at: string | null }).revoked_at) return jsonResponse(400, { error: 'credential_revoked' });
    if ((cred as { provider: string }).provider !== provider) return jsonResponse(400, { error: 'provider_mismatch' });

    const { data: sponsorship, error: insErr } = await supabase
      .from('sponsorships')
      .insert({
        sponsor_id:        ctx.userId,
        beneficiary_id:    (beneficiary as { id: string }).id,
        credential_id,
        provider,
        monthly_call_cap,
        priority,
        sponsor_public,
      })
      .select('*')
      .single();
    if (insErr) {
      if ((insErr as { code?: string }).code === '23505') return jsonResponse(409, { error: 'sponsorship_exists' });
      return jsonResponse(500, { error: 'insert_failed', detail: insErr.message });
    }

    await supabase.from('admin_audit').insert({
      actor_id:    ctx.userId,
      op:          'ai_sponsorship_create',
      target_type: 'sponsorship',
      target_id:   sponsorship?.id ?? null,
      reason:      'user_created_sponsorship',
      after:       { beneficiary_id: (beneficiary as { id: string }).id, monthly_call_cap, priority },
    });
    return jsonResponse(201, sponsorship);
  }

  // GET /sponsorships?role=sponsor|beneficiary
  if (req.method === 'GET' && path === '/sponsorships') {
    const role = url.searchParams.get('role') ?? 'sponsor';
    const col = role === 'beneficiary' ? 'beneficiary_id' : 'sponsor_id';
    const { data, error } = await supabase
      .from('sponsorships')
      .select('*')
      .eq(col, ctx.userId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[sponsorships] GET /sponsorships failed:', JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }));
      return jsonResponse(500, { error: 'list_failed', detail: error.message, hint: error.hint });
    }
    return jsonResponse(200, data ?? []);
  }

  // POST /sponsorships/:id/unpause (3-strike check)
  {
    const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})\/unpause$/);
    if (m && req.method === 'POST') {
      const id = m[1];
      const { data: spons } = await supabase
        .from('sponsorships').select('sponsor_id, beneficiary_id, status').eq('id', id).single();
      if (!spons) return jsonResponse(404, { error: 'not_found' });
      if ((spons as { sponsor_id: string }).sponsor_id !== ctx.userId) return jsonResponse(403, { error: 'sponsor_only' });
      if ((spons as { status: string }).status !== 'paused') return jsonResponse(400, { error: 'not_paused' });

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
      const { data: pauseRows } = await supabase
        .from('admin_audit')
        .select('id')
        .eq('op', 'ai_sponsorship_pause')
        .eq('target_id', id)
        .gte('created_at', sevenDaysAgo);
      if ((pauseRows?.length ?? 0) >= 3) {
        return jsonResponse(409, { error: 'three_strike', advice: 'revoke_and_recreate' });
      }

      await supabase.from('sponsorships').update({
        status: 'active', paused_reason: null, paused_at: null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      await supabase.from('admin_audit').insert({
        actor_id:    ctx.userId,
        op:          'ai_sponsorship_unpause',
        target_type: 'sponsorship',
        target_id:   id,
        reason:      'sponsor_unpaused',
      });
      return jsonResponse(200, { ok: true });
    }
  }

  // GET /sponsorships/:id/usage
  {
    const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})\/usage$/);
    if (m && req.method === 'GET') {
      const id = m[1];
      const { data: spons } = await supabase
        .from('sponsorships').select('sponsor_id, beneficiary_id, monthly_call_cap').eq('id', id).single();
      if (!spons) return jsonResponse(404, { error: 'not_found' });
      const isParty =
        (spons as { sponsor_id: string }).sponsor_id === ctx.userId ||
        (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
      if (!isParty) return jsonResponse(403, { error: 'forbidden' });

      const past = await supabase
        .from('ai_usage_monthly')
        .select('year_month, calls, tokens_in, tokens_out')
        .eq('sponsorship_id', id)
        .order('year_month', { ascending: false })
        .limit(12);

      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const { data: currentMonth } = await supabase
        .from('ai_usage')
        .select('occurred_at, tokens_in, tokens_out')
        .eq('sponsorship_id', id)
        .gte('occurred_at', monthStart)
        .order('occurred_at', { ascending: true });

      const byDay: Record<string, { calls: number; tokens_in: number; tokens_out: number }> = {};
      for (const row of (currentMonth ?? []) as Array<{ occurred_at: string; tokens_in?: number; tokens_out?: number }>) {
        const d = row.occurred_at.slice(0, 10);
        byDay[d] ??= { calls: 0, tokens_in: 0, tokens_out: 0 };
        byDay[d].calls      += 1;
        byDay[d].tokens_in  += row.tokens_in  ?? 0;
        byDay[d].tokens_out += row.tokens_out ?? 0;
      }
      const usedThisMonth = Object.values(byDay).reduce((s, d) => s + d.calls, 0);
      const cap = (spons as { monthly_call_cap: number }).monthly_call_cap;
      return jsonResponse(200, {
        cap, usedThisMonth,
        pctUsed: cap > 0 ? usedThisMonth / cap : 0,
        currentMonthByDay: byDay,
        pastMonths: past.data ?? [],
      });
    }
  }

  // PATCH /sponsorships/:id
  {
    const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})$/);
    if (m && req.method === 'PATCH') {
      const id = m[1];
      const body = await req.json().catch(() => ({}));
      const { data: spons } = await supabase
        .from('sponsorships').select('sponsor_id, beneficiary_id').eq('id', id).single();
      if (!spons) return jsonResponse(404, { error: 'not_found' });
      const isSponsor     = (spons as { sponsor_id: string }).sponsor_id === ctx.userId;
      const isBeneficiary = (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
      if (!isSponsor && !isBeneficiary) return jsonResponse(403, { error: 'forbidden' });

      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (isSponsor) {
        if ('monthly_call_cap' in body) update.monthly_call_cap = (body as { monthly_call_cap: number }).monthly_call_cap;
        if ('priority'         in body) update.priority         = (body as { priority: number }).priority;
        if ('status'           in body) update.status           = (body as { status: string }).status;
        if ('sponsor_public'   in body) update.sponsor_public   = (body as { sponsor_public: boolean }).sponsor_public;
      }
      if (isBeneficiary) {
        if ('beneficiary_public' in body) update.beneficiary_public = (body as { beneficiary_public: boolean }).beneficiary_public;
      }
      if (Object.keys(update).length === 1) return jsonResponse(400, { error: 'no_valid_fields' });

      const { data: updated, error: updErr } = await supabase
        .from('sponsorships').update(update).eq('id', id).select('*').single();
      if (updErr) return jsonResponse(500, { error: 'update_failed', detail: updErr.message });
      return jsonResponse(200, updated);
    }
  }

  // DELETE /sponsorships/:id
  {
    const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})$/);
    if (m && req.method === 'DELETE') {
      const id = m[1];
      const { data: spons } = await supabase
        .from('sponsorships').select('sponsor_id, beneficiary_id').eq('id', id).single();
      if (!spons) return jsonResponse(404, { error: 'not_found' });
      const isParty =
        (spons as { sponsor_id: string }).sponsor_id === ctx.userId ||
        (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
      if (!isParty) return jsonResponse(403, { error: 'forbidden' });
      await supabase.from('sponsorships').update({
        status: 'revoked', updated_at: new Date().toISOString(),
      }).eq('id', id);
      await supabase.from('admin_audit').insert({
        actor_id:    ctx.userId,
        op:          'ai_sponsorship_revoke',
        target_type: 'sponsorship',
        target_id:   id,
        reason:      'party_revoked_sponsorship',
      });
      return jsonResponse(204, {});
    }
  }

  // POST /requests — beneficiary creates a request to a sponsor by username
  if (req.method === 'POST' && path === '/requests') {
    const body = await req.json().catch(() => ({}));
    const { sponsor_username, message } = body as { sponsor_username?: string; message?: string };
    if (!sponsor_username) return jsonResponse(400, { error: 'sponsor_username_required' });
    if (message && message.length > 280) return jsonResponse(400, { error: 'message_too_long' });

    const { data: target } = await supabase.from('users').select('id').eq('username', sponsor_username).single();
    if (!target) return jsonResponse(404, { error: 'sponsor_not_found' });
    const targetId = (target as { id: string }).id;
    if (targetId === ctx.userId) return jsonResponse(400, { error: 'cannot_request_self' });

    const { data: request, error: insErr } = await supabase
      .from('sponsorship_requests')
      .insert({ requester_id: ctx.userId, target_sponsor_id: targetId, message: message ?? null })
      .select('*')
      .single();
    if (insErr) {
      if ((insErr as { code?: string }).code === '23505') return jsonResponse(409, { error: 'request_exists' });
      return jsonResponse(500, { error: 'insert_failed', detail: insErr.message });
    }
    await supabase.from('admin_audit').insert({
      actor_id: ctx.userId, op: 'sponsorship_request_create',
      target_type: 'sponsorship_request', target_id: request?.id ?? null,
      reason: 'user_requested_sponsorship', after: { sponsor: sponsor_username, message },
    });
    return jsonResponse(201, request);
  }

  // GET /requests?role=requester|sponsor
  if (req.method === 'GET' && path === '/requests') {
    const role = url.searchParams.get('role') ?? 'requester';
    const col = role === 'sponsor' ? 'target_sponsor_id' : 'requester_id';
    const { data, error } = await supabase
      .from('sponsorship_requests').select('*').eq(col, ctx.userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[sponsorships] GET /requests failed:', JSON.stringify({ code: error.code, message: error.message, details: error.details, hint: error.hint }));
      return jsonResponse(500, { error: 'list_failed', detail: error.message, hint: error.hint });
    }
    return jsonResponse(200, data ?? []);
  }

  // POST /requests/:id/approve — sponsor approves; creates a sponsorship row
  {
    const m = path.match(/^\/requests\/([0-9a-f-]{36})\/approve$/);
    if (m && req.method === 'POST') {
      const id = m[1];
      const body = await req.json().catch(() => ({}));
      const { credential_id, monthly_call_cap = 200, priority = 100 } = body as { credential_id?: string; monthly_call_cap?: number; priority?: number };
      if (!credential_id) return jsonResponse(400, { error: 'credential_id_required' });
      if (monthly_call_cap < 1 || monthly_call_cap > 10000) return jsonResponse(400, { error: 'cap_out_of_range' });

      const { data: request } = await supabase
        .from('sponsorship_requests').select('requester_id, target_sponsor_id, status').eq('id', id).single();
      if (!request) return jsonResponse(404, { error: 'not_found' });
      const r = request as { requester_id: string; target_sponsor_id: string; status: string };
      if (r.target_sponsor_id !== ctx.userId) return jsonResponse(403, { error: 'sponsor_only' });
      if (r.status !== 'pending') return jsonResponse(400, { error: 'not_pending' });

      const { data: cred } = await supabase
        .from('sponsor_credentials').select('user_id, provider, revoked_at').eq('id', credential_id).single();
      if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) return jsonResponse(404, { error: 'credential_not_found' });
      if ((cred as { revoked_at: string | null }).revoked_at) return jsonResponse(400, { error: 'credential_revoked' });

      // Create sponsorship
      const { data: sponsorship, error: insErr } = await supabase
        .from('sponsorships').insert({
          sponsor_id:       ctx.userId,
          beneficiary_id:   r.requester_id,
          credential_id,
          provider:         (cred as { provider: string }).provider,
          monthly_call_cap,
          priority,
        }).select('*').single();
      let resolvedSponsorship = sponsorship;
      if (insErr && (insErr as { code?: string }).code === '23505') {
        // Sponsorship already exists between this sponsor + beneficiary; fetch it.
        const { data: existing } = await supabase
          .from('sponsorships')
          .select('*')
          .eq('sponsor_id', ctx.userId)
          .eq('beneficiary_id', r.requester_id)
          .single();
        resolvedSponsorship = existing;
      } else if (insErr) {
        return jsonResponse(500, { error: 'sponsorship_insert_failed', detail: insErr.message });
      }
      // Update request status
      await supabase.from('sponsorship_requests')
        .update({ status: 'approved', responded_at: new Date().toISOString() })
        .eq('id', id);
      await supabase.from('admin_audit').insert({
        actor_id: ctx.userId, op: 'sponsorship_request_approve',
        target_type: 'sponsorship_request', target_id: id,
        reason: 'sponsor_approved', after: { sponsorship_id: resolvedSponsorship?.id ?? null, monthly_call_cap, priority },
      });
      return jsonResponse(200, { ok: true, sponsorship: resolvedSponsorship });
    }
  }

  // POST /requests/:id/reject
  {
    const m = path.match(/^\/requests\/([0-9a-f-]{36})\/reject$/);
    if (m && req.method === 'POST') {
      const id = m[1];
      const { data: request } = await supabase
        .from('sponsorship_requests').select('target_sponsor_id, status').eq('id', id).single();
      if (!request) return jsonResponse(404, { error: 'not_found' });
      const r = request as { target_sponsor_id: string; status: string };
      if (r.target_sponsor_id !== ctx.userId) return jsonResponse(403, { error: 'sponsor_only' });
      if (r.status !== 'pending') return jsonResponse(400, { error: 'not_pending' });
      await supabase.from('sponsorship_requests')
        .update({ status: 'rejected', responded_at: new Date().toISOString() })
        .eq('id', id);
      await supabase.from('admin_audit').insert({
        actor_id: ctx.userId, op: 'sponsorship_request_reject',
        target_type: 'sponsorship_request', target_id: id, reason: 'sponsor_rejected',
      });
      return jsonResponse(200, { ok: true });
    }
  }

  // DELETE /requests/:id — requester withdraws
  {
    const m = path.match(/^\/requests\/([0-9a-f-]{36})$/);
    if (m && req.method === 'DELETE') {
      const id = m[1];
      const { data: request } = await supabase
        .from('sponsorship_requests').select('requester_id, status').eq('id', id).single();
      if (!request) return jsonResponse(404, { error: 'not_found' });
      const r = request as { requester_id: string; status: string };
      if (r.requester_id !== ctx.userId) return jsonResponse(403, { error: 'requester_only' });
      if (r.status !== 'pending') return jsonResponse(400, { error: 'not_pending' });
      await supabase.from('sponsorship_requests')
        .update({ status: 'withdrawn', responded_at: new Date().toISOString() })
        .eq('id', id);
      await supabase.from('admin_audit').insert({
        actor_id: ctx.userId, op: 'sponsorship_request_withdraw',
        target_type: 'sponsorship_request', target_id: id, reason: 'requester_withdrew',
      });
      return jsonResponse(204, {});
    }
  }

  return jsonResponse(404, { error: 'not_found', path, method: req.method });
});
