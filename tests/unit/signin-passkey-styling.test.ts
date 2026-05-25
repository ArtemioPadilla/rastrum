/**
 * PBI 5.2 — passkey button styling parity with Google + GitHub OAuth
 * buttons.
 *
 * The current defect was an emerald-tinted passkey button that visually
 * implied "recommended default", contradicting the magic-link-first
 * onboarding. This pins the passkey button to the same neutral white /
 * gray-border surface used by the Google and GitHub buttons.
 *
 * Source-string assertions on SignInForm.astro, matching the shape of
 * `signin-microcopy.test.ts`: the client logic lives inside an Astro
 * `<script>`, so we test the SSR markup directly rather than mounting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentSrc = readFileSync(
  join(process.cwd(), 'src/components/SignInForm.astro'),
  'utf8',
);

function extractButtonClass(id: string): string {
  const re = new RegExp(`<button[^>]*id="${id}"[^>]*class="([^"]+)"`, 'i');
  const match = componentSrc.match(re);
  if (!match) throw new Error(`Could not find #${id} button in SignInForm.astro`);
  return match[1];
}

describe('PBI 5.2 — passkey button styling parity', () => {
  const passkeyClass = extractButtonClass('passkey-btn');
  const googleClass = extractButtonClass('google-btn');
  const githubClass = extractButtonClass('github-btn');

  it('passkey button has no emerald-tinted background', () => {
    expect(passkeyClass.toLowerCase()).not.toMatch(/\bbg-emerald-\d+/);
    // dark:bg-emerald-* counts too
    expect(passkeyClass.toLowerCase()).not.toMatch(/bg-emerald-\d/);
  });

  it('passkey button has no emerald-tinted border', () => {
    expect(passkeyClass.toLowerCase()).not.toMatch(/border-emerald/);
  });

  it('passkey button has no emerald-tinted text', () => {
    expect(passkeyClass.toLowerCase()).not.toMatch(/\btext-emerald-\d+/);
  });

  it('passkey button has no emerald-tinted hover state', () => {
    expect(passkeyClass.toLowerCase()).not.toMatch(/hover:bg-emerald/);
  });

  it('passkey button uses the same neutral OAuth surface as Google', () => {
    // The neutral OAuth surface: white background, zinc border, zinc text.
    const expectedTokens = [
      'bg-white',
      'dark:bg-zinc-900',
      'border-zinc-300',
      'dark:border-zinc-700',
      'text-zinc-700',
      'dark:text-zinc-200',
      'hover:bg-zinc-50',
      'dark:hover:bg-zinc-800/40',
    ];
    for (const token of expectedTokens) {
      expect(passkeyClass).toContain(token);
      expect(googleClass).toContain(token);
    }
  });

  it('passkey button matches GitHub button on the OAuth surface tokens', () => {
    const surfaceTokens = [
      'bg-white',
      'dark:bg-zinc-900',
      'border-zinc-300',
      'dark:border-zinc-700',
    ];
    for (const token of surfaceTokens) {
      expect(passkeyClass).toContain(token);
      expect(githubClass).toContain(token);
    }
  });

  it('passkey button keeps its hidden-until-WebAuthn-detected default', () => {
    // The reveal logic flips this off via classList.remove('hidden')
    // when passkeySupported() is true — regression guard for the prior
    // visibility contract.
    expect(passkeyClass).toMatch(/\bhidden\b/);
  });
});
