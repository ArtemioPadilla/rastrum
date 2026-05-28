/**
 * Regression test for PBI 3.1 + 3.1.1 + 3.1.2 — WCAG AA color-contrast policy.
 *
 * Three rules, all enforced by source-grep:
 *
 *   1. Zero `text-zinc-500` defaults (#71717a on white = 3.2:1 — fails AA).
 *   2. Zero `dark:text-zinc-500` (on bg-zinc-900 ≈ 3.5:1 — also fails AA).
 *   3. Every `text-red-(500|600|700)` carries a `dark:text-red-{400|300}`
 *      variant — text-red-600 on bg-zinc-900 = 4.11:1, which fails AA.
 *      (Light-mode is fine: text-red-600 on white = 4.83:1, passes.)
 *
 * Tailwind state-prefixes (`hover:`, `focus:`, `placeholder:` etc.) are
 * stripped before scanning — those are bound to state changes, not
 * default render colors.
 *
 * Decorative `text-zinc-400` (em-dashes, loading placeholders, hover
 * states) is allowed — the audit treats it case-by-case, this test
 * doesn't regulate it.
 *
 * To add a legitimate exception, append to the allowlist with a `// WHY`
 * comment. The bar is high: each new entry weakens the policy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(astro|ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_FILES = walk(ROOT);

const STATE_PREFIX_RE =
  /(hover|focus|focus-visible|group-hover|peer-hover|placeholder|active|disabled|aria-\[\w+\]):/g;

const ALLOWED_TEXT_ZINC_500: string[] = [];
const ALLOWED_DARK_TEXT_ZINC_500: string[] = [];
const ALLOWED_BARE_TEXT_RED: string[] = [];

describe('color-contrast policy', () => {
  it('has no `text-zinc-500` default class anywhere in src/ (PBI 3.1)', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of ALL_FILES) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        // Strip dark: variants + state-prefixes before scanning.
        const cleaned = line
          .replace(/dark:text-zinc-500/g, '')
          .replace(/(hover|focus|focus-visible|group-hover|peer-hover|placeholder|active|disabled|aria-\[\w+\]):text-zinc-500/g, '');
        if (/\btext-zinc-500\b/.test(cleaned)) {
          if (ALLOWED_TEXT_ZINC_500.some((s) => line.includes(s))) return;
          violations.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }
    if (violations.length > 0) {
      const sample = violations.slice(0, 5)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join('\n');
      const more = violations.length > 5 ? `\n  …and ${violations.length - 5} more` : '';
      throw new Error(
        `Found ${violations.length} bare \`text-zinc-500\`. Use \`text-zinc-600\` ` +
          `(4.83:1 on white, passes WCAG AA).\n\n${sample}${more}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('has no `dark:text-zinc-500` anywhere in src/ (PBI 3.1)', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of ALL_FILES) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (/\bdark:text-zinc-500\b/.test(line)) {
          if (ALLOWED_DARK_TEXT_ZINC_500.some((s) => line.includes(s))) return;
          violations.push({ file, line: idx + 1, text: line.trim() });
        }
      });
    }
    if (violations.length > 0) {
      const sample = violations.slice(0, 5)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join('\n');
      const more = violations.length > 5 ? `\n  …and ${violations.length - 5} more` : '';
      throw new Error(
        `Found ${violations.length} \`dark:text-zinc-500\`. Use \`dark:text-zinc-300\` ` +
          `(9.4:1 on bg-zinc-900, passes WCAG AA).\n\n${sample}${more}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('every `text-red-(500|600|700)` has a `dark:text-red-*` variant (PBI 3.1.2)', () => {
    const redRe = /\btext-red-(500|600|700)\b/;
    const darkRe = /\bdark:text-red-/;
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of ALL_FILES) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!redRe.test(line)) return;
        if (darkRe.test(line)) return; // already paired
        // State-prefix exempt: hover:text-red-600 etc. are state-bound colors
        const cleaned = line.replace(STATE_PREFIX_RE, '');
        if (!redRe.test(cleaned)) return;
        if (ALLOWED_BARE_TEXT_RED.some((s) => line.includes(s))) return;
        violations.push({ file, line: idx + 1, text: line.trim() });
      });
    }
    if (violations.length > 0) {
      const sample = violations.slice(0, 5)
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join('\n');
      const more = violations.length > 5 ? `\n  …and ${violations.length - 5} more` : '';
      throw new Error(
        `Found ${violations.length} \`text-red-(500|600|700)\` without a dark variant. ` +
          `Append \`dark:text-red-400\` (\`text-red-400\` on bg-zinc-900 ≈ 6.9:1, passes AA). ` +
          `For \`classList.toggle\` callers, split into two single-token calls.\n\n${sample}${more}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('sanity: walker found > 100 files', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
  });
});
