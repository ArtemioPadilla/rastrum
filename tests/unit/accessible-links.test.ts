import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PBI 3.2 regression guard (UI/UX audit roadmap #1193).
//
// Lighthouse `link-name` axe rule fails when an <a> has no programmatically
// determinable accessible name. The most common cause in this repo is an
// avatar <img alt=""> wrapped in <a> with no aria-label, or an <a> that
// wraps only an <svg>. Both pages flagged by the audit
// (/community/observers/ and /explore/recent/) build their cards from
// template literals inside <script> blocks, so the test is a source-string
// grep against the relevant Astro components.

const REPO_ROOT = resolve(__dirname, '../..');

const FILES = [
  'src/components/CommunityView.astro',
  'src/components/ExploreRecentView.astro',
];

/**
 * Extract every `<a …>…</a>` block from a source string. The parser is
 * intentionally simple — it handles the multi-line template-literal anchors
 * used by both components. Returns the inner-tag attribute string plus the
 * raw block (open tag + children) for child inspection.
 */
function extractAnchorBlocks(src: string): Array<{ openTag: string; inner: string; full: string }> {
  const blocks: Array<{ openTag: string; inner: string; full: string }> = [];
  // Match `<a` … `>` … `</a>` non-greedy, dotall.
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ openTag: m[1] ?? '', inner: m[2] ?? '', full: m[0] });
  }
  return blocks;
}

/**
 * Heuristic: does the inner content (between <a>…</a>) contain plain
 * text that could serve as the accessible name? "Plain text" here means
 * any non-whitespace character that is not inside an HTML tag and not a
 * template-literal interpolation that we can't statically resolve.
 *
 * If the inner only contains tags (img/svg/span+img/div+svg/…) and no
 * raw text, the anchor MUST carry aria-label or aria-labelledby.
 */
function innerHasPlainText(inner: string): boolean {
  // Strip every HTML tag and its attributes.
  const noTags = inner.replace(/<[^>]+>/g, ' ');
  // Strip template-literal interpolations `${…}` — they may or may not
  // resolve to text at runtime; if a block depends on `${someText}` for
  // its accessible name and has no fallback, that's still risky, but it
  // is out of scope for a static linter. We accept it as text.
  const withInterp = noTags;
  // Whitespace-only is "no text".
  return /\S/.test(withInterp);
}

function hasAriaLabel(openTag: string): boolean {
  return /\baria-label\s*=/.test(openTag) || /\baria-labelledby\s*=/.test(openTag);
}

function isAriaHidden(openTag: string): boolean {
  // aria-hidden="true" removes the element from the accessibility tree,
  // so axe's link-name rule does not apply. We still count it as "named"
  // for this lint.
  return /\baria-hidden\s*=\s*["']true["']/.test(openTag);
}

describe('accessible-links — every avatar/icon anchor has aria-label (PBI 3.2)', () => {
  for (const relPath of FILES) {
    describe(relPath, () => {
      const src = readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
      const anchors = extractAnchorBlocks(src);

      it('finds anchor blocks to scan', () => {
        expect(anchors.length).toBeGreaterThan(0);
      });

      it('every <a> that wraps only <img>/<svg>/icon markup carries aria-label or aria-labelledby', () => {
        const violations: string[] = [];
        for (const a of anchors) {
          if (hasAriaLabel(a.openTag)) continue;
          if (isAriaHidden(a.openTag)) continue;
          if (innerHasPlainText(a.inner)) continue;
          // No aria-label, not hidden, no inner text — violation.
          violations.push(a.full.slice(0, 200).replace(/\s+/g, ' '));
        }
        expect(violations).toEqual([]);
      });

      it('at least one new aria-label is present (positive smoke)', () => {
        // Both files should have grown an aria-label on at least one
        // avatar/observation anchor. If somebody reverts the fix, this
        // catches it.
        expect(src).toMatch(/aria-label\s*=\s*["'`]/);
      });
    });
  }
});
