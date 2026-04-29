import { roleGrantHandler } from './role-grant.ts';
import { roleRevokeHandler } from './role-revoke.ts';
import { sensitiveReadUserAuditHandler } from './sensitive-read-user-audit.ts';
import { observationHideHandler } from './observation-hide.ts';
import { observationUnhideHandler } from './observation-unhide.ts';
import { observationObscureHandler } from './observation-obscure.ts';
import { observationLicenseOverrideHandler } from './observation-license-override.ts';
import { reportTriageHandler } from './report-triage.ts';
import { reportResolveHandler } from './report-resolve.ts';
import { reportDismissHandler } from './report-dismiss.ts';
import { commentHideHandler } from './comment-hide.ts';
import { commentUnhideHandler } from './comment-unhide.ts';
import { commentLockHandler } from './comment-lock.ts';
import { commentUnlockHandler } from './comment-unlock.ts';
import { userBanHandler } from './user-ban.ts';
import { userUnbanHandler } from './user-unban.ts';
import { badgeAwardManualHandler } from './badge-award-manual.ts';
import { badgeRevokeHandler } from './badge-revoke.ts';
import { taxonRecomputeRarityHandler } from './taxon-recompute-rarity.ts';
import { taxonToggleConservationHandler } from './taxon-toggle-conservation.ts';
import { featureFlagToggleHandler } from './feature-flag-toggle.ts';
import type { ActionHandler } from './role-grant.ts';

export const HANDLERS: Record<string, ActionHandler<unknown>> = {
  'role.grant': roleGrantHandler as unknown as ActionHandler<unknown>,
  'role.revoke': roleRevokeHandler as unknown as ActionHandler<unknown>,
  'sensitive_read.user_audit': sensitiveReadUserAuditHandler as unknown as ActionHandler<unknown>,
  'observation.hide': observationHideHandler as unknown as ActionHandler<unknown>,
  'observation.unhide': observationUnhideHandler as unknown as ActionHandler<unknown>,
  'observation.obscure': observationObscureHandler as unknown as ActionHandler<unknown>,
  'observation.license_override': observationLicenseOverrideHandler as unknown as ActionHandler<unknown>,
  'report.triage': reportTriageHandler as unknown as ActionHandler<unknown>,
  'report.resolve': reportResolveHandler as unknown as ActionHandler<unknown>,
  'report.dismiss': reportDismissHandler as unknown as ActionHandler<unknown>,
  'comment.hide': commentHideHandler as unknown as ActionHandler<unknown>,
  'comment.unhide': commentUnhideHandler as unknown as ActionHandler<unknown>,
  'comment.lock': commentLockHandler as unknown as ActionHandler<unknown>,
  'comment.unlock': commentUnlockHandler as unknown as ActionHandler<unknown>,
  'user.ban': userBanHandler as unknown as ActionHandler<unknown>,
  'user.unban': userUnbanHandler as unknown as ActionHandler<unknown>,
  'badge.award_manual': badgeAwardManualHandler as unknown as ActionHandler<unknown>,
  'badge.revoke': badgeRevokeHandler as unknown as ActionHandler<unknown>,
  'taxon.recompute_rarity': taxonRecomputeRarityHandler as unknown as ActionHandler<unknown>,
  'taxon.toggle_conservation': taxonToggleConservationHandler as unknown as ActionHandler<unknown>,
  'feature_flag.toggle': featureFlagToggleHandler as unknown as ActionHandler<unknown>,
};
