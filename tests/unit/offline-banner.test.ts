/**
 * #1180 (first slice) — DOM-shape contract for the OfflineBanner.
 *
 * Background:
 *   The issue's first "Desired behavior" item is a non-intrusive banner
 *   surfacing `navigator.onLine === false`. Without a regression guard,
 *   a future refactor (e.g. wiring the banner to a different signal
 *   like a sync-queue retry counter, or dropping the ARIA live-region)
 *   could silently degrade the affordance — the banner would still
 *   render but assistive tech would miss the state change.
 *
 * Why source-string assertion instead of a happy-dom render:
 *   The behaviour we care about lives in an Astro `<script is:inline>`,
 *   which Vitest + happy-dom does not execute the same way the browser
 *   does. The DOM shape (ids, ARIA attributes, i18n key references,
 *   network-event listener wiring) is faithfully represented in the
 *   source. Same approach as `save-consolidation.test.ts` and the
 *   public-profile-sprite-fallback spec — a project convention.
 *
 * What this test pins:
 *   1. The component file exists.
 *   2. ARIA role="status" + aria-live="polite" are present (a11y).
 *   3. The script binds to `navigator.onLine` + `online`/`offline`
 *      window events (the actual signal — not a poll, not a timer).
 *   4. The dismiss button exists and the click handler is wired.
 *   5. The component references `offline.banner.text` / `.dismiss` so
 *      the EN/ES i18n parity (CLAUDE.md hard rule) holds at the source.
 *   6. Both i18n files declare `offline.banner.{text,dismiss}` and the
 *      EN copy contains the expected substring.
 *   7. BaseLayout mounts the component (so the banner is page-global,
 *      not opt-in per route).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENT_PATH = join(
  process.cwd(),
  'src/components/OfflineBanner.astro',
);
const BASE_LAYOUT_PATH = join(
  process.cwd(),
  'src/layouts/BaseLayout.astro',
);
const EN_PATH = join(process.cwd(), 'src/i18n/en.json');
const ES_PATH = join(process.cwd(), 'src/i18n/es.json');

describe('OfflineBanner — file presence (#1180 slice 1)', () => {
  it('OfflineBanner.astro exists', () => {
    expect(existsSync(COMPONENT_PATH)).toBe(true);
  });
});

describe('OfflineBanner — DOM shape + accessibility', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');

  it('has a stable id for the banner root', () => {
    expect(src).toMatch(/id=["']rastrum-offline-banner["']/);
  });

  it('declares role="status" so AT announces it as a non-modal update', () => {
    expect(src).toMatch(/role=["']status["']/);
  });

  it('declares aria-live="polite" — the issue calls this out explicitly', () => {
    // "polite" not "assertive": connection loss is informational, not
    // urgent — assertive would interrupt the user's current screen-reader
    // focus.
    expect(src).toMatch(/aria-live=["']polite["']/);
  });

  it('renders the banner hidden by default (SSR-safe — JS unhides)', () => {
    // Without this, anyone who loads the page online sees a flash of
    // offline copy before the first-paint script runs.
    expect(src).toMatch(/class=["'][^"']*\bhidden\b/);
  });
});

describe('OfflineBanner — network-state wiring', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');

  it('reads navigator.onLine to seed initial state', () => {
    expect(src).toMatch(/navigator\.onLine/);
  });

  it('subscribes to the window "online" event', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]online['"]/);
  });

  it('subscribes to the window "offline" event', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]offline['"]/);
  });
});

describe('OfflineBanner — dismiss affordance', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');

  it('renders a dismiss <button> with a stable id', () => {
    expect(src).toMatch(/id=["']rastrum-offline-dismiss["']/);
    expect(src).toMatch(/<button[^>]*\bid=["']rastrum-offline-dismiss["']/);
  });

  it('wires a click handler on the dismiss button', () => {
    expect(src).toMatch(
      /rastrum-offline-dismiss[\s\S]*addEventListener\(\s*['"]click['"]/,
    );
  });
});

describe('OfflineBanner — i18n key references', () => {
  const src = readFileSync(COMPONENT_PATH, 'utf8');

  it('references tr.offline.banner.text for the banner copy', () => {
    expect(src).toMatch(/offline\.banner\.text/);
  });

  it('references tr.offline.banner.dismiss for the dismiss label', () => {
    expect(src).toMatch(/offline\.banner\.dismiss/);
  });
});

describe('OfflineBanner — EN/ES i18n parity (#1180 slice 1)', () => {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf8')) as Record<
    string,
    Record<string, Record<string, string>>
  >;
  const es = JSON.parse(readFileSync(ES_PATH, 'utf8')) as Record<
    string,
    Record<string, Record<string, string>>
  >;

  it('en.json declares offline.banner.text + offline.banner.dismiss', () => {
    expect(en.offline?.banner?.text).toBeTypeOf('string');
    expect(en.offline?.banner?.dismiss).toBeTypeOf('string');
  });

  it('es.json declares offline.banner.text + offline.banner.dismiss', () => {
    expect(es.offline?.banner?.text).toBeTypeOf('string');
    expect(es.offline?.banner?.dismiss).toBeTypeOf('string');
  });

  it('EN copy mentions "offline"', () => {
    expect(en.offline.banner.text.toLowerCase()).toContain('offline');
  });

  it('ES copy mentions "sin conexión"', () => {
    expect(es.offline.banner.text.toLowerCase()).toContain('sin conexión');
  });
});

describe('OfflineBanner — mounted in BaseLayout', () => {
  const src = readFileSync(BASE_LAYOUT_PATH, 'utf8');

  it('imports OfflineBanner from the components dir', () => {
    expect(src).toMatch(
      /import\s+OfflineBanner\s+from\s+['"][.\/]+components\/OfflineBanner\.astro['"]/,
    );
  });

  it('renders <OfflineBanner lang={...} /> in the body', () => {
    expect(src).toMatch(/<OfflineBanner\s+lang=\{[^}]+\}\s*\/>/);
  });
});
