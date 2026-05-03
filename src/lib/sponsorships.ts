import { getSupabase } from './supabase';
import type { SponsorCredential, Sponsorship, SponsorshipRequest, SponsorshipUsage } from './types.sponsorship';

const FN_BASE = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/sponsorships`;

// M32 (#152): credential kinds + provider variants for the
// multi-provider abstraction. The legacy `detectKind` returns just
// the two Anthropic-direct values; richer detection lives in
// `detectAnyKind` for the new sponsorship UI.
export type CredentialKind =
  | 'api_key' | 'oauth_token'
  | 'bedrock' | 'openai_api_key' | 'azure_openai' | 'gemini_api_key' | 'vertex_ai';

export function detectKind(secret: string): 'api_key' | 'oauth_token' | null {
  if (secret.startsWith('sk-ant-api03-')) return 'api_key';
  if (secret.startsWith('sk-ant-oat01-')) return 'oauth_token';
  return null;
}

/** Best-effort prefix detection across all 7 supported credential
 *  kinds. Returns null when the prefix is ambiguous (the operator
 *  must pick from the dropdown for Bedrock / Azure / Vertex JSON
 *  envelopes). Pure helper — exported for tests. */
export function detectAnyKind(secret: string): CredentialKind | null {
  if (secret.startsWith('sk-ant-api03-')) return 'api_key';
  if (secret.startsWith('sk-ant-oat01-')) return 'oauth_token';
  if (secret.startsWith('sk-'))           return 'openai_api_key';
  if (secret.startsWith('AIza'))          return 'gemini_api_key';
  // Bedrock + Vertex are JSON envelopes; can't disambiguate by prefix.
  return null;
}

export interface CreateCredentialArgs {
  label: string;
  secret: string;
  /** New in M32: provider kind. Optional for back-compat — server falls
   *  back to detectKind() if absent. */
  kind?: CredentialKind;
  /** Per-credential model. Defaults to 'claude-haiku-4-5' server-side. */
  preferred_model?: string;
  /** Azure deployment URL or Vertex region; NULL for direct providers. */
  endpoint?: string | null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new Error('not_authenticated');
  return fetch(`${FN_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'authorization': `Bearer ${session.access_token}`,
      'content-type':  'application/json',
    },
  });
}

async function readErrorBody(r: Response): Promise<string> {
  try {
    const body = await r.json() as { error?: string; detail?: string; hint?: string };
    return [body.error, body.detail, body.hint].filter(Boolean).join(' | ');
  } catch {
    return String(r.status);
  }
}

export async function listCredentials(): Promise<SponsorCredential[]> {
  const r = await authedFetch('/credentials');
  if (!r.ok) throw new Error(`listCredentials: ${await readErrorBody(r)}`);
  return r.json();
}

export async function createCredential(args: CreateCredentialArgs): Promise<SponsorCredential> {
  const r = await authedFetch('/credentials', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createCredential: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

// ── M32 #115: platform-pool donations ────────────────────────────
export interface SponsorPool {
  id: string;
  credential_id: string;
  total_cap: number;
  used: number;
  monthly_reset: boolean;
  status: 'active' | 'paused' | 'exhausted';
  preferred_model: string;
  daily_user_cap: number;
  created_at: string;
}

export async function listMyPools(): Promise<SponsorPool[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('sponsor_pools')
    .select('id, credential_id, total_cap, used, monthly_reset, status, preferred_model, daily_user_cap, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SponsorPool[];
}

export async function createPool(input: {
  credential_id: string;
  total_cap: number;
  preferred_model: string;
  daily_user_cap?: number;
  monthly_reset?: boolean;
}): Promise<string> {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) throw new Error('not_authenticated');
  const { data, error } = await sb
    .from('sponsor_pools')
    .insert({
      sponsor_id:      session.user.id,
      credential_id:   input.credential_id,
      total_cap:       input.total_cap,
      preferred_model: input.preferred_model,
      daily_user_cap:  input.daily_user_cap  ?? 10,
      monthly_reset:   input.monthly_reset   ?? false,
      status:          'active',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function setPoolStatus(poolId: string, status: 'active' | 'paused' | 'exhausted'): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('sponsor_pools').update({ status }).eq('id', poolId);
  if (error) throw new Error(error.message);
}

export async function rotateCredential(id: string, secret: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}/rotate`, { method: 'POST', body: JSON.stringify({ secret }) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`rotateCredential: ${(body as { error?: string }).error ?? r.status}`);
  }
}

export async function deleteCredential(id: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}`, { method: 'POST', headers: { 'X-HTTP-Method-Override': 'DELETE' } });
  if (!r.ok && r.status !== 204) throw new Error(`deleteCredential: ${r.status}`);
}

export async function updatePool(id: string, patch: { total_cap?: number; daily_user_cap?: number; preferred_model?: string; status?: 'active' | 'paused' }): Promise<void> {
  const r = await authedFetch(`/pools/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`updatePool: ${await readErrorBody(r)}`);
}

export async function deletePool(id: string): Promise<void> {
  const r = await authedFetch(`/pools/${id}`, { method: 'POST', headers: { 'X-HTTP-Method-Override': 'DELETE' } });
  if (!r.ok && r.status !== 204) throw new Error(`deletePool: ${await readErrorBody(r)}`);
}

export async function listSponsorships(role: 'sponsor' | 'beneficiary'): Promise<Sponsorship[]> {
  const r = await authedFetch(`/sponsorships?role=${role}`);
  if (!r.ok) throw new Error(`listSponsorships: ${await readErrorBody(r)}`);
  return r.json();
}

export async function createSponsorship(args: {
  beneficiary_username: string; credential_id: string;
  monthly_call_cap?: number; priority?: number; sponsor_public?: boolean;
}): Promise<Sponsorship> {
  const r = await authedFetch('/sponsorships', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createSponsorship: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function patchSponsorship(id: string, patch: Partial<Pick<Sponsorship,
  'monthly_call_cap' | 'priority' | 'status' | 'sponsor_public' | 'beneficiary_public'>>
): Promise<Sponsorship> {
  const r = await authedFetch(`/sponsorships/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`patchSponsorship: ${r.status}`);
  return r.json();
}

export async function unpauseSponsorship(id: string): Promise<{ ok?: boolean; error?: string; advice?: string }> {
  const r = await authedFetch(`/sponsorships/${id}/unpause`, { method: 'POST' });
  return r.json();
}

export async function testCredential(id: string): Promise<{ ok: boolean; latency_ms: number; error: string | null }> {
  const r = await authedFetch(`/credentials/${id}/test`, { method: 'POST' });
  if (!r.ok) throw new Error(`testCredential: ${await readErrorBody(r)}`);
  return r.json();
}

export async function revokeSponsorship(id: string): Promise<void> {
  const r = await authedFetch(`/sponsorships/${id}`, { method: 'POST', headers: { 'X-HTTP-Method-Override': 'DELETE' } });
  if (!r.ok && r.status !== 204) throw new Error(`revokeSponsorship: ${r.status}`);
}

export async function getUsage(id: string): Promise<SponsorshipUsage> {
  const r = await authedFetch(`/sponsorships/${id}/usage`);
  if (!r.ok) throw new Error(`getUsage: ${r.status}`);
  return r.json();
}

export async function createRequest(args: { sponsor_username: string; message?: string }): Promise<SponsorshipRequest> {
  const r = await authedFetch('/requests', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createRequest: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function listRequests(role: 'requester' | 'sponsor'): Promise<SponsorshipRequest[]> {
  const r = await authedFetch(`/requests?role=${role}`);
  if (!r.ok) throw new Error(`listRequests: ${await readErrorBody(r)}`);
  return r.json();
}

export async function approveRequest(id: string, args: { credential_id: string; monthly_call_cap?: number; priority?: number }) {
  const r = await authedFetch(`/requests/${id}/approve`, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`approveRequest: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function rejectRequest(id: string): Promise<void> {
  const r = await authedFetch(`/requests/${id}/reject`, { method: 'POST' });
  if (!r.ok) throw new Error(`rejectRequest: ${r.status}`);
}

export async function withdrawRequest(id: string): Promise<void> {
  const r = await authedFetch(`/requests/${id}`, { method: 'POST', headers: { 'X-HTTP-Method-Override': 'DELETE' } });
  if (!r.ok && r.status !== 204) throw new Error(`withdrawRequest: ${r.status}`);
}
