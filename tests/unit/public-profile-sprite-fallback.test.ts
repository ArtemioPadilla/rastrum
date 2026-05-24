/**
 * #1166 — PR #1116 installed `installSpriteFallback()` on ExploreMap,
 * MapPicker, and CommunityMapView so a slow/blocked OpenFreeMap sprite
 * degrades to a 1x1 transparent fallback instead of spamming the console
 * with `circle-11` missing warnings. `PublicProfileViewV2.astro` was
 * missed — when the user reported a network-level (`status: 0`) tile
 * failure from Android Chrome on `/en/u/?username=…`, this map was the
 * one without the handler.
 *
 * Source-assertion test (mirrors `observe-success-cta-gated.test.ts`) —
 * the wiring is inside an Astro client `<script>` and doesn't lend
 * itself to a happy-dom unit. The behaviour of the helper itself is
 * already covered by `map-style.test.ts`; this spec only pins the
 * parity with the other three map surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PublicProfileViewV2 sprite fallback parity (#1166)', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/PublicProfileViewV2.astro'),
    'utf8',
  );

  it('imports basemapStyleUrl + installSpriteFallback from map-style', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\binstallSpriteFallback\b[^}]*\}\s*from\s*['"]\.\.\/lib\/map-style['"]/,
    );
    expect(src).toMatch(
      /import\s*\{[^}]*\bbasemapStyleUrl\b[^}]*\}\s*from\s*['"]\.\.\/lib\/map-style['"]/,
    );
  });

  it('uses basemapStyleUrl(isDark) instead of inline OpenFreeMap URLs', () => {
    expect(src).toMatch(/style:\s*basemapStyleUrl\(\s*isDark\s*\)/);
    // Inline style URL constants from the pre-fix code must be gone so
    // the shared helper remains the single source of truth.
    expect(src).not.toMatch(/https:\/\/tiles\.openfreemap\.org\/styles\/liberty/);
    expect(src).not.toMatch(/https:\/\/tiles\.openfreemap\.org\/styles\/dark/);
  });

  it('installs the sprite fallback on the map instance', () => {
    expect(src).toMatch(/installSpriteFallback\(\s*map\s*\)/);
  });
});
