/**
 * PBI 2.1 (#1193) — explore-recent LCP fix.
 *
 * Lighthouse measured LCP at 1481 ms on `/en/explore/recent/` because the
 * first observation card was `loading="lazy"` (priority bug) and the
 * thumbnail shipped at the full 1200 px R2 upload size with no AVIF/WebP
 * fallback. This spec pins:
 *   - `fetchpriority="high"` appears in the card-render template
 *   - `<picture>` wraps the card image with an AVIF-only source
 *     (WebP dropped post-incident — 5,000 transforms/month quota)
 *   - the `<img>` carries a guarded onerror that strips <source>s so a
 *     cdn-cgi 503 degrades to the raw upload instead of a broken image
 *   - the first card is the LCP candidate (i === 0 → isLCP=true)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '../../src/components/ExploreRecentView.astro'),
  'utf8',
);

describe('PBI 2.1 — ExploreRecentView LCP fix', () => {
  it('imports the image-variants helper', () => {
    expect(source).toMatch(/import\s*\{\s*buildImageVariants\s*,\s*EXPLORE_CARD_SIZES\s*\}\s*from\s*['"]\.\.\/lib\/image-variants['"]/);
  });

  it('renders fetchpriority="high" on the LCP candidate card', () => {
    expect(source).toContain('fetchpriority="high"');
    // And the non-LCP path stays auto, never high-by-default.
    expect(source).toContain('fetchpriority="auto"');
  });

  it('renders loading="eager" only when isLCPCandidate is true', () => {
    expect(source).toContain('loading="eager"');
    expect(source).toContain('loading="lazy"');
    // The eager attr must appear inside the LCP-candidate branch
    // (right next to fetchpriority="high").
    const eagerHighRegex = /loading="eager"\s+fetchpriority="high"/;
    expect(source).toMatch(eagerHighRegex);
  });

  it('threads the LCP-candidate flag from loadMore (first row of first page)', () => {
    // The caller marks index 0 of the very first page (baseOffset === 0).
    expect(source).toMatch(/baseOffset\s*===\s*0\s*&&\s*i\s*===\s*0/);
    // And forwards it to rowMarkup.
    expect(source).toMatch(/rowMarkup\([^)]*isLCP\)/);
  });

  it('wraps card thumbs in <picture> with an AVIF-only <source>', () => {
    expect(source).toContain('<picture>');
    expect(source).toContain('type="image/avif"');
    // WebP dropped post-incident — never emit an (empty) webp <source>,
    // and never re-add it without revisiting the transformations quota.
    expect(source).not.toContain('type="image/webp"');
    expect(source).toContain('</picture>');
  });

  it('emits responsive srcset on the AVIF <source>', () => {
    expect(source).toMatch(/srcset="\$\{escapeText\(v\.avifSrcset\)\}"/);
    expect(source).not.toContain('v.webpSrcset');
  });

  it('uses the EXPLORE_CARD_SIZES attribute on the card <source>', () => {
    expect(source).toContain('sizes="${EXPLORE_CARD_SIZES}"');
  });

  it('degrades to the raw upload when a cdn-cgi variant errors', () => {
    // <picture> does NOT fall back to <img src> on a network-level
    // <source> failure (503 = quota exhausted / feature disabled), so the
    // injected markup carries a guarded inline onerror that removes the
    // <source> siblings and reloads the raw src — at most once.
    expect(source).toContain('onerror=');
    expect(source).toMatch(/this\.dataset\.degraded/);
    expect(source).toMatch(/querySelectorAll\('source'\)/);
  });

  it('uses a small custom srcset for the 56px list-view thumb', () => {
    // List thumb is w-14 (56 px); 80/160 covers 1×–2× DPR. 240 (3×) was
    // dropped with the quota shrink.
    expect(source).toMatch(/buildImageVariants\(photo,\s*\[80,\s*160\]\)/);
    expect(source).toContain('sizes="56px"');
  });

  it('emits decoding="async" so the image decode never blocks the main thread', () => {
    expect(source).toContain('decoding="async"');
  });
});
