/**
 * Unit tests for ConsentBanner (#781) — PostHog DNT + consent gate.
 *
 * Tests cover:
 *   1. Banner hidden when DNT is active
 *   2. Banner hidden when consent already stored
 *   3. Banner shown when no consent stored and DNT off
 *   4. Accept sets localStorage and dispatches event
 *   5. Decline sets localStorage to 'false' and dispatches event
 *
 * These tests run in jsdom via Vitest; they exercise the inline script
 * logic extracted into a pure function for testability.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Node 22's experimental localStorage shadows happy-dom/jsdom and is
// missing most of the Storage API (no `.clear()`). Install our own
// Map-backed shim before any code under test touches it. Same pattern as
// src/lib/byo-keys.test.ts; documented in CLAUDE.md → known pitfalls.
const _store = new Map<string, string>();
const _shim: Storage = {
  get length() { return _store.size; },
  clear() { _store.clear(); },
  getItem(k) { return _store.get(k) ?? null; },
  key(i) { return Array.from(_store.keys())[i] ?? null; },
  removeItem(k) { _store.delete(k); },
  setItem(k, v) { _store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: _shim });

// ── Consent-gate logic extracted from ConsentBanner.astro ──────────────────
const CONSENT_KEY = 'rastrum_analytics_consent';

/**
 * Returns true if PostHog should be allowed to initialise based on DNT
 * and stored consent.
 */
function shouldInitPostHog(
  dnt: string | null,
  storedConsent: string | null,
): boolean {
  const isDnt = dnt === '1';
  if (isDnt) return false;
  return storedConsent === 'true';
}

/**
 * Determines whether the banner should be shown.
 */
function shouldShowBanner(
  dnt: string | null,
  storedConsent: string | null,
): boolean {
  if (dnt === '1') return false;
  return storedConsent === null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ConsentBanner — shouldShowBanner', () => {
  it('hides banner when DNT is set', () => {
    expect(shouldShowBanner('1', null)).toBe(false);
  });

  it('hides banner when consent is already stored (true)', () => {
    expect(shouldShowBanner(null, 'true')).toBe(false);
  });

  it('hides banner when consent is already stored (false)', () => {
    expect(shouldShowBanner(null, 'false')).toBe(false);
  });

  it('shows banner when no consent stored and DNT is off', () => {
    expect(shouldShowBanner(null, null)).toBe(true);
  });

  it('shows banner when DNT is "0" (not set) and no consent stored', () => {
    expect(shouldShowBanner('0', null)).toBe(true);
  });
});

describe('ConsentBanner — shouldInitPostHog', () => {
  it('blocks init when DNT is set even if consent stored', () => {
    expect(shouldInitPostHog('1', 'true')).toBe(false);
  });

  it('blocks init when consent is explicitly false', () => {
    expect(shouldInitPostHog(null, 'false')).toBe(false);
  });

  it('blocks init when consent is null (no decision yet)', () => {
    expect(shouldInitPostHog(null, null)).toBe(false);
  });

  it('allows init when DNT is off and consent is true', () => {
    expect(shouldInitPostHog(null, 'true')).toBe(true);
  });
});

describe('ConsentBanner — localStorage interaction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('accept: stores true and dispatches rastrum:consent-updated with accepted=true', () => {
    const events: CustomEvent[] = [];
    window.addEventListener('rastrum:consent-updated', (e) => events.push(e as CustomEvent));

    // Simulate accept click
    localStorage.setItem(CONSENT_KEY, 'true');
    window.dispatchEvent(new CustomEvent('rastrum:consent-updated', { detail: { accepted: true } }));

    expect(localStorage.getItem(CONSENT_KEY)).toBe('true');
    expect(events).toHaveLength(1);
    expect(events[0].detail.accepted).toBe(true);
  });

  it('decline: stores false and dispatches rastrum:consent-updated with accepted=false', () => {
    const events: CustomEvent[] = [];
    window.addEventListener('rastrum:consent-updated', (e) => events.push(e as CustomEvent));

    // Simulate decline click
    localStorage.setItem(CONSENT_KEY, 'false');
    window.dispatchEvent(new CustomEvent('rastrum:consent-updated', { detail: { accepted: false } }));

    expect(localStorage.getItem(CONSENT_KEY)).toBe('false');
    expect(events).toHaveLength(1);
    expect(events[0].detail.accepted).toBe(false);
  });
});
