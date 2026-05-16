/**
 * Verifies HomeWidgets is wired into both home pages.
 *
 * History:
 *   - PR #906 removed HomeWidgets from /en/ and /es/ (hotfix: observations.country_code
 *     didn't exist yet → 400 on every page load). The inverse test was added to prevent
 *     accidental re-addition before the column landed.
 *   - PR #867 (Globetrotter badge) added observations.country_code to the schema.
 *   - db-apply ran successfully on 2026-05-09 — column now exists in prod.
 *   - PR #925 re-added HomeWidgets to the home pages now that the column is in prod.
 *
 * This test replaces home-no-widgets.test.ts and asserts the current correct state:
 * HomeWidgets MUST be imported and rendered on both home pages.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home page includes HomeWidgets (#704 / #925)', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang} index.astro imports and uses HomeWidgets`, () => {
      const path = join(process.cwd(), `src/pages/${lang}/index.astro`);
      const src = readFileSync(path, 'utf8');
      // Must have the import
      expect(src).toMatch(/import HomeWidgets from/);
      // Must use the component
      expect(src).toMatch(/<HomeWidgets/);
    });
  }
});

describe("challenge-completed probe is a bounded existence check, not a count HEAD (#1072)", () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/HomeWidgets.astro'),
    'utf8',
  );

  it('does not request an exact count or HEAD on the observations probe', () => {
    // An unbounded RLS `count: 'exact', head: true` over observations
    // statement-timeouts in the pooler → HTTP 503 on every signed-in home
    // load. Regression guard: the source must not contain that pattern.
    expect(src).not.toMatch(/count:\s*'exact'/);
    expect(src).not.toMatch(/head:\s*true/);
  });

  it('uses a bounded .limit(1) existence probe for the daily challenge', () => {
    expect(src).toMatch(/\.gte\('observed_at', todayStart\.toISOString\(\)\)\s*\.limit\(1\)/);
    expect(src).toMatch(/const completed = !!doneRows && doneRows\.length > 0/);
  });
});
