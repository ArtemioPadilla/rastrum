import { getSupabase } from './supabase';
import type { SponsorCredential, Sponsorship, SponsorshipRequest, SponsorshipUsage } from './types.sponsorship';

const FN_BASE = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/sponsorships`;

export function detectKind(secret: string): 'api_key' | 'oauth_token' | null {
  if (secret.startsWith('sk-ant-api03-')) return 'api_key';
  if (secret.startsWith('sk-ant-oat01-')) return 'oauth_token';
  return null;
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

export async function listCredentials(): Promise<SponsorCredential[]> {
  const r = await authedFetch('/credentials');
  if (!r.ok) throw new Error(`listCredentials: ${r.status}`);
  return r.json();
}

export async function createCredential(args: { label: string; secret: string }): Promise<SponsorCredential> {
  const r = await authedFetch('/credentials', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createCredential: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function rotateCredential(id: string, secret: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}/rotate`, { method: 'POST', body: JSON.stringify({ secret }) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`rotateCredential: ${(body as { error?: string }).error ?? r.status}`);
  }
}

export async function deleteCredential(id: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`deleteCredential: ${r.status}`);
}

export async function listSponsorships(role: 'sponsor' | 'beneficiary'): Promise<Sponsorship[]> {
  const r = await authedFetch(`/sponsorships?role=${role}`);
  if (!r.ok) throw new Error(`listSponsorships: ${r.status}`);
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

export async function revokeSponsorship(id: string): Promise<void> {
  const r = await authedFetch(`/sponsorships/${id}`, { method: 'DELETE' });
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
  if (!r.ok) throw new Error(`listRequests: ${r.status}`);
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
  const r = await authedFetch(`/requests/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`withdrawRequest: ${r.status}`);
}
