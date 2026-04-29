import type { UserRole } from './types';
import { routes } from '../i18n/utils';

// `researcher` is intentionally omitted from CONSOLE_TABS and rolePillsFor.
// It is a data-access role (RLS gate for precise GPS coords on obscured
// observations) — not a console role. It surfaces only as a chip in the
// Users / Credentials tabs (PR2), never as its own pill or tab set.

export interface ConsoleTab {
  id: string;
  role: UserRole;
  routeKey: keyof typeof routes;
  i18nKey: string;
  icon: string;
  phase: 1 | 2 | 3 | 4;
  stub?: boolean;
}

export const CONSOLE_TABS: ConsoleTab[] = [
  // Admin (15)
  { id: 'overview',       role: 'admin',     routeKey: 'console',                 i18nKey: 'console.overview',     icon: 'gauge',       phase: 1 },
  { id: 'users',          role: 'admin',     routeKey: 'consoleUsers',            i18nKey: 'console.users',        icon: 'users',       phase: 2 },
  { id: 'credentials',    role: 'admin',     routeKey: 'consoleCredentials',      i18nKey: 'console.credentials',  icon: 'shield-check',phase: 2 },
  { id: 'experts',        role: 'admin',     routeKey: 'consoleExperts',          i18nKey: 'console.experts',      icon: 'award',       phase: 1 },
  { id: 'observations',   role: 'admin',     routeKey: 'consoleObservations',     i18nKey: 'console.observations', icon: 'leaf',        phase: 4 },
  { id: 'api',            role: 'admin',     routeKey: 'consoleApi',              i18nKey: 'console.api',          icon: 'plug',        phase: 3 },
  { id: 'sync',           role: 'admin',     routeKey: 'consoleSync',             i18nKey: 'console.sync',         icon: 'refresh',     phase: 3 },
  { id: 'cron',           role: 'admin',     routeKey: 'consoleCron',             i18nKey: 'console.cron',         icon: 'clock',       phase: 3 },
  { id: 'badges',         role: 'admin',     routeKey: 'consoleBadges',           i18nKey: 'console.badges',       icon: 'star',        phase: 4, stub: true },
  { id: 'taxa',           role: 'admin',     routeKey: 'consoleTaxa',             i18nKey: 'console.taxa',         icon: 'tree',        phase: 4, stub: true },
  { id: 'karma',          role: 'admin',     routeKey: 'consoleKarma',            i18nKey: 'console.karma',        icon: 'sparkles',    phase: 4, stub: true },
  { id: 'flags',          role: 'admin',     routeKey: 'consoleFlags',            i18nKey: 'console.flags',        icon: 'flag',        phase: 4, stub: true },
  { id: 'audit',          role: 'admin',     routeKey: 'consoleAudit',            i18nKey: 'console.audit',        icon: 'scroll',      phase: 1 },
  { id: 'features',       role: 'admin',     routeKey: 'consoleFeatureFlags',     i18nKey: 'console.features',     icon: 'toggle',      phase: 4, stub: true },
  { id: 'bioblitz',       role: 'admin',     routeKey: 'consoleBioblitz',         i18nKey: 'console.bioblitz',     icon: 'calendar',    phase: 4, stub: true },
  // Moderator (5)
  { id: 'mod-overview',   role: 'moderator', routeKey: 'console',                 i18nKey: 'console.modOverview',   icon: 'gauge',      phase: 3, stub: true },
  { id: 'mod-flag-queue', role: 'moderator', routeKey: 'consoleModFlagQueue',     i18nKey: 'console.modFlagQueue',  icon: 'flag',       phase: 3, stub: true },
  { id: 'mod-comments',   role: 'moderator', routeKey: 'consoleModComments',      i18nKey: 'console.modComments',   icon: 'message',    phase: 3, stub: true },
  { id: 'mod-bans',       role: 'moderator', routeKey: 'consoleModBans',          i18nKey: 'console.modBans',       icon: 'user-x',     phase: 4, stub: true },
  { id: 'mod-disputes',   role: 'moderator', routeKey: 'consoleModDisputes',      i18nKey: 'console.modDisputes',   icon: 'gavel',      phase: 4, stub: true },
  // Expert (5)
  { id: 'exp-overview',   role: 'expert',    routeKey: 'console',                 i18nKey: 'console.expOverview',   icon: 'gauge',      phase: 2, stub: true },
  { id: 'exp-validation', role: 'expert',    routeKey: 'consoleExpertValidation', i18nKey: 'console.expValidation', icon: 'check-circle', phase: 2, stub: true },
  { id: 'exp-expertise',  role: 'expert',    routeKey: 'consoleExpertExpertise',  i18nKey: 'console.expExpertise',  icon: 'badge-check', phase: 2, stub: true },
  { id: 'exp-overrides',  role: 'expert',    routeKey: 'consoleExpertOverrides',  i18nKey: 'console.expOverrides',  icon: 'edit',       phase: 4, stub: true },
  { id: 'exp-taxon-notes',role: 'expert',    routeKey: 'consoleExpertTaxonNotes', i18nKey: 'console.expTaxonNotes', icon: 'sticky-note',phase: 4, stub: true },
];

export function tabsForRoles(activeRole: UserRole, allRoles: Set<UserRole>): ConsoleTab[] {
  if (!allRoles.has(activeRole)) return [];
  return CONSOLE_TABS.filter(t => t.role === activeRole);
}

const PILL_ORDER: UserRole[] = ['admin', 'moderator', 'expert'];

export function rolePillsFor(allRoles: Set<UserRole>): UserRole[] {
  return PILL_ORDER.filter(r => allRoles.has(r));
}
