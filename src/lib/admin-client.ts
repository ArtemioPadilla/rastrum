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

type ObscureLevel = 'none' | '0.1deg' | '0.2deg' | '5km' | 'full';
type ObservationLicense = 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0';

interface ObsHidePayload { observation_id: string }
interface ObsUnhidePayload { observation_id: string }
interface ObsObscurePayload { observation_id: string; obscure_level: ObscureLevel }
interface ObsLicensePayload { observation_id: string; license: ObservationLicense }

interface ReportTriagePayload { report_id: string }
interface ReportResolvePayload { report_id: string }
interface ReportDismissPayload { report_id: string }

interface CommentHidePayload { comment_id: string }
interface CommentUnhidePayload { comment_id: string }
interface CommentLockPayload { comment_id: string }
interface CommentUnlockPayload { comment_id: string }

interface UserBanPayload { target_user_id: string; duration_hours: number | null }
interface UserUnbanPayload { target_user_id: string; ban_id: string }

interface BadgeAwardManualPayload { target_user_id: string; badge_key: string }
interface BadgeRevokePayload { target_user_id: string; badge_key: string }

type ConservationFlag = 'nom059_status' | 'cites_appendix' | 'iucn_category';
interface TaxonToggleConservationPayload {
  taxon_id: string;
  flag: ConservationFlag;
  value: string | null;
}

interface FeatureFlagTogglePayload { key: string; value: boolean }

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
  observation: {
    hide: (payload: ObsHidePayload, reason: string, jwt: string) =>
      call('observation.hide', payload, reason, jwt),
    unhide: (payload: ObsUnhidePayload, reason: string, jwt: string) =>
      call('observation.unhide', payload, reason, jwt),
    obscure: (payload: ObsObscurePayload, reason: string, jwt: string) =>
      call('observation.obscure', payload, reason, jwt),
    licenseOverride: (payload: ObsLicensePayload, reason: string, jwt: string) =>
      call('observation.license_override', payload, reason, jwt),
  },
  report: {
    triage: (payload: ReportTriagePayload, reason: string, jwt: string) =>
      call('report.triage', payload, reason, jwt),
    resolve: (payload: ReportResolvePayload, reason: string, jwt: string) =>
      call('report.resolve', payload, reason, jwt),
    dismiss: (payload: ReportDismissPayload, reason: string, jwt: string) =>
      call('report.dismiss', payload, reason, jwt),
  },
  comment: {
    hide: (payload: CommentHidePayload, reason: string, jwt: string) =>
      call('comment.hide', payload, reason, jwt),
    unhide: (payload: CommentUnhidePayload, reason: string, jwt: string) =>
      call('comment.unhide', payload, reason, jwt),
    lock: (payload: CommentLockPayload, reason: string, jwt: string) =>
      call('comment.lock', payload, reason, jwt),
    unlock: (payload: CommentUnlockPayload, reason: string, jwt: string) =>
      call('comment.unlock', payload, reason, jwt),
  },
  user: {
    ban: (payload: UserBanPayload, reason: string, jwt: string) =>
      call('user.ban', payload, reason, jwt),
    unban: (payload: UserUnbanPayload, reason: string, jwt: string) =>
      call('user.unban', payload, reason, jwt),
  },
  badge: {
    awardManual: (payload: BadgeAwardManualPayload, reason: string, jwt: string) =>
      call('badge.award_manual', payload, reason, jwt),
    revoke: (payload: BadgeRevokePayload, reason: string, jwt: string) =>
      call('badge.revoke', payload, reason, jwt),
  },
  taxon: {
    recomputeRarity: (reason: string, jwt: string) =>
      call('taxon.recompute_rarity', {}, reason, jwt),
    toggleConservation: (payload: TaxonToggleConservationPayload, reason: string, jwt: string) =>
      call('taxon.toggle_conservation', payload, reason, jwt),
  },
  featureFlag: {
    toggle: (payload: FeatureFlagTogglePayload, reason: string, jwt: string) =>
      call('feature_flag.toggle', payload, reason, jwt),
  },
};
