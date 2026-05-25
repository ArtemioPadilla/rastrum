/**
 * PBI 3.3 — WCAG target-size + link-in-text-block regression guard.
 *
 * Source-string greps that pin down:
 * - ExploreMap.astro + ExploreRecentView.astro + TimeSlider.astro all use
 *   the 44x44 minimum hit-area pattern (`min-h-[44px]` / `min-w-[44px]`)
 *   on their clickable elements.
 * - BaseLayout.astro ships a `.maplibregl-ctrl button` rule that pins
 *   MapLibre's native zoom/geolocate controls to 44x44.
 * - Inline links inside text paragraphs use `underline` (or `decoration-*`)
 *   so they aren't distinguished by colour alone (WCAG 1.4.1).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

describe('PBI 3.3 — 44x44 touch targets', () => {
  it('ExploreMap.astro places-layer-toggle uses min-h-[44px] min-w-[44px]', () => {
    const src = read('src/components/ExploreMap.astro');
    expect(src).toContain('id="places-layer-toggle"');
    const toggleBlock = src.slice(src.indexOf('id="places-layer-toggle"'));
    expect(toggleBlock).toMatch(/min-h-\[44px\]/);
    expect(toggleBlock).toMatch(/min-w-\[44px\]/);
  });

  it('ExploreRecentView.astro view switcher buttons are >= 44x44 (h-11 w-11)', () => {
    const src = read('src/components/ExploreRecentView.astro');
    // The five view-switcher buttons share the inline-flex sizing classes.
    expect(src).toContain('inline-flex h-11 w-11 items-center justify-center rounded-md');
    // And no leftover h-9 w-9 view buttons.
    expect(src).not.toMatch(/er-view-btn[^"]*h-9 w-9/);
  });

  it('ExploreRecentView.astro overflow trigger, fave chip, distance chips use min-h-[44px]', () => {
    const src = read('src/components/ExploreRecentView.astro');
    // Overflow trigger (h-11 w-11)
    expect(src).toMatch(/er-overflow-trigger[^"]*h-11 w-11/);
    // Fave chip uses explicit min-h/min-w
    const faveIdx = src.indexOf('er-fave-chip');
    expect(faveIdx).toBeGreaterThan(-1);
    const faveBlock = src.slice(faveIdx, faveIdx + 400);
    expect(faveBlock).toMatch(/min-h-\[44px\]/);
    expect(faveBlock).toMatch(/min-w-\[44px\]/);
    // Distance chips
    const distIdx = src.indexOf('er-dist-btn');
    expect(distIdx).toBeGreaterThan(-1);
    const distBlock = src.slice(distIdx, distIdx + 400);
    expect(distBlock).toMatch(/min-h-\[44px\]/);
    expect(distBlock).toMatch(/min-w-\[44px\]/);
    // Overflow menu items
    expect(src).toMatch(/flex w-full min-h-\[44px\] items-center/);
  });

  it('TimeSlider.astro ts-btn buttons use min-h-[44px] min-w-[44px]', () => {
    const src = read('src/components/TimeSlider.astro');
    // Both the "all year" + month buttons share the sizing classes.
    const occurrences = src.match(/ts-btn[^"]*min-h-\[44px\][^"]*min-w-\[44px\]/g);
    expect(occurrences).not.toBeNull();
    expect((occurrences ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('BaseLayout.astro pins .maplibregl-ctrl button to >= 44x44', () => {
    const src = read('src/layouts/BaseLayout.astro');
    // Allow optional spacing inside the selector.
    expect(src).toMatch(/\.maplibregl-ctrl\s+button\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px[\s\S]*?\}/);
  });
});

describe('PBI 3.3 — link-in-text-block (WCAG 1.4.1)', () => {
  it('ExploreMap.astro cross-link uses underline, not colour alone', () => {
    const src = read('src/components/ExploreMap.astro');
    const linkIdx = src.indexOf('tr.map.cross_link.cta');
    expect(linkIdx).toBeGreaterThan(-1);
    // Walk backwards a bit to capture the anchor element.
    const block = src.slice(Math.max(0, linkIdx - 400), linkIdx + 100);
    expect(block).toMatch(/<a\b[^>]*class="[^"]*\bunderline\b/);
  });

  it('ExploreMap.astro place-popup link uses text-decoration (not hover-only)', () => {
    const src = read('src/components/ExploreMap.astro');
    // Inline-style popup link must have text-decoration:underline (not :none)
    const idx = src.indexOf('Ver lugar');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 400), idx + 80);
    expect(block).toMatch(/decoration-emerald|text-decoration:\s*underline|class="[^"]*\bunderline\b/);
  });

  it('ExploreMap.astro observation popup link uses text-decoration:underline', () => {
    const src = read('src/components/ExploreMap.astro');
    const idx = src.indexOf('Ver observación');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 400), idx + 80);
    expect(block).toMatch(/text-decoration:\s*underline/);
  });

  it('ExploreRecentView.astro observer links carry underline decoration', () => {
    const src = read('src/components/ExploreRecentView.astro');
    // Both observer link sites (cards + list view) should use underline
    const matches = src.match(/text-emerald-700[^"`]*underline\b/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // No remaining hover-only link styling for these anchor sites.
    // Sanity: the bare "hover:underline" pattern (with no preceding underline)
    // shouldn't survive on the observer links.
    expect(src).not.toMatch(/text-emerald-700 dark:text-emerald-400 hover:underline"/);
  });
});
