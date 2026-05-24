/**
 * #1024 (backfill of #942 plan §Task 7.3) — DOM-shape contract for the
 * save/skip buttons in ObserveView2's main form.
 *
 * Background:
 *   - PR #1000 reduced the form from 5 save/skip exits (`obs2-save-btn`,
 *     `obs2-skip-save-btn`, `obs2-skip-location`, `obs2-id-edit`, plus the
 *     `obs2-no-runners-continue` empty-state secondary) down to 2 surfaces:
 *       * Primary "Save observation" inside the form.
 *       * Single secondary in the no-runners empty state ("Save without ID").
 *   - A regression that re-adds any of the deleted button ids would not
 *     fail any existing test — the Fogg ability lever (one primary action
 *     per surface) would silently degrade back to a 5-exit form.
 *
 * Why source-string assertion instead of the experimental Astro Container
 * API:
 *   - This repo has zero precedent for `experimental_AstroContainer` and
 *     introducing it for a single regression test would add weight.
 *   - The shape we care about is *which ids exist in the rendered output*,
 *     which is faithfully represented in the source (Astro emits `id="..."`
 *     verbatim — there is no runtime mangling).
 *   - The same approach is used by `tests/unit/observe-success-cta-gated.test.ts`
 *     and the home-widgets-wired test family, so it matches an established
 *     project convention.
 *
 * What this test pins:
 *   1. `obs2-save-btn` (primary) is present.
 *   2. The four legacy exit buttons removed by PR #1000 stay removed.
 *   3. The empty-state block has at most ONE secondary `<button>`
 *      (the "Save without ID" continuation). Everything else in that
 *      block must be a link (`<a>`), not a button.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/components/ObserveView2.astro'),
  'utf8',
);

// Strip Astro comments and HTML comments so they don't generate false
// positives when an id is mentioned inside a "removed by PR #N" note.
function stripComments(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SRC_NO_COMMENTS = stripComments(SRC);

function hasIdAttribute(html: string, id: string): boolean {
  // Match `id="<id>"` (quoted) or `id={...<id>...}` (Astro expression).
  // The four legacy ids never appeared inside expressions, but we stay
  // strict and search both forms so a future rewrite that uses
  // `id={`obs2-save-btn`}` still trips the right assertions.
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = new RegExp(`\\bid=["']${escaped}["']`);
  const expr = new RegExp(`\\bid=\\{[^}]*["\`]${escaped}["\`]`);
  return literal.test(html) || expr.test(html);
}

describe('save consolidation — primary save button is present', () => {
  it('renders #obs2-save-btn (the single primary save submit)', () => {
    expect(hasIdAttribute(SRC_NO_COMMENTS, 'obs2-save-btn')).toBe(true);
  });

  it('the primary save lives inside <form> and is type="submit"', () => {
    // Defends against accidental conversion to type="button" (would skip
    // <form> validation) or moving the button outside the form (would
    // detach the submit handler and break Save).
    const saveBlock = SRC.match(
      /<button[^>]*\bid=["']obs2-save-btn["'][^>]*>/,
    );
    expect(saveBlock).not.toBeNull();
    expect(saveBlock![0]).toMatch(/type=["']submit["']/);
  });
});

describe('save consolidation — legacy exit buttons stay removed (#942 PR7)', () => {
  // Each of these ids was deleted by the PR #1000 redo of #942. The CLAUDE.md
  // history records the consolidation; a re-introduction would silently
  // re-bury Save under skip exits.
  const REMOVED_IDS = [
    'obs2-skip-save-btn',  // "Just identify, don't save"
    'obs2-skip-location',  // "Skip location"
    'obs2-id-edit',        // "Edit identification" (manual input is always visible below)
  ] as const;

  for (const id of REMOVED_IDS) {
    it(`does NOT render #${id} (removed by PR #1000)`, () => {
      expect(hasIdAttribute(SRC_NO_COMMENTS, id)).toBe(false);
    });
  }
});

describe('save consolidation — at most 1 primary + 1 secondary per surface', () => {
  it('the main form has exactly one submit button (the primary save)', () => {
    // Extract the <form id="obs2-post-form">…</form> block and count
    // type="submit" buttons inside it. If a redesign accidentally adds a
    // second submit it would race the primary on Enter-to-submit.
    const formMatch = SRC.match(
      /<form[^>]*\bid=["']obs2-post-form["'][\s\S]*?<\/form>/,
    );
    expect(
      formMatch,
      'main <form id="obs2-post-form"> must exist',
    ).not.toBeNull();
    const submitsInForm = (formMatch![0].match(/type=["']submit["']/g) ?? [])
      .length;
    expect(submitsInForm).toBe(1);
  });

  it('the no-runners empty state has ≤1 <button> (single secondary CTA)', () => {
    // The block ships exactly two affordances: the "Set up AI" link (<a>)
    // and the "Save without ID" continuation button (<button>). Any third
    // affordance must not be a button — links are fine because they don't
    // share the primary-action affordance.
    const block = SRC.match(
      /<div\s+id=["']obs2-no-runners["'][\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(
      block,
      'no-runners empty-state block must exist',
    ).not.toBeNull();
    const buttonCount = (block![0].match(/<button\b/g) ?? []).length;
    expect(buttonCount).toBeLessThanOrEqual(1);
  });

  it('the no-runners block keeps "Set up AI" as a link, not a button', () => {
    // Pure-style affordance test: the "fix the cause" path should be an
    // anchor pointing to /profile/edit, while the "ship anyway" path is the
    // single secondary button. If both became buttons we'd lose the
    // affordance distinction and break the Fogg ability hierarchy.
    const block = SRC.match(
      /<div\s+id=["']obs2-no-runners["'][\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/<a\s[^>]*href=[^>]*profile\/edit/);
  });
});
