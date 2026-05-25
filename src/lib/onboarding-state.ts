/**
 * Centralised onboarding / "user state" helper.
 *
 * Background: the codebase had grown ~18 distinct localStorage keys
 * under the `rastrum.*` / `rastrum_*` prefix for tracking onboarding,
 * tour completion, per-feature guide views, visit counts, and similar
 * one-time-flag UX state. Each surface wrote its own key with no
 * shared schema, making it hard to:
 *
 *   - Reason about "where is the user in their journey?" without
 *     reading every component file.
 *   - Export / reset / inspect the full user state for debugging.
 *   - Migrate the storage layer (e.g. to IndexedDB or a server-side
 *     mirror) without touching every call site.
 *
 * This module exposes a single JSON document under `STORAGE_KEY` plus
 * typed accessors. It performs a transparent one-time migration from
 * the legacy keys on first read, but does NOT delete the legacy values
 * — some surfaces still own their own key, and the migration is
 * intentionally non-destructive while call-sites are ported.
 *
 * SSR-safe: every accessor short-circuits when `localStorage` is
 * undefined (Astro static build, Node test runners without a shim).
 */

const STORAGE_KEY = 'rastrum.user.onboardingState';
const MIGRATION_MARKER_KEY = 'rastrum.user.onboardingState.migrated';

export const LEGACY_KEYS = {
  tourSeen: 'rastrum.onboarding.seen',
  tourSeenValue: 'v1',
  consoleOnboarding: 'rastrum.console.onboardingDone',
  obs2Onboarding: 'rastrum.obs2.onboarding_shown',
  firstObsCelebrated: 'rastrum.firstObservationCelebrated',
  firstObsSyncedAt: 'rastrum.obs.firstSyncedAt',
  privacyPreset: 'rastrum.onboarding.privacyPreset',
  visitCount: 'rastrum.visitCount',
  installHintDismissed: 'rastrum.installHintDismissed',
  pwaInstalled: 'rastrum.pwaInstalled',
  guidePrefix: 'rastrum.guide.',
  identifyModeNotice: 'rastrum_identify_mode_notice_v1',
} as const;

export type PrivacyPreset = 'open_scientist' | 'researcher' | 'private_observer';

export interface UserOnboardingState {
  version: 1;
  /** ISO timestamp when the main OnboardingTour completed. */
  tourCompletedAt: string | null;
  /** Whether the /console onboarding modal has been dismissed. */
  consoleOnboardingDone: boolean;
  /** Whether the ObserveView2 onboarding hint has been shown. */
  obs2OnboardingShown: boolean;
  /** Whether the FirstObservationCelebration has fired (once). */
  firstObsCelebrated: boolean;
  /** ISO timestamp of the user's first sync (introduced by #1186). */
  firstObsSyncedAt: string | null;
  /** Privacy preset chosen during onboarding. */
  privacyPreset: PrivacyPreset | null;
  /** Total recorded visits — drives Install hint and similar. */
  visitCount: number;
  /** Whether the user dismissed the PWA install hint. */
  installHintDismissed: boolean;
  /** Whether the PWA install completed (matches `rastrum.pwaInstalled`). */
  pwaInstalled: boolean;
  /**
   * Per-feature guide completion map. Key is the guide id without the
   * `rastrum.guide.` prefix (e.g. `observe`, `community`, `console`).
   * Value is `'done'` or an ISO date for forward compat.
   */
  guidesSeen: Record<string, string>;
  /** Whether the identify-mode migration notice has been shown. */
  identifyModeNoticeShown: boolean;
}

function defaultState(): UserOnboardingState {
  return {
    version: 1,
    tourCompletedAt: null,
    consoleOnboardingDone: false,
    obs2OnboardingShown: false,
    firstObsCelebrated: false,
    firstObsSyncedAt: null,
    privacyPreset: null,
    visitCount: 0,
    installHintDismissed: false,
    pwaInstalled: false,
    guidesSeen: {},
    identifyModeNoticeShown: false,
  };
}

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

function readStored(): UserOnboardingState | null {
  if (!hasStorage()) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UserOnboardingState>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return { ...defaultState(), ...parsed, version: 1 };
  } catch {
    return null;
  }
}

function writeStored(state: UserOnboardingState): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode — silently ignored, in-memory state still works */
  }
}

/**
 * Read a legacy key, returning null if storage is unavailable or the
 * key is unset. Tolerates empty strings (treated as unset).
 */
function readLegacy(key: string): string | null {
  if (!hasStorage()) return null;
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

function migrateFromLegacy(): UserOnboardingState {
  const state = defaultState();

  if (readLegacy(LEGACY_KEYS.tourSeen) === LEGACY_KEYS.tourSeenValue) {
    state.tourCompletedAt = state.tourCompletedAt ?? new Date(0).toISOString();
  }
  if (readLegacy(LEGACY_KEYS.consoleOnboarding) === 'true') {
    state.consoleOnboardingDone = true;
  }
  if (readLegacy(LEGACY_KEYS.obs2Onboarding) === '1') {
    state.obs2OnboardingShown = true;
  }
  if (readLegacy(LEGACY_KEYS.firstObsCelebrated) === 'true') {
    state.firstObsCelebrated = true;
  }
  const firstSynced = readLegacy(LEGACY_KEYS.firstObsSyncedAt);
  if (firstSynced) {
    state.firstObsSyncedAt = firstSynced;
  }
  const preset = readLegacy(LEGACY_KEYS.privacyPreset);
  if (preset === 'open_scientist' || preset === 'researcher' || preset === 'private_observer') {
    state.privacyPreset = preset;
  }
  const visitRaw = readLegacy(LEGACY_KEYS.visitCount);
  if (visitRaw) {
    const n = Number.parseInt(visitRaw, 10);
    if (Number.isFinite(n) && n > 0) state.visitCount = n;
  }
  if (readLegacy(LEGACY_KEYS.installHintDismissed) === 'true') {
    state.installHintDismissed = true;
  }
  if (readLegacy(LEGACY_KEYS.pwaInstalled) === 'true') {
    state.pwaInstalled = true;
  }
  if (readLegacy(LEGACY_KEYS.identifyModeNotice)) {
    state.identifyModeNoticeShown = true;
  }

  if (hasStorage()) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LEGACY_KEYS.guidePrefix)) continue;
      const value = readLegacy(k);
      if (!value) continue;
      const id = k.slice(LEGACY_KEYS.guidePrefix.length);
      if (id) state.guidesSeen[id] = value;
    }
  }

  return state;
}

let cached: UserOnboardingState | null = null;

/**
 * Reset the in-memory cache. Tests call this between cases to force
 * re-reads against a freshly populated `localStorage`.
 */
export function resetCache(): void {
  cached = null;
}

export function getOnboardingState(): UserOnboardingState {
  if (cached) return cached;
  const stored = readStored();
  if (stored) {
    cached = stored;
    return cached;
  }

  const migrated = migrateFromLegacy();
  if (hasStorage()) {
    writeStored(migrated);
    try {
      localStorage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString());
    } catch {
      /* noop */
    }
  }
  cached = migrated;
  return cached;
}

export function setOnboardingState(patch: Partial<UserOnboardingState>): UserOnboardingState {
  const current = getOnboardingState();
  const next: UserOnboardingState = {
    ...current,
    ...patch,
    guidesSeen: patch.guidesSeen
      ? { ...current.guidesSeen, ...patch.guidesSeen }
      : current.guidesSeen,
    version: 1,
  };
  cached = next;
  writeStored(next);
  return next;
}

export function markTourCompleted(at: Date = new Date()): UserOnboardingState {
  return setOnboardingState({ tourCompletedAt: at.toISOString() });
}

export function markConsoleOnboarded(): UserOnboardingState {
  return setOnboardingState({ consoleOnboardingDone: true });
}

export function markObs2OnboardingShown(): UserOnboardingState {
  return setOnboardingState({ obs2OnboardingShown: true });
}

export function markFirstObsCelebrated(): UserOnboardingState {
  return setOnboardingState({ firstObsCelebrated: true });
}

export function markFirstObsSynced(at: Date = new Date()): UserOnboardingState {
  const current = getOnboardingState();
  if (current.firstObsSyncedAt) return current;
  return setOnboardingState({ firstObsSyncedAt: at.toISOString() });
}

export function setPrivacyPreset(preset: PrivacyPreset): UserOnboardingState {
  return setOnboardingState({ privacyPreset: preset });
}

export function incrementVisitCount(by = 1): UserOnboardingState {
  const current = getOnboardingState();
  return setOnboardingState({ visitCount: current.visitCount + by });
}

export function markInstallHintDismissed(): UserOnboardingState {
  return setOnboardingState({ installHintDismissed: true });
}

export function markPwaInstalled(): UserOnboardingState {
  return setOnboardingState({ pwaInstalled: true });
}

export function markGuideSeen(guideId: string, value = 'done'): UserOnboardingState {
  const id = guideId.startsWith(LEGACY_KEYS.guidePrefix)
    ? guideId.slice(LEGACY_KEYS.guidePrefix.length)
    : guideId;
  return setOnboardingState({ guidesSeen: { [id]: value } });
}

export function hasSeenGuide(guideId: string): boolean {
  const id = guideId.startsWith(LEGACY_KEYS.guidePrefix)
    ? guideId.slice(LEGACY_KEYS.guidePrefix.length)
    : guideId;
  return Boolean(getOnboardingState().guidesSeen[id]);
}

export function markIdentifyModeNoticeShown(): UserOnboardingState {
  return setOnboardingState({ identifyModeNoticeShown: true });
}

/**
 * Debug helper: snapshot of every legacy key the migration looks at,
 * for the "Export my state" affordance and operator diagnostics.
 * Returns an empty object when storage is unavailable.
 */
export function dumpLegacyKeys(): Record<string, string> {
  if (!hasStorage()) return {};
  const out: Record<string, string> = {};
  const tracked = new Set<string>([
    LEGACY_KEYS.tourSeen,
    LEGACY_KEYS.consoleOnboarding,
    LEGACY_KEYS.obs2Onboarding,
    LEGACY_KEYS.firstObsCelebrated,
    LEGACY_KEYS.firstObsSyncedAt,
    LEGACY_KEYS.privacyPreset,
    LEGACY_KEYS.visitCount,
    LEGACY_KEYS.installHintDismissed,
    LEGACY_KEYS.pwaInstalled,
    LEGACY_KEYS.identifyModeNotice,
  ]);
  for (const k of tracked) {
    const v = readLegacy(k);
    if (v !== null) out[k] = v;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LEGACY_KEYS.guidePrefix)) {
      const v = readLegacy(k);
      if (v !== null) out[k] = v;
    }
  }
  return out;
}

/**
 * Clear the centralised state. Does NOT touch the legacy keys (some
 * surfaces still own their own key during the gradual migration).
 * Tests use this between cases.
 */
export function clearOnboardingState(): void {
  cached = null;
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MIGRATION_MARKER_KEY);
  } catch {
    /* noop */
  }
}
