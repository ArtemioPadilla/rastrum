import { describe, it, expect, beforeEach } from 'vitest';

// Node 22's experimental localStorage is missing methods needed by the
// module (notably `length` + `key(i)`). Install our own Map-backed shim
// before the module-under-test imports, mirroring the pattern in
// `src/lib/byo-keys.test.ts`.
const _store = new Map<string, string>();
const shim: Storage = {
  get length() { return _store.size; },
  clear() { _store.clear(); },
  getItem(k) { return _store.get(k) ?? null; },
  key(i) { return Array.from(_store.keys())[i] ?? null; },
  removeItem(k) { _store.delete(k); },
  setItem(k, v) { _store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: shim });

import {
  LEGACY_KEYS,
  getOnboardingState,
  setOnboardingState,
  markTourCompleted,
  markConsoleOnboarded,
  markObs2OnboardingShown,
  markFirstObsCelebrated,
  markFirstObsSynced,
  setPrivacyPreset,
  incrementVisitCount,
  markInstallHintDismissed,
  markPwaInstalled,
  markGuideSeen,
  hasSeenGuide,
  markIdentifyModeNoticeShown,
  dumpLegacyKeys,
  clearOnboardingState,
  resetCache,
} from '../../src/lib/onboarding-state';

beforeEach(() => {
  _store.clear();
  resetCache();
});

describe('onboarding-state — defaults', () => {
  it('returns a default state when localStorage is empty', () => {
    const s = getOnboardingState();
    expect(s.version).toBe(1);
    expect(s.tourCompletedAt).toBeNull();
    expect(s.consoleOnboardingDone).toBe(false);
    expect(s.obs2OnboardingShown).toBe(false);
    expect(s.firstObsCelebrated).toBe(false);
    expect(s.firstObsSyncedAt).toBeNull();
    expect(s.privacyPreset).toBeNull();
    expect(s.visitCount).toBe(0);
    expect(s.installHintDismissed).toBe(false);
    expect(s.pwaInstalled).toBe(false);
    expect(s.guidesSeen).toEqual({});
    expect(s.identifyModeNoticeShown).toBe(false);
  });

  it('persists the default state on first read so a re-read is fast', () => {
    getOnboardingState();
    expect(localStorage.getItem('rastrum.user.onboardingState')).not.toBeNull();
  });
});

describe('onboarding-state — legacy migration', () => {
  it('migrates rastrum.onboarding.seen=v1 into tourCompletedAt', () => {
    localStorage.setItem(LEGACY_KEYS.tourSeen, LEGACY_KEYS.tourSeenValue);
    const s = getOnboardingState();
    expect(s.tourCompletedAt).not.toBeNull();
  });

  it('migrates rastrum.console.onboardingDone=true', () => {
    localStorage.setItem(LEGACY_KEYS.consoleOnboarding, 'true');
    expect(getOnboardingState().consoleOnboardingDone).toBe(true);
  });

  it('migrates rastrum.obs2.onboarding_shown=1', () => {
    localStorage.setItem(LEGACY_KEYS.obs2Onboarding, '1');
    expect(getOnboardingState().obs2OnboardingShown).toBe(true);
  });

  it('migrates rastrum.firstObservationCelebrated=true', () => {
    localStorage.setItem(LEGACY_KEYS.firstObsCelebrated, 'true');
    expect(getOnboardingState().firstObsCelebrated).toBe(true);
  });

  it('migrates rastrum.obs.firstSyncedAt verbatim', () => {
    const iso = '2026-05-01T12:00:00.000Z';
    localStorage.setItem(LEGACY_KEYS.firstObsSyncedAt, iso);
    expect(getOnboardingState().firstObsSyncedAt).toBe(iso);
  });

  it('migrates rastrum.onboarding.privacyPreset only for the 3 known values', () => {
    localStorage.setItem(LEGACY_KEYS.privacyPreset, 'researcher');
    expect(getOnboardingState().privacyPreset).toBe('researcher');

    _store.clear();
    resetCache();
    localStorage.setItem(LEGACY_KEYS.privacyPreset, 'open_scientist');
    expect(getOnboardingState().privacyPreset).toBe('open_scientist');

    _store.clear();
    resetCache();
    localStorage.setItem(LEGACY_KEYS.privacyPreset, 'private_observer');
    expect(getOnboardingState().privacyPreset).toBe('private_observer');

    _store.clear();
    resetCache();
    localStorage.setItem(LEGACY_KEYS.privacyPreset, 'random_garbage');
    expect(getOnboardingState().privacyPreset).toBeNull();
  });

  it('migrates rastrum.visitCount as a positive integer', () => {
    localStorage.setItem(LEGACY_KEYS.visitCount, '7');
    expect(getOnboardingState().visitCount).toBe(7);
  });

  it('ignores garbage visitCount values', () => {
    localStorage.setItem(LEGACY_KEYS.visitCount, 'not-a-number');
    expect(getOnboardingState().visitCount).toBe(0);
  });

  it('migrates rastrum.installHintDismissed + rastrum.pwaInstalled', () => {
    localStorage.setItem(LEGACY_KEYS.installHintDismissed, 'true');
    localStorage.setItem(LEGACY_KEYS.pwaInstalled, 'true');
    const s = getOnboardingState();
    expect(s.installHintDismissed).toBe(true);
    expect(s.pwaInstalled).toBe(true);
  });

  it('migrates every rastrum.guide.* key into guidesSeen', () => {
    localStorage.setItem('rastrum.guide.observe', 'done');
    localStorage.setItem('rastrum.guide.community', 'done');
    localStorage.setItem('rastrum.guide.console', 'done');
    const s = getOnboardingState();
    expect(s.guidesSeen).toEqual({
      observe: 'done',
      community: 'done',
      console: 'done',
    });
  });

  it('migrates the identify-mode notice marker', () => {
    localStorage.setItem(LEGACY_KEYS.identifyModeNotice, '1');
    expect(getOnboardingState().identifyModeNoticeShown).toBe(true);
  });

  it('does NOT delete the legacy keys (migration is non-destructive)', () => {
    localStorage.setItem(LEGACY_KEYS.tourSeen, LEGACY_KEYS.tourSeenValue);
    localStorage.setItem(LEGACY_KEYS.visitCount, '3');
    getOnboardingState();
    expect(localStorage.getItem(LEGACY_KEYS.tourSeen)).toBe(LEGACY_KEYS.tourSeenValue);
    expect(localStorage.getItem(LEGACY_KEYS.visitCount)).toBe('3');
  });

  it('migration runs only once — second read returns the persisted state', () => {
    localStorage.setItem(LEGACY_KEYS.visitCount, '5');
    expect(getOnboardingState().visitCount).toBe(5);

    // Mutate the legacy key after the first read — second read MUST
    // ignore it (stored state is the source of truth from now on).
    localStorage.setItem(LEGACY_KEYS.visitCount, '999');
    resetCache();
    expect(getOnboardingState().visitCount).toBe(5);
  });
});

describe('onboarding-state — setOnboardingState', () => {
  it('merges patch into current state and persists', () => {
    setOnboardingState({ visitCount: 4, consoleOnboardingDone: true });
    resetCache();
    const s = getOnboardingState();
    expect(s.visitCount).toBe(4);
    expect(s.consoleOnboardingDone).toBe(true);
    expect(s.obs2OnboardingShown).toBe(false); // untouched
  });

  it('deep-merges guidesSeen rather than replacing it', () => {
    setOnboardingState({ guidesSeen: { observe: 'done' } });
    setOnboardingState({ guidesSeen: { community: 'done' } });
    const s = getOnboardingState();
    expect(s.guidesSeen).toEqual({ observe: 'done', community: 'done' });
  });

  it('always forces version=1 regardless of patch', () => {
    setOnboardingState({ version: 99 as unknown as 1 });
    expect(getOnboardingState().version).toBe(1);
  });
});

describe('onboarding-state — convenience accessors', () => {
  it('markTourCompleted writes an ISO timestamp', () => {
    const at = new Date('2026-05-24T10:00:00.000Z');
    markTourCompleted(at);
    expect(getOnboardingState().tourCompletedAt).toBe(at.toISOString());
  });

  it('markConsoleOnboarded flips the flag', () => {
    markConsoleOnboarded();
    expect(getOnboardingState().consoleOnboardingDone).toBe(true);
  });

  it('markObs2OnboardingShown flips the flag', () => {
    markObs2OnboardingShown();
    expect(getOnboardingState().obs2OnboardingShown).toBe(true);
  });

  it('markFirstObsCelebrated flips the flag', () => {
    markFirstObsCelebrated();
    expect(getOnboardingState().firstObsCelebrated).toBe(true);
  });

  it('markFirstObsSynced is idempotent — only stamps once', () => {
    const first = new Date('2026-05-01T00:00:00.000Z');
    const later = new Date('2026-05-10T00:00:00.000Z');
    markFirstObsSynced(first);
    markFirstObsSynced(later);
    expect(getOnboardingState().firstObsSyncedAt).toBe(first.toISOString());
  });

  it('setPrivacyPreset records the choice', () => {
    setPrivacyPreset('researcher');
    expect(getOnboardingState().privacyPreset).toBe('researcher');
  });

  it('incrementVisitCount adds by 1 by default and N when passed', () => {
    incrementVisitCount();
    incrementVisitCount(3);
    expect(getOnboardingState().visitCount).toBe(4);
  });

  it('markInstallHintDismissed + markPwaInstalled set their flags', () => {
    markInstallHintDismissed();
    markPwaInstalled();
    const s = getOnboardingState();
    expect(s.installHintDismissed).toBe(true);
    expect(s.pwaInstalled).toBe(true);
  });

  it('markGuideSeen accepts bare ids or the rastrum.guide.* form', () => {
    markGuideSeen('observe');
    markGuideSeen('rastrum.guide.community');
    const s = getOnboardingState();
    expect(s.guidesSeen.observe).toBe('done');
    expect(s.guidesSeen.community).toBe('done');
  });

  it('hasSeenGuide returns true after markGuideSeen and false otherwise', () => {
    expect(hasSeenGuide('observe')).toBe(false);
    markGuideSeen('observe');
    expect(hasSeenGuide('observe')).toBe(true);
    expect(hasSeenGuide('rastrum.guide.observe')).toBe(true);
  });

  it('markIdentifyModeNoticeShown flips the flag', () => {
    markIdentifyModeNoticeShown();
    expect(getOnboardingState().identifyModeNoticeShown).toBe(true);
  });
});

describe('onboarding-state — dumpLegacyKeys', () => {
  it('returns the populated legacy values', () => {
    localStorage.setItem(LEGACY_KEYS.tourSeen, 'v1');
    localStorage.setItem(LEGACY_KEYS.visitCount, '12');
    localStorage.setItem('rastrum.guide.observe', 'done');
    const dump = dumpLegacyKeys();
    expect(dump[LEGACY_KEYS.tourSeen]).toBe('v1');
    expect(dump[LEGACY_KEYS.visitCount]).toBe('12');
    expect(dump['rastrum.guide.observe']).toBe('done');
  });

  it('returns an empty object when no legacy keys exist', () => {
    expect(dumpLegacyKeys()).toEqual({});
  });
});

describe('onboarding-state — clearOnboardingState', () => {
  it('removes the centralised key but leaves legacy keys untouched', () => {
    localStorage.setItem(LEGACY_KEYS.visitCount, '5');
    incrementVisitCount(); // forces migration + write
    expect(localStorage.getItem('rastrum.user.onboardingState')).not.toBeNull();

    clearOnboardingState();
    expect(localStorage.getItem('rastrum.user.onboardingState')).toBeNull();
    expect(localStorage.getItem(LEGACY_KEYS.visitCount)).toBe('5');
  });

  it('clears the in-memory cache so the next read re-migrates', () => {
    localStorage.setItem(LEGACY_KEYS.visitCount, '8');
    expect(getOnboardingState().visitCount).toBe(8);
    clearOnboardingState();
    expect(getOnboardingState().visitCount).toBe(8); // re-migrated from legacy
  });
});

describe('onboarding-state — SSR safety', () => {
  it('returns a default state and no-ops when localStorage is undefined', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    resetCache();
    try {
      const s = getOnboardingState();
      expect(s.version).toBe(1);
      expect(s.visitCount).toBe(0);

      // Mutating accessors must not throw.
      expect(() => incrementVisitCount()).not.toThrow();
      expect(() => markTourCompleted()).not.toThrow();
      expect(() => markGuideSeen('observe')).not.toThrow();
      expect(() => clearOnboardingState()).not.toThrow();
      expect(dumpLegacyKeys()).toEqual({});
    } finally {
      if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    }
  });
});
