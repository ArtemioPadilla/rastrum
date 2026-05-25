/**
 * PBI 1.3 — Defer geolocation requests behind explicit user action.
 *
 * Lighthouse's `geolocation-on-start` audit fails when a page calls
 * `navigator.geolocation.getCurrentPosition` or `watchPosition` during
 * page load. The audit fired on `/en/`, `/es/`, and `/en/explore/recent/`
 * before this PBI because three components auto-fired geolocation
 * from their `init()` / wire flow:
 *
 *   1. `HomeWidgets.astro`     — paintSuggestions (home page)
 *   2. `home/HomeNearby.astro` — "Near you right now" (home page)
 *   3. `ExploreRecentView.astro` — distance filter (explore/recent)
 *
 * Each was refactored to render a "Show observations near me" /
 * "Show suggestions for my area" CTA on load; geolocation is only
 * called from the button's `click` handler. A cached location from a
 * prior session (sessionStorage `rastrum.user_location`, 5-minute TTL)
 * is honoured without re-prompting.
 *
 * This test pins that contract by source-string greps: for each of
 * the three files, every `getCurrentPosition` (or `watchPosition`)
 * call must be inside an event-handler block, NOT at the top of the
 * page's IIFE / init body. The check uses a simple lookbehind heuristic
 * — find each occurrence and assert there's an `addEventListener` or
 * `.then(` callback boundary between it and the nearest `function ` /
 * `async function ` / top-level script start.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const SUSPECT_FILES = [
  'src/components/HomeWidgets.astro',
  'src/components/home/HomeNearby.astro',
  'src/components/ExploreRecentView.astro',
] as const;

function readSource(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

/**
 * Strip JS/HTML comments so the geolocation grep doesn't false-positive
 * on doc strings that mention `navigator.geolocation.getCurrentPosition`
 * in prose. Preserves indices loosely (we don't care about the offset
 * being exact, only that we don't match inside a comment).
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
    .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));
}

/**
 * Find each `navigator.geolocation.getCurrentPosition` / `watchPosition`
 * occurrence in `src` and return the preceding ~600 chars of context.
 */
function findGeolocationCalls(src: string): Array<{ idx: number; context: string }> {
  const pattern = /navigator\.geolocation\.(?:getCurrentPosition|watchPosition)/g;
  const hits: Array<{ idx: number; context: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    const start = Math.max(0, m.index - 600);
    hits.push({ idx: m.index, context: src.slice(start, m.index) });
  }
  return hits;
}

/**
 * Heuristic: an event-handler-gated call has one of these markers in
 * the ~600 chars preceding it (within the same handler scope):
 *   - `.addEventListener(...` (anywhere — `click`, `submit`, etc.)
 *   - `.then(` / `.catch(` (Promise chain inside a handler)
 *   - `onClick=` / `onclick=` (inline handler attribute)
 *   - `function requestSuggestionsLocation` (PBI 1.3: explicit
 *     "request" helper that is itself only invoked from a click)
 *   - a hoisted async function whose name starts with
 *     `request`/`tryGeolocation`/`getLocation` (helpers that are
 *     invoked from a handler in the same file).
 */
function isHandlerGated(context: string): boolean {
  return (
    /\.addEventListener\s*\(/.test(context) ||
    /\bonclick\s*=/i.test(context) ||
    /\bfunction\s+(?:request|tryGeolocation|getLocation)/.test(context) ||
    /\basync\s+function\s+(?:request|tryGeolocation|getLocation)/.test(context) ||
    /const\s+(?:tryGeolocation|getLocation|requestLocation)\s*=/.test(context)
  );
}

describe('PBI 1.3 — no geolocation on page start', () => {
  for (const rel of SUSPECT_FILES) {
    it(`${rel}: every getCurrentPosition / watchPosition is event-handler-gated`, () => {
      const src = stripComments(readSource(rel));
      const hits = findGeolocationCalls(src);
      expect(
        hits.length,
        `Expected at least one geolocation call in ${rel}; if it was removed, drop it from SUSPECT_FILES.`,
      ).toBeGreaterThan(0);

      for (const { idx, context } of hits) {
        expect(
          isHandlerGated(context),
          `In ${rel}, the navigator.geolocation call at offset ${idx} is NOT inside an event-handler block. ` +
            `Lighthouse's geolocation-on-start audit will fail. Wrap it in a click/submit handler.`,
        ).toBe(true);
      }
    });
  }

  it('HomeNearby.astro renders the "show observations near me" CTA', () => {
    const src = readSource('src/components/home/HomeNearby.astro');
    expect(src).toMatch(/class="hn-show-cta/);
    expect(src).toMatch(/near_you_show_nearby/);
  });

  it('HomeWidgets.astro renders the "show suggestions" CTA and hides it once loaded', () => {
    const src = readSource('src/components/HomeWidgets.astro');
    expect(src).toMatch(/class="hw-suggestions-show/);
    expect(src).toMatch(/suggestions\.show/);
  });

  it('ExploreRecentView.astro renders the "show observations near me" CTA in the distance filter', () => {
    const src = readSource('src/components/ExploreRecentView.astro');
    expect(src).toMatch(/class="er-distance-show/);
    expect(src).toMatch(/distance_filter_show/);
  });

  it('i18n: both en.json and es.json carry the new CTA strings', () => {
    const en = JSON.parse(readSource('src/i18n/en.json')) as Record<string, unknown>;
    const es = JSON.parse(readSource('src/i18n/es.json')) as Record<string, unknown>;
    const enHome = (en as { home: { widgets: Record<string, unknown> } }).home.widgets;
    const esHome = (es as { home: { widgets: Record<string, unknown> } }).home.widgets;

    expect((enHome.suggestions as { show?: string }).show).toBeTypeOf('string');
    expect((esHome.suggestions as { show?: string }).show).toBeTypeOf('string');
    expect(enHome.near_you_show_nearby).toBeTypeOf('string');
    expect(esHome.near_you_show_nearby).toBeTypeOf('string');

    const enExplore = (en as { explore_pages: { recent: Record<string, unknown> } }).explore_pages.recent;
    const esExplore = (es as { explore_pages: { recent: Record<string, unknown> } }).explore_pages.recent;
    expect(enExplore.distance_filter_show).toBeTypeOf('string');
    expect(esExplore.distance_filter_show).toBeTypeOf('string');
  });
});
