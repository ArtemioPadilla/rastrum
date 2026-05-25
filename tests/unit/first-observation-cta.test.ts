/**
 * Source-string assertions for the post-tour first-observation empty
 * state — a prominent emerald card that lands users on the action
 * primary (Take a photo now) immediately after the onboarding tour.
 *
 * Why source-strings instead of DOM-driven: the gate runs inside an
 * Astro client `<script>` (not the SSR pass), so jsdom-style asserts
 * would require booting the page. The contract worth pinning is
 * structural (default-hidden + gate-condition + locale-paired link
 * + i18n parity + dismiss-flag persistence), which source-strings
 * cover cheaply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentPath = join(
  process.cwd(),
  'src/components/home/FirstObservationCTA.astro',
);
const componentSrc = readFileSync(componentPath, 'utf8');

const homeWidgetsSrc = readFileSync(
  join(process.cwd(), 'src/components/HomeWidgets.astro'),
  'utf8',
);

const enJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8'),
) as Record<string, unknown>;
const esJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/es.json'), 'utf8'),
) as Record<string, unknown>;

interface I18nShape {
  home: {
    widgets: {
      first_obs_cta: {
        heading: string;
        body: string;
        primary: string;
        secondary: string;
      };
    };
  };
}

describe('FirstObservationCTA — post-tour empty state', () => {
  it('ships hidden by default (SSR cloak; client reveals after gate)', () => {
    expect(componentSrc).toMatch(
      /class="first-obs-cta hidden\b[^"]*"/,
    );
  });

  it('the dismiss flag is persisted to localStorage on click', () => {
    expect(componentSrc).toMatch(
      /localStorage\.setItem\(\s*dismissedKey\s*,\s*'true'\s*\)/,
    );
    expect(componentSrc).toMatch(
      /rastrum\.user\.onboardingState\.firstObsCtaDismissed/,
    );
  });

  it('gates on all three conditions: tour seen, not dismissed, no first obs', () => {
    expect(componentSrc).toMatch(/tourSeen\s*=\s*localStorage\.getItem\(seenKey\)\s*===\s*seenVal/);
    expect(componentSrc).toMatch(/dismissed\s*=\s*localStorage\.getItem\(dismissedKey\)\s*===\s*'true'/);
    expect(componentSrc).toMatch(/if\s*\(\s*!tourSeen\s*\|\|\s*dismissed\s*\)\s*return/);
    expect(componentSrc).toMatch(/\.from\(\s*'observations'\s*\)/);
    expect(componentSrc).toMatch(/\.eq\(\s*'observer_id'\s*,\s*user\.id\s*\)/);
    expect(componentSrc).toMatch(/\.limit\(\s*1\s*\)/);
    expect(componentSrc).toMatch(/hasFirstObs/);
    expect(componentSrc).toMatch(/if\s*\(\s*hasFirstObs\s*\)\s*return/);
  });

  it('reveals via classList.remove("hidden") after gate passes', () => {
    expect(componentSrc).toMatch(/root\.classList\.remove\(\s*['"]hidden['"]\s*\)/);
  });

  it('uses the legacy tour-completed key rastrum.onboarding.seen=v1', () => {
    expect(componentSrc).toMatch(/data-tour-seen-key="rastrum\.onboarding\.seen"/);
    expect(componentSrc).toMatch(/data-tour-seen-value="v1"/);
  });

  it('does not regress the bounded-probe rule (#1072): no count:exact, no head:true', () => {
    expect(componentSrc).not.toMatch(/count:\s*'exact'/);
    expect(componentSrc).not.toMatch(/head:\s*true/);
  });

  it('uses locale-paired observe link (EN /observe/, ES /observar/)', () => {
    expect(componentSrc).toMatch(/lang === 'es'\s*\?\s*'\/es\/observar\/'\s*:\s*'\/en\/observe\/'/);
  });
});

describe('FirstObservationCTA — i18n parity (EN + ES)', () => {
  for (const [name, root] of [
    ['en', enJson],
    ['es', esJson],
  ] as const) {
    it(`${name} has every first_obs_cta key (heading/body/primary/secondary)`, () => {
      const c = (root as unknown as I18nShape).home.widgets.first_obs_cta;
      expect(c.heading).toBeTruthy();
      expect(c.body).toBeTruthy();
      expect(c.primary).toBeTruthy();
      expect(c.secondary).toBeTruthy();
    });
  }

  it('EN heading is "Your first observation is waiting"', () => {
    const c = (enJson as unknown as I18nShape).home.widgets.first_obs_cta;
    expect(c.heading).toBe('Your first observation is waiting');
  });

  it('ES heading is "Tu primera observación te espera"', () => {
    const c = (esJson as unknown as I18nShape).home.widgets.first_obs_cta;
    expect(c.heading).toBe('Tu primera observación te espera');
  });

  it('EN primary CTA is "Take a photo now →"', () => {
    const c = (enJson as unknown as I18nShape).home.widgets.first_obs_cta;
    expect(c.primary).toBe('Take a photo now →');
  });

  it('ES primary CTA is "Tomar foto ahora →"', () => {
    const c = (esJson as unknown as I18nShape).home.widgets.first_obs_cta;
    expect(c.primary).toBe('Tomar foto ahora →');
  });

  it('EN/ES diverge (proves both files were actually translated)', () => {
    const en = (enJson as unknown as I18nShape).home.widgets.first_obs_cta;
    const es = (esJson as unknown as I18nShape).home.widgets.first_obs_cta;
    expect(en.heading).not.toBe(es.heading);
    expect(en.body).not.toBe(es.body);
    expect(en.secondary).not.toBe(es.secondary);
  });
});

describe('FirstObservationCTA — mounted in HomeWidgets above HomeRecent', () => {
  it('imports FirstObservationCTA', () => {
    expect(homeWidgetsSrc).toMatch(
      /import FirstObservationCTA from '\.\/home\/FirstObservationCTA\.astro'/,
    );
  });

  it('renders <FirstObservationCTA lang={lang} />', () => {
    expect(homeWidgetsSrc).toMatch(/<FirstObservationCTA\s+lang=\{lang\}\s*\/>/);
  });

  it('sits above HomeRecent (so signed-in users see "your first" before "others recent")', () => {
    const ctaIdx = homeWidgetsSrc.indexOf('<FirstObservationCTA');
    const recentIdx = homeWidgetsSrc.indexOf('<HomeRecent');
    expect(ctaIdx).toBeGreaterThan(-1);
    expect(recentIdx).toBeGreaterThan(-1);
    expect(ctaIdx).toBeLessThan(recentIdx);
  });
});
