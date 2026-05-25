/**
 * PBI 3.4 — UI/UX audit roadmap: `crawlable-anchors` Lighthouse SEO fix.
 *
 * The audit flags any `<a>` whose `href` is bare `#`, empty, or JS-only
 * (`javascript:…`). Such anchors are unreachable by search crawlers, so
 * they don't pass page authority — costing SEO score on `/observe/`.
 *
 * This file pins the invariant at the source-string layer for every
 * component that participates in the `/observe/` render tree:
 *
 *   - ObserveView2.astro              the main observe surface
 *   - QuickObserveCapture.astro       the alt /observe/?quick=1 surface
 *   - WhyAmISeeingThisDialog.astro    global dialog mounted in BaseLayout
 *
 * Allow:
 *   - `href="#some-id"` (real fragment links — anchor scrolling is fine)
 *   - `href={…expr…}` (Astro-evaluated, can't be statically verified
 *     here; pinned by the production-HTML scan in the build step)
 *
 * Forbid:
 *   - bare `href="#"` (Lighthouse crawlable-anchors flag)
 *   - empty `href=""` (no destination at all)
 *   - `href="javascript:…"` (JS-only handler dressed as a link)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// One source-string per file under test. If a new component is added
// to the /observe/ render tree, add it here.
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['ObserveView2.astro', read('src/components/ObserveView2.astro')],
  ['QuickObserveCapture.astro', read('src/components/QuickObserveCapture.astro')],
  ['WhyAmISeeingThisDialog.astro', read('src/components/WhyAmISeeingThisDialog.astro')],
];

describe('crawlable-anchors invariant for /observe/', () => {
  // Match `<a … href="#">` but NOT `<a … href="#known-fragment">`. The
  // lookahead `(?!\w|-)` excludes any character that could start a real
  // fragment id (letters, digits, hyphens).
  const BARE_HASH = /<a\b[^>]*\bhref\s*=\s*"#"(?![\w-])/g;
  const EMPTY_HREF = /<a\b[^>]*\bhref\s*=\s*""/g;
  const JS_HREF = /\bhref\s*=\s*"javascript:/gi;

  for (const [name, src] of SOURCES) {
    describe(name, () => {
      it('has no bare `href="#"` anchors', () => {
        const hits = src.match(BARE_HASH) ?? [];
        // If this fails, the failing line is in the matched snippet —
        // pick a real `href=` (route or doc path), or convert the `<a>`
        // to a `<button type="button">` if it has no navigation semantics.
        expect(hits).toEqual([]);
      });

      it('has no empty `href=""` anchors', () => {
        const hits = src.match(EMPTY_HREF) ?? [];
        expect(hits).toEqual([]);
      });

      it('has no `href="javascript:…"` anchors', () => {
        const hits = src.match(JS_HREF) ?? [];
        expect(hits).toEqual([]);
      });
    });
  }
});
