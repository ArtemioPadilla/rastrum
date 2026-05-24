/**
 * PWA install prompt — value-first deferral.
 *
 * The InstallDiscoveryHint banner used to fire on the user's 2nd page
 * visit (`localStorage.rastrum.visitCount >= 2`). On a first /observar/
 * visit the value proposition ("works offline, saves your observations")
 * has not been demonstrated yet, so the prompt mostly trains the user to
 * dismiss it.
 *
 * The new gate fires AFTER the first successfully synced observation.
 * `src/lib/sync.ts` writes `localStorage.rastrum.obs.firstSyncedAt` in the
 * existing `count === 1` block (same one that emits the PostHog
 * `onboarding:first_observation` event), and InstallDiscoveryHint checks
 * that key in its `init()` gate.
 *
 * These are source-string assertions — the same shape used by
 * `species-explorer-p2.test.ts` — because the script in
 * InstallDiscoveryHint.astro is Astro-compiled client code that we don't
 * execute in JSDOM at test time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const hintSrc = readFileSync(
  resolve(process.cwd(), 'src/components/InstallDiscoveryHint.astro'),
  'utf-8',
);

const syncSrc = readFileSync(
  resolve(process.cwd(), 'src/lib/sync.ts'),
  'utf-8',
);

describe('PWA install prompt — value-first gate (after first synced obs)', () => {
  it('sync.ts writes rastrum.obs.firstSyncedAt on count === 1', () => {
    // The write must live inside the existing `count === 1` block so the
    // moment is captured exactly once — on the first successful sync.
    const countOneIdx = syncSrc.indexOf('if (count === 1)');
    expect(countOneIdx, 'count===1 block must exist in sync.ts').toBeGreaterThan(-1);

    const blockTail = syncSrc.slice(countOneIdx);
    expect(blockTail).toContain("'rastrum.obs.firstSyncedAt'");
    expect(blockTail).toContain('localStorage.setItem');
    // Idempotency guard: don't overwrite an existing timestamp.
    expect(blockTail).toContain("getItem('rastrum.obs.firstSyncedAt')");
  });

  it('sync.ts guards the localStorage write against private mode / SSR', () => {
    // localStorage is undefined in some browser privacy modes and in
    // service-worker / SSR contexts. The write must not throw.
    expect(syncSrc).toMatch(/typeof localStorage !== 'undefined'/);
  });

  it('InstallDiscoveryHint declares the firstobs-key dataset hook', () => {
    expect(hintSrc).toContain('data-firstobs-key="rastrum.obs.firstSyncedAt"');
    expect(hintSrc).toContain("const FIRSTOBS_KEY = root.dataset.firstobsKey");
  });

  it('InstallDiscoveryHint defines hasFirstSyncedObs() reading FIRSTOBS_KEY', () => {
    expect(hintSrc).toContain('function hasFirstSyncedObs(): boolean');
    expect(hintSrc).toMatch(/localStorage\.getItem\(FIRSTOBS_KEY\)/);
  });

  it('InstallDiscoveryHint gates init() on hasFirstSyncedObs(), NOT on visit count', () => {
    // Regression guard: the old `if (count < 2) return;` gate must be gone.
    expect(hintSrc).not.toMatch(/if\s*\(\s*count\s*<\s*2\s*\)\s*return/);
    // New gate is in place.
    expect(hintSrc).toContain('if (!hasFirstSyncedObs()) return;');
  });

  it('InstallDiscoveryHint still honours the dismissed key', () => {
    // The dismissal flow must not regress — once a user clicks "Ahora no",
    // the banner stays gone permanently regardless of the firstobs gate.
    expect(hintSrc).toContain("DISMISSED_KEY = root.dataset.dismissedKey ?? 'rastrum.installHintDismissed'");
    expect(hintSrc).toContain("function isDismissed(): boolean");
    expect(hintSrc).toContain('if (isPwaInstalled() || isDismissed()) return;');
  });
});
