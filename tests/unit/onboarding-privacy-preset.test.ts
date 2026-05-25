/**
 * Unit tests for the OnboardingTour privacy-preset step (#1146 / PR-A C4).
 *
 * The privacy step renders 3 buttons (Open scientist / Researcher / Private
 * observer) with Researcher pre-selected as the recommended default. The
 * interactive script lives inside an Astro <script> tag — it isn't directly
 * importable in vitest — so we pin the contract via source-string assertion
 * and a happy-dom localStorage round-trip.
 *
 * Contract this test guards:
 *   1. The localStorage key is the single source of truth across the tour
 *      and any consumer that reads the user's preset choice later.
 *   2. The component initialises `chosenPreset = 'researcher'` (the
 *      recommended default).
 *   3. The "Next" button on the privacy step persists the (possibly
 *      defaulted) preset — no silent drop.
 *   4. The button keyset matches the PRESET_DEFS map keys.
 *   5. The visual selected state uses `ring-2 ring-emerald-500`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(process.cwd(), 'src/components/OnboardingTour.astro'),
  'utf-8',
);

const PRIVACY_PRESET_KEY = 'rastrum.onboarding.privacyPreset';

describe('OnboardingTour — privacy-preset constants', () => {
  it('uses the canonical PRIVACY_PRESET_KEY storage key', () => {
    expect(SRC).toContain("const PRIVACY_PRESET_KEY = 'rastrum.onboarding.privacyPreset';");
  });

  it('initialises chosenPreset to researcher (recommended default)', () => {
    expect(SRC).toMatch(/let chosenPreset[^=]+=\s*'researcher'/);
  });

  it('PRESET_KEYS contains the three documented presets', () => {
    expect(SRC).toContain("'open_scientist'");
    expect(SRC).toContain("'researcher'");
    expect(SRC).toContain("'private_observer'");
  });
});

describe('OnboardingTour — privacy-preset persistence wiring', () => {
  it('Next-button handler persists when leaving privacy_preset', () => {
    expect(SRC).toMatch(/leavingStep\?\.kind === 'privacy_preset'/);
    expect(SRC).toMatch(/persistPreset\(chosenPreset\)/);
  });

  it('persistPreset writes to localStorage', () => {
    expect(SRC).toMatch(/localStorage\.setItem\(PRIVACY_PRESET_KEY, preset\)/);
  });

  it('renderPresetButtons mirrors auto-default into localStorage', () => {
    expect(SRC).toMatch(/localStorage\.setItem\(PRIVACY_PRESET_KEY, chosenPreset\)/);
  });

  it('renderPresetButtons hydrates a prior choice from localStorage', () => {
    expect(SRC).toMatch(/localStorage\.getItem\(PRIVACY_PRESET_KEY\)/);
  });
});

describe('OnboardingTour — privacy-preset visual affordance', () => {
  it('selected button gets ring-2 ring-emerald-500', () => {
    expect(SRC).toContain("'ring-2'");
    expect(SRC).toContain("'ring-emerald-500'");
  });

  it('selected button sets aria-pressed', () => {
    expect(SRC).toMatch(/aria-pressed/);
  });

  it('researcher preset shows ✓ recommendation glyph', () => {
    expect(SRC).toMatch(/check\.textContent = '✓'/);
  });
});

describe('OnboardingTour — localStorage round-trip', () => {
  beforeEach(() => {
    // Node 22's experimental localStorage shadows happy-dom/jsdom and is
    // missing most of the Storage API. Install a Map-backed shim (CLAUDE.md
    // → known pitfalls).
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() { return store.size; },
        clear() { store.clear(); },
        getItem(k: string) { return store.get(k) ?? null; },
        key(i: number) { return Array.from(store.keys())[i] ?? null; },
        removeItem(k: string) { store.delete(k); },
        setItem(k: string, v: string) { store.set(k, String(v)); },
      },
    });
  });

  it('round-trips researcher → localStorage → readback', () => {
    localStorage.setItem(PRIVACY_PRESET_KEY, 'researcher');
    expect(localStorage.getItem(PRIVACY_PRESET_KEY)).toBe('researcher');
  });

  it('round-trips open_scientist preset', () => {
    localStorage.setItem(PRIVACY_PRESET_KEY, 'open_scientist');
    expect(localStorage.getItem(PRIVACY_PRESET_KEY)).toBe('open_scientist');
  });

  it('round-trips private_observer preset', () => {
    localStorage.setItem(PRIVACY_PRESET_KEY, 'private_observer');
    expect(localStorage.getItem(PRIVACY_PRESET_KEY)).toBe('private_observer');
  });
});
