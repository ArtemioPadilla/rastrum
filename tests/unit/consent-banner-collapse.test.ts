/**
 * Source-string assertions for the ConsentBanner slim/collapsed redesign
 * (PBI 1.1 from the UI/UX audit roadmap).
 *
 * The banner is rendered by Astro; these tests grep the .astro source to
 * pin the load-bearing pieces of the redesign so a future refactor that
 * drops them fails CI loudly.
 *
 * Pinned invariants:
 *   1. Default banner is height-constrained (≤ 80 px) — `max-height: 80px`.
 *   2. Banner installs a scroll listener with a 200-px threshold.
 *   3. Dismiss key is unchanged (`rastrum_analytics_consent`).
 *   4. `prefers-reduced-motion: reduce` block is present.
 *   5. Collapsed pill exists (data-collapsed attribute + #rastrum-consent-toast).
 *   6. New i18n key `consent.toast_label` is present in EN + ES.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const BANNER_SRC = readFileSync(
  resolve(ROOT, 'src/components/ConsentBanner.astro'),
  'utf8',
);
const EN_STRINGS = JSON.parse(
  readFileSync(resolve(ROOT, 'src/i18n/en.json'), 'utf8'),
);
const ES_STRINGS = JSON.parse(
  readFileSync(resolve(ROOT, 'src/i18n/es.json'), 'utf8'),
);

describe('ConsentBanner — slim bottom-sheet (PBI 1.1)', () => {
  it('caps default-state height at 80 px', () => {
    expect(BANNER_SRC).toMatch(/max-height:\s*80px/);
  });

  it('binds a scroll listener', () => {
    expect(BANNER_SRC).toMatch(/addEventListener\(\s*['"]scroll['"]/);
  });

  it('uses a 200-px scroll threshold for the auto-collapse trigger', () => {
    expect(BANNER_SRC).toMatch(/SCROLL_THRESHOLD\s*=\s*200/);
  });

  it('reads the unchanged consent dismiss key (regression guard)', () => {
    expect(BANNER_SRC).toMatch(
      /CONSENT_KEY\s*=\s*['"]rastrum_analytics_consent['"]/,
    );
  });

  it('honours prefers-reduced-motion: reduce', () => {
    expect(BANNER_SRC).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('renders a collapsed toast pill (data-collapsed + #rastrum-consent-toast)', () => {
    expect(BANNER_SRC).toMatch(/data-collapsed/);
    expect(BANNER_SRC).toMatch(/id=["']rastrum-consent-toast["']/);
  });

  it('toggles data-collapsed on toast click (re-expand)', () => {
    expect(BANNER_SRC).toMatch(/rastrum-consent-toast[\s\S]*?setCollapsed\(false\)/);
  });
});

describe('ConsentBanner — i18n parity for toast_label', () => {
  it('EN has consent.toast_label', () => {
    expect(EN_STRINGS.consent.toast_label).toBeTruthy();
    expect(typeof EN_STRINGS.consent.toast_label).toBe('string');
  });

  it('ES has consent.toast_label', () => {
    expect(ES_STRINGS.consent.toast_label).toBeTruthy();
    expect(typeof ES_STRINGS.consent.toast_label).toBe('string');
  });
});
