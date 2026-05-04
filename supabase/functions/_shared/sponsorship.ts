import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { sendEmail } from './email.ts';

// Provider variants from M27.1 (#116/#118). Direct-Anthropic remains
// the default; the rest are gated by the credential row's `provider`
// column. This file's helpers are still anthropic-flavoured; the
// vision-provider abstraction lives in `vision-provider.ts`.
export type Provider = 'anthropic' | 'bedrock' | 'openai' | 'azure_openai' | 'gemini' | 'vertex_ai';
export type CredentialKind =
  | 'api_key'
  | 'oauth_token'
  | 'bedrock'
  | 'openai_api_key'
  | 'azure_openai'
  | 'gemini_api_key'
  | 'vertex_ai';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface ResolvedSponsorship {
  sponsorshipId: string;
  sponsorId:     string;
  credentialId:  string;
  vaultSecretId: string;
  kind:          CredentialKind;
  usedThisMonth: number;
  monthlyCap:    number;
  /** Per-credential model override (M27.1, #116). Default 'claude-haiku-4-5'. */
  preferredModel: string;
  /** Azure OpenAI deployment URL or Vertex AI region; NULL for direct providers. */
  endpoint:       string | null;
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
    preferred_model?: string; endpoint?: string | null;
  }>)[0];
  return {
    sponsorshipId: row.sponsorship_id,
    sponsorId:     row.sponsor_id,
    credentialId:  row.credential_id,
    vaultSecretId: row.vault_secret_id,
    kind:          row.kind,
    usedThisMonth: row.used_this_month,
    monthlyCap:    row.monthly_call_cap,
    preferredModel: row.preferred_model ?? 'claude-haiku-4-5',
    endpoint:       row.endpoint ?? null,
  };
}

export async function decryptCredential(
  supabase: SupabaseClient, vaultSecretId: string
): Promise<string> {
  // Direct `.schema('vault').from('decrypted_secrets')` access fails
  // with "Invalid schema: vault" — the vault schema isn't in the API
  // exposed-schemas list (and surfacing it would over-expose raw
  // secret rows). Route through the SECURITY DEFINER RPC instead.
  const { data, error } = await supabase.rpc('read_vault_secret', { p_secret_id: vaultSecretId });
  if (error) throw new Error(`vault decrypt failed: ${error.message}`);
  const secret = data as string | null;
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

  const { data: sponsor }     = await supabase.from('users').select('id,email,display_name,username').eq('id', sCtx.sponsor_id).single();
  const { data: beneficiary } = await supabase.from('users').select('username,display_name').eq('id', sCtx.beneficiary_id).single();
  if (!sponsor || !beneficiary) return;

  const sponsorEmail = (sponsor as { email?: string | null }).email;
  if (!sponsorEmail) return;

  const sponsorDisplay     = (sponsor as { display_name?: string | null; username: string }).display_name
                          ?? (sponsor as { username: string }).username;
  const beneficiaryHandle  = (beneficiary as { username: string }).username;
  const beneficiaryDisplay = (beneficiary as { display_name?: string | null; username: string }).display_name
                          ?? beneficiaryHandle;

  const subject = threshold === 100
    ? `Rastrum: @${beneficiaryHandle} reached 100% of their AI quota this month`
    : `Rastrum: @${beneficiaryHandle} is at ${threshold}% of their AI quota this month`;

  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18181b">
  <h2 style="color:#10b981">Rastrum — AI sponsorship threshold</h2>
  <p>Hi ${escHtml(sponsorDisplay)},</p>
  <p><strong>${escHtml(beneficiaryDisplay)} (@${escHtml(beneficiaryHandle)})</strong> has used <strong>${threshold}%</strong> of the ${sCtx.monthly_call_cap} AI calls you sponsored this month.</p>
  ${threshold === 100
    ? `<p>Their access to Claude is now <strong>cut off</strong> until the 1st of next month. They'll fall back to PlantNet (free) and on-device models.</p>`
    : `<p>You'll get one more email when they hit 100%.</p>`}
  <p>Manage their cap or revoke at <a href="https://rastrum.org/en/profile/sponsoring/" style="color:#10b981">rastrum.org/profile/sponsoring</a>.</p>
  <p style="color:#71717a;font-size:12px;margin-top:24px">You receive this because you patrocinate @${escHtml(beneficiaryHandle)} on Rastrum.</p>
</body></html>`;

  const text = `${sponsorDisplay},\n\n@${beneficiaryHandle} has used ${threshold}% of the ${sCtx.monthly_call_cap} AI calls you sponsored this month.\n\nManage at https://rastrum.org/en/profile/sponsoring/`;

  await sendEmail({ to: sponsorEmail, subject, html, text });
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
  supabase: SupabaseClient,
  sponsorshipId: string,
  reason: string,
  beneficiaryId: string,
): Promise<void> {
  await supabase.from('sponsorships').update({
    status:        'paused',
    paused_reason: reason,
    paused_at:     new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }).eq('id', sponsorshipId);

  await supabase.from('admin_audit').insert({
    actor_id:    beneficiaryId,
    op:          'ai_sponsorship_pause',
    target_type: 'sponsorship',
    target_id:   sponsorshipId,
    reason,
    after:       { status: 'paused', source: 'edge_function:identify' },
  });

  try {
    const { data: spons } = await supabase
      .from('sponsorships').select('sponsor_id, beneficiary_id').eq('id', sponsorshipId).single();
    if (!spons) return;
    const s = spons as { sponsor_id: string; beneficiary_id: string };
    const { data: sponsor }     = await supabase.from('users').select('email,display_name,username').eq('id', s.sponsor_id).single();
    const { data: beneficiary } = await supabase.from('users').select('username,display_name').eq('id', s.beneficiary_id).single();
    if (!sponsor || !beneficiary) return;
    const sponsorEmail = (sponsor as { email?: string | null }).email;
    if (!sponsorEmail) return;
    const sponsorDisplay     = (sponsor as { display_name?: string | null; username: string }).display_name ?? (sponsor as { username: string }).username;
    const beneficiaryHandle  = (beneficiary as { username: string }).username;
    const beneficiaryDisplay = (beneficiary as { display_name?: string | null; username: string }).display_name ?? beneficiaryHandle;

    const subject = `Rastrum: auto-paused @${beneficiaryHandle} for "${reason}"`;
    const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#18181b">
  <h2 style="color:#f59e0b">Rastrum — sponsorship auto-paused</h2>
  <p>Hi ${escHtml(sponsorDisplay)},</p>
  <p>We auto-paused your sponsorship of <strong>${escHtml(beneficiaryDisplay)} (@${escHtml(beneficiaryHandle)})</strong> because of: <code>${escHtml(reason)}</code></p>
  <p>Most common cause: rate-limit (more than 30 calls in 10 minutes). The sponsorship stays paused until you reactivate it.</p>
  <p><a href="https://rastrum.org/en/profile/sponsoring/" style="color:#10b981">Review and reactivate at rastrum.org/profile/sponsoring</a></p>
  <p style="color:#71717a;font-size:12px;margin-top:24px">You can also revoke the sponsorship from that page.</p>
</body></html>`;
    const text = `${sponsorDisplay},\n\nWe auto-paused your sponsorship of @${beneficiaryHandle} because of: ${reason}\n\nReactivate or revoke at https://rastrum.org/en/profile/sponsoring/`;
    await sendEmail({ to: sponsorEmail, subject, html, text });
  } catch { /* best-effort */ }
}
