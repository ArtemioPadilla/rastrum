import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Provider = 'anthropic';
export type CredentialKind = 'api_key' | 'oauth_token';

export interface ResolvedSponsorship {
  sponsorshipId: string;
  sponsorId:     string;
  credentialId:  string;
  vaultSecretId: string;
  kind:          CredentialKind;
  usedThisMonth: number;
  monthlyCap:    number;
}

export function pickAuthHeader(kind: CredentialKind, secret: string): HeadersInit {
  const base: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
  if (kind === 'api_key') base['x-api-key'] = secret;
  else                    base['Authorization'] = `Bearer ${secret}`;
  return base;
}

export async function resolveSponsorship(
  supabase: SupabaseClient, beneficiaryId: string, provider: Provider
): Promise<ResolvedSponsorship | null> {
  const { data, error } = await supabase
    .rpc('resolve_sponsorship', { p_beneficiary: beneficiaryId, p_provider: provider });
  if (error) throw new Error(`resolve_sponsorship rpc failed: ${error.message}`);
  if (!data || (data as unknown[]).length === 0) return null;
  const row = (data as Array<{
    sponsorship_id: string; sponsor_id: string; credential_id: string;
    vault_secret_id: string; kind: CredentialKind;
    used_this_month: number; monthly_call_cap: number;
  }>)[0];
  return {
    sponsorshipId: row.sponsorship_id,
    sponsorId:     row.sponsor_id,
    credentialId:  row.credential_id,
    vaultSecretId: row.vault_secret_id,
    kind:          row.kind,
    usedThisMonth: row.used_this_month,
    monthlyCap:    row.monthly_call_cap,
  };
}

export async function decryptCredential(
  supabase: SupabaseClient, vaultSecretId: string
): Promise<string> {
  const { data, error } = await supabase
    .schema('vault' as never)
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', vaultSecretId)
    .single();
  if (error) throw new Error(`vault decrypt failed: ${error.message}`);
  const secret = (data as { decrypted_secret?: string } | null)?.decrypted_secret;
  if (!secret) throw new Error('vault returned empty secret');
  return secret;
}

export async function recordUsage(
  supabase: SupabaseClient,
  args: { sponsorshipId: string; sponsorId: string; beneficiaryId: string; provider: Provider; tokensIn?: number; tokensOut?: number }
): Promise<{ usedThisMonth: number; cap: number; pctUsed: number }> {
  const { error: insErr } = await supabase.from('ai_usage').insert({
    sponsorship_id: args.sponsorshipId,
    sponsor_id:     args.sponsorId,
    beneficiary_id: args.beneficiaryId,
    provider:       args.provider,
    tokens_in:      args.tokensIn  ?? null,
    tokens_out:     args.tokensOut ?? null,
  });
  if (insErr) throw new Error(`recordUsage insert failed: ${insErr.message}`);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { count: usedThisMonth, error: cntErr } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('sponsorship_id', args.sponsorshipId)
    .gte('occurred_at', monthStart);
  if (cntErr) throw new Error(`recordUsage count failed: ${cntErr.message}`);

  const { data: spons, error: capErr } = await supabase
    .from('sponsorships')
    .select('monthly_call_cap')
    .eq('id', args.sponsorshipId)
    .single();
  if (capErr) throw new Error(`recordUsage cap lookup failed: ${capErr.message}`);
  const cap = (spons as { monthly_call_cap: number }).monthly_call_cap;
  const used = usedThisMonth ?? 0;
  return { usedThisMonth: used, cap, pctUsed: cap > 0 ? used / cap : 0 };
}

export function pickThreshold(pctUsed: number): 80 | 100 | null {
  if (pctUsed >= 1.0)  return 100;
  if (pctUsed >= 0.80) return 80;
  return null;
}

export async function maybeNotifyThreshold(
  supabase: SupabaseClient, sponsorshipId: string, pctUsed: number
): Promise<void> {
  const threshold = pickThreshold(pctUsed);
  if (!threshold) return;

  const yearMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10);

  const { error: insErr } = await supabase
    .from('notifications_sent')
    .insert({ sponsorship_id: sponsorshipId, threshold, year_month: yearMonth });
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return; // already notified this month
    throw new Error(`notification idempotency insert failed: ${insErr.message}`);
  }

  const { data: ctx } = await supabase
    .from('sponsorships')
    .select('sponsor_id, beneficiary_id, monthly_call_cap')
    .eq('id', sponsorshipId)
    .single();
  if (!ctx) return;
  const sCtx = ctx as { sponsor_id: string; beneficiary_id: string; monthly_call_cap: number };

  const { data: sponsor }     = await supabase.from('users').select('id,display_name,username').eq('id', sCtx.sponsor_id).single();
  const { data: beneficiary } = await supabase.from('users').select('username').eq('id', sCtx.beneficiary_id).single();
  if (!sponsor || !beneficiary) return;

  const sponsorDisplay = (sponsor as { display_name?: string | null; username: string }).display_name
                       ?? (sponsor as { username: string }).username;
  const beneficiaryUsername = (beneficiary as { username: string }).username;

  // For v1, log the event at warn level. The existing Resend SMTP worker can
  // pick this up later; auth's email infra is the next iteration.
  // allowed: log level + no secret
  console.warn(
    `[sponsorships] threshold ${threshold}% — notify ${sponsorDisplay} re @${beneficiaryUsername} (sponsorship ${sponsorshipId})`
  );
}

export async function checkAndBumpRateLimit(
  supabase: SupabaseClient, beneficiaryId: string, provider: Provider
): Promise<{ allowed: boolean; reason?: string }> {
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const { error: bumpErr } = await supabase.rpc('increment_rate_limit_bucket', {
    p_beneficiary: beneficiaryId, p_provider: provider, p_bucket: bucket,
  });
  if (bumpErr) throw new Error(`increment_rate_limit_bucket failed: ${bumpErr.message}`);

  const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: agg, error: aggErr } = await supabase
    .from('ai_rate_limits')
    .select('count')
    .eq('beneficiary_id', beneficiaryId).eq('provider', provider)
    .gte('bucket', tenMinAgo);
  if (aggErr) throw new Error(`rate limit aggregate failed: ${aggErr.message}`);

  const total = (agg as Array<{ count: number }> | null)?.reduce((s, r) => s + r.count, 0) ?? 0;
  if (total > 30) return { allowed: false, reason: 'rate_limit:30/10min' };
  return { allowed: true };
}

export async function autoPauseSponsorship(
  supabase: SupabaseClient, sponsorshipId: string, reason: string
): Promise<void> {
  await supabase.from('sponsorships').update({
    status:        'paused',
    paused_reason: reason,
    paused_at:     new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }).eq('id', sponsorshipId);

  await supabase.from('admin_audit').insert({
    actor_id: null,
    op:       'ai_sponsorship_pause',
    target:   sponsorshipId,
    details:  { reason, source: 'edge_function:identify' },
  });
}
