/**
 * Journey-catalog completeness gate.
 *
 * docs/journey-catalog.md §1 "route spine" must list EXACTLY the route
 * keys in `routes` (src/i18n/utils.ts) ∪ `CONSOLE_TABS.routeKey`
 * (src/lib/console-tabs.ts). A new/removed route fails CI until the
 * catalog is updated — the rot mode that silently stale-d
 * journey-audit-2026-05-15.md (PR #1103 squash race) becomes impossible.
 *
 * Mirrors tests/unit/dynamic-routes-parity.test.ts (vitest + node:fs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routes } from '../../src/i18n/utils';
import { CONSOLE_TABS } from '../../src/lib/console-tabs';

const REPO_ROOT = resolve(__dirname, '..', '..');
const CATALOG = resolve(REPO_ROOT, 'docs/journey-catalog.md');

function spineBlock(): string {
  const md = readFileSync(CATALOG, 'utf8');
  const start = md.indexOf('<!-- spine:start -->');
  const end = md.indexOf('<!-- spine:end -->');
  expect(start, 'missing <!-- spine:start --> fence').toBeGreaterThanOrEqual(0);
  expect(end, 'missing <!-- spine:end --> fence').toBeGreaterThan(start);
  return md.slice(start, end);
}

function spineKeys(): string[] {
  const keys: string[] = [];
  // Negative lookahead on `routeKey` so the table's column-name header
  // is excluded even if it ever gets backticked (spec skeleton form).
  const re = /^\|\s*`(?!routeKey`)([A-Za-z][A-Za-z0-9]*)`\s*\|/gm;
  for (const m of spineBlock().matchAll(re)) keys.push(m[1]);
  return keys;
}

const required = new Set<string>([
  ...Object.keys(routes),
  ...CONSOLE_TABS.map((t) => t.routeKey),
]);

describe('journey catalog — spine completeness', () => {
  const keys = spineKeys();

  it('has no duplicate spine rows', () => {
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, `duplicate spine rows: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  it('lists every required route (no missing)', () => {
    const missing = [...required].filter((k) => !keys.includes(k)).sort();
    expect(
      missing,
      `journey catalog §1 is missing routes (add a spine row):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no stale/unknown routes (no extras)', () => {
    const extra = keys.filter((k) => !required.has(k)).sort();
    expect(
      extra,
      `journey catalog §1 has rows for routes not in routes/CONSOLE_TABS (removed from manifest?):\n  ${extra.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('journey catalog — Verified column hygiene', () => {
  it('every Verified cell is `never` or YYYY-MM-DD', () => {
    const bad: string[] = [];
    for (const line of spineBlock().split('\n')) {
      const m = line.match(/^\|\s*`(?!routeKey`)([A-Za-z][A-Za-z0-9]*)`\s*\|/);
      if (!m) continue;
      const cells = line.split('|').map((c) => c.trim());
      // cells: ['', routeKey, en, es, auth, rw, spec, verified, issues, '']
      const verified = cells[7];
      if (verified !== 'never' && !/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
        bad.push(`${m[1]}: "${verified}"`);
      }
    }
    expect(
      bad,
      `Verified must be 'never' or YYYY-MM-DD:\n  ${bad.join('\n  ')}`,
    ).toEqual([]);
  });
});
