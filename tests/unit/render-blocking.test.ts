/**
 * PBI 5.4 — render-blocking resources budget.
 *
 * Lighthouse's `render-blocking-resources` audit flags external CSS and
 * synchronous external JS that block first paint. This source-level scan
 * pins the patterns we apply to keep the audit at 0 ms savings on the 3
 * priority pages (`/`, `/observe/`, `/sign-in/`):
 *
 *   1. The MapLibre CDN stylesheet (≈ 65 KB) is deferred via the
 *      `media="print" onload="this.media='all'"` pattern in every
 *      component that mounts a map client-side. A `<noscript>` fallback
 *      preserves the no-JS path.
 *   2. No render-blocking external `<link rel="stylesheet">` lives in
 *      `BaseLayout.astro` — only Astro's bundled CSS reaches the head
 *      (emitted automatically by the build, critical for first paint).
 *   3. No external `<script src="…">` is added without `defer` /
 *      `async` / `type="module"` (which is auto-deferred per the HTML
 *      spec). Inline boot scripts (theme, consent, SW registration,
 *      ambient-light) stay synchronous because they must run before
 *      paint (theme/consent) or are themselves wrapped in
 *      `addEventListener('load', …)` / `requestIdleCallback(…)`.
 *
 * This is a source-level regex scan, not a runtime check. It catches
 * accidental reintroduction of the blocking pattern at PR time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * Files that historically imported `maplibre-gl.css` from unpkg as a
 * render-blocking `<link>` and should now ship the deferred pattern.
 * Adding a new map-using component? Append the path here AND apply the
 * pattern at the component's link site.
 */
const MAPLIBRE_CSS_CONSUMERS = [
  'src/components/MapPicker.astro',
  'src/components/ExploreMap.astro',
  'src/components/ExploreSpeciesView.astro',
  'src/components/PublicProfileViewV2.astro',
  'src/components/CommunityMapView.astro',
  'src/pages/en/explore/places/compare/index.astro',
  'src/pages/es/explorar/lugares/comparar/index.astro',
];

describe('PBI 5.4 — render-blocking resources budget', () => {
  describe('BaseLayout.astro', () => {
    const layout = read('src/layouts/BaseLayout.astro');

    it('contains zero external <link rel="stylesheet"> (Astro emits the bundled CSS automatically)', () => {
      // Astro injects the compiled Tailwind/CSS bundle at build time; any
      // hand-written stylesheet link here is render-blocking and unwanted.
      const externalLinks = layout.match(/<link[^>]+rel="stylesheet"[^>]*>/g) ?? [];
      expect(externalLinks).toEqual([]);
    });

    it('contains zero <script src="…"> (all client-side JS is module-bundled by Astro)', () => {
      // `<script>` blocks without `src` (i.e. inline) are fine — they're
      // size-bounded by the layout source and don't fetch from the network.
      // The concern is external script tags that block parsing.
      const externalScripts = layout.match(/<script[^>]+src="[^"]+"[^>]*>/g) ?? [];
      expect(externalScripts).toEqual([]);
    });

    it('defers the AmbientLightSensor probe via requestIdleCallback', () => {
      // First paint must not wait on a sensor permission probe.
      expect(layout).toMatch(/requestIdleCallback\(runAmbientLightProbe/);
    });

    it('keeps the theme boot script synchronous (must run before first paint)', () => {
      // Theme resolution writes .dark / .field on <html> before paint to
      // avoid a flash of wrong-theme. Deferring it would regress UX.
      expect(layout).toContain("var stored = localStorage.getItem('theme');");
    });
  });

  describe('MapLibre CSS consumers — deferred-load pattern', () => {
    for (const rel of MAPLIBRE_CSS_CONSUMERS) {
      it(`${rel} uses the media="print" onload pattern for maplibre-gl.css`, () => {
        const src = read(rel);

        // 1. The href is present (we still ship the stylesheet).
        expect(src).toMatch(/href="https:\/\/unpkg\.com\/maplibre-gl@[^"]+\/dist\/maplibre-gl\.css"/);

        // 2. At least one occurrence uses the deferred pattern.
        const deferredPattern =
          /<link\s+rel="stylesheet"\s+href="https:\/\/unpkg\.com\/maplibre-gl@[^"]+\/dist\/maplibre-gl\.css"\s+media="print"\s+onload="this\.media='all'/;
        expect(src).toMatch(deferredPattern);

        // 3. There's a <noscript> fallback so users with JS disabled still
        //    get the stylesheet.
        expect(src).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/unpkg\.com\/maplibre-gl@[^"]+\/dist\/maplibre-gl\.css" \/><\/noscript>/);

        // 4. No bare render-blocking <link> for maplibre-gl.css remains.
        //    (Filter out the deferred + noscript lines, then assert.)
        const lines = src.split('\n');
        const bareBlockingLinks = lines.filter((line) => {
          if (!line.includes('maplibre-gl.css')) return false;
          if (line.includes('media="print"')) return false; // deferred
          if (line.includes('<noscript>')) return false;    // fallback
          if (!line.includes('rel="stylesheet"')) return false;
          return true;
        });
        expect(bareBlockingLinks).toEqual([]);
      });
    }
  });
});
