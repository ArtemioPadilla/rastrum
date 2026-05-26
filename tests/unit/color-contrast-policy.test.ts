/**
 * Regression test for PBI 3.1 — WCAG AA color-contrast universal sweep.
 *
 * Lighthouse `color-contrast` was failing on every audited page because
 * `text-zinc-500` (#71717a) over white renders at ~3.2:1, below the 4.5:1
 * AA threshold for body text. The fix was a global swap:
 *
 *   - light-mode body text: `text-zinc-500` → `text-zinc-600`
 *   - dark-mode body text:  `dark:text-zinc-500` → `dark:text-zinc-300`
 *   - lines with bare `text-zinc-600` (no dark variant) got
 *     `dark:text-zinc-300` appended so dark mode contrast also passes
 *     (`text-zinc-600` on `bg-zinc-900` ≈ 2.1:1 — fails AA)
 *
 * This test is a **ratchet** — it asserts the codebase contains
 *   - ZERO occurrences of `text-zinc-500` as a default class (no prefix)
 *   - ZERO occurrences of `dark:text-zinc-500` (always fails dark AA)
 *
 * `text-zinc-400` is allowed as a default class because:
 *   - In dark mode (`dark:text-zinc-400` on `bg-zinc-900`) ≈ 4.7:1 — passes AA.
 *   - On light backgrounds it survives the audit only for decorative/aria-hidden
 *     glyphs, em-dashes, loading/empty placeholders, and `hover:` targets.
 *     A future sweep can tighten these case by case; this test does not
 *     regulate them.
 *
 * If a legitimate future use of `text-zinc-500` arises (e.g. an SVG icon
 * mid-emphasis on a `bg-zinc-100` panel that meets 3:1 large-text AA),
 * add the exact match to the `ALLOWED_TEXT_ZINC_500` allowlist below with
 * a comment explaining WHY. The bar is high: the audit is page-wide, so
 * a single new violation is a regression.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(astro|ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(ROOT);

/**
 * Allowlist of LITERAL substrings that may legitimately contain
 * `text-zinc-500` even after the PBI 3.1 sweep. Each entry should be
 * accompanied by a comment explaining the WHY. Today: empty.
 */
const ALLOWED_TEXT_ZINC_500: string[] = [];

/**
 * Allowlist for `dark:text-zinc-500` — never legitimate today.
 */
const ALLOWED_DARK_TEXT_ZINC_500: string[] = [];

describe('PBI 3.1: WCAG AA color-contrast policy', () => {
  it('has no `text-zinc-500` default class anywhere in src/ (use text-zinc-600+)', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of ALL_FILES) {
      const body = readFileSync(file, 'utf8');
      const lines = body.split('\n');
      lines.forEach((line, idx) => {
        // Strip `dark:text-zinc-500` matches from the line BEFORE scanning so
        // the bare-class regex doesn't double-count them — the dark-mode
        // assertion below covers those separately.
        const sanitized = line.replace(/dark:text-zinc-500/g, '');
        // Strip hover:/focus:/group-hover:/peer-hover:/placeholder: prefixes too —
        // those are state-bound, not default render colors.
        const cleaned = sanitized.replace(
          /(hover|focus|focus-visible|group-hover|peer-hover|placeholder|active|disabled|aria-\[\w+\]):text-zinc-500/g,
          '',
        );
        if (/\btext-zinc-500\b/.test(cleaned)) {
          if (ALLOWED_TEXT_ZINC_500.some((s) => line.includes(s))) return;
          violations.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 5)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join('\n');
      const more = violations.length > 5 ? `\n  …and ${violations.length - 5} more` : '';
      throw new Error(
        `Found ${violations.length} bare \`text-zinc-500\` occurrence(s). ` +
          `Body text should use \`text-zinc-600\` (or \`text-zinc-700\` for ` +
          `\`sm\` text on light cards) to meet WCAG AA (4.5:1).\n\n${sample}${more}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('has no `dark:text-zinc-500` anywhere in src/ (use dark:text-zinc-300+)', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of ALL_FILES) {
      const body = readFileSync(file, 'utf8');
      const lines = body.split('\n');
      lines.forEach((line, idx) => {
        if (/\bdark:text-zinc-500\b/.test(line)) {
          if (ALLOWED_DARK_TEXT_ZINC_500.some((s) => line.includes(s))) return;
          violations.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 5)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join('\n');
      const more = violations.length > 5 ? `\n  …and ${violations.length - 5} more` : '';
      throw new Error(
        `Found ${violations.length} \`dark:text-zinc-500\` occurrence(s). ` +
          `\`text-zinc-500\` on \`bg-zinc-900\` ≈ 3.5:1 — fails WCAG AA. ` +
          `Use \`dark:text-zinc-300\` (≈ 9.4:1) instead.\n\n${sample}${more}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('did the sweep find files (sanity check)', () => {
    // Guard against the walker regressing to empty (e.g. cwd change in a
    // future refactor); the assertions above would silently pass otherwise.
    expect(ALL_FILES.length).toBeGreaterThan(100);
  });
});
