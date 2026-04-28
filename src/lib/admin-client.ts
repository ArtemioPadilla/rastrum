import type { UserRole } from './types';

export class AdminClientError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

interface RoleGrantPayload {
  target_user_id: string;
  role: UserRole;
  expires_at?: string;
}
interface RoleRevokePayload {
  target_user_id: string;
  role: UserRole;
}
interface SensitiveReadUserAuditPayload {
  target_user_id: string;
  limit?: number;
}

interface DispatcherResponse<T = unknown> {
  ok: true;
  audit_id: number;
  result?: T;
  after?: unknown;
}

async function call<T = unknown>(
  action: string,
  payload: unknown,
  reason: string,
  jwt: string,
): Promise<DispatcherResponse<T>> {
  const url = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/admin`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ action, payload, reason }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new AdminClientError(res.status, msg, body);
  }
  return body as DispatcherResponse<T>;
}

export const adminClient = {
  role: {
    grant: (payload: RoleGrantPayload, reason: string, jwt: string) =>
      call('role.grant', payload, reason, jwt),
    revoke: (payload: RoleRevokePayload, reason: string, jwt: string) =>
      call('role.revoke', payload, reason, jwt),
  },
  sensitiveRead: {
    userAudit: (payload: SensitiveReadUserAuditPayload, reason: string, jwt: string) =>
      call<unknown[]>('sensitive_read.user_audit', payload, reason, jwt),
  },
};
