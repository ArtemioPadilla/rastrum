/**
 * EN/ES file-existence parity for every dynamic-resource page that was
 * converted to query-string routing in issue #1047.
 *
 * Before #1047 these pages used `[slug].astro` + `getStaticPaths() { return [] }`,
 * which 404'd in production static hosting. The fix renames them to
 * `index.astro` and reads `slug`/`username`/etc. from `Astro.url.searchParams`
 * — mirroring the working `/share/obs/?id=` precedent.
 *
 * This test pins two invariants:
 *   1. Every surface that should exist (post-rename) exists in BOTH locales.
 *   2. NO `[slug].astro` file survives anywhere under `src/pages/{en,es}/explore`
 *      or `src/pages/{en,es}/{profile,perfil}` (regression guard against
 *      re-introducing the broken pattern).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

// Each entry is a list of acceptable file paths for the EN/ES surface; the
// test asserts at least one exists. This accommodates either Astro layout —
// `foo.astro` (flat) OR `foo/index.astro` (directory) — since both route to
// the same URL.
const PAGE_PAIRS: Array<{ en: string[]; es: string[]; description: string }> = [
  // Trails (Agent A)
  { description: 'trails list/detail (merged)',
    en: ['src/pages/en/explore/trails/index.astro'],
    es: ['src/pages/es/explorar/senderos/index.astro'] },
  { description: 'trails field-guide',
    en: ['src/pages/en/explore/trails/field-guide/index.astro',
         'src/pages/en/explore/trails/field-guide.astro'],
    es: ['src/pages/es/explorar/senderos/guia-de-campo/index.astro',
         'src/pages/es/explorar/senderos/guia-de-campo.astro'] },

  // PITs (Agent B)
  { description: 'pits landing',
    en: ['src/pages/en/explore/pits/index.astro'],
    es: ['src/pages/es/explorar/pits/index.astro'] },

  // Species (Agent C) — flat `species.astro` and directory `species/index.astro` both valid
  { description: 'species list/detail (merged)',
    en: ['src/pages/en/explore/species/index.astro',
         'src/pages/en/explore/species.astro'],
    es: ['src/pages/es/explorar/especies/index.astro',
         'src/pages/es/explorar/especies.astro'] },

  // Places (Agent C)
  { description: 'places list/detail (merged)',
    en: ['src/pages/en/explore/places/index.astro',
         'src/pages/en/explore/places.astro'],
    es: ['src/pages/es/explorar/lugares/index.astro',
         'src/pages/es/explorar/lugares.astro'] },

  // User lists detail (this agent — issue #1047 part 1)
  { description: 'user-lists detail (query-string)',
    en: ['src/pages/en/profile/u/lists/index.astro'],
    es: ['src/pages/es/perfil/u/listas/index.astro'] },
];

function anyExist(candidates: string[]): string | null {
  for (const rel of candidates) {
    if (existsSync(resolve(REPO_ROOT, rel))) return rel;
  }
  return null;
}

describe('dynamic routes — EN/ES file parity (#1047)', () => {
  for (const { en, es, description } of PAGE_PAIRS) {
    it(`${description} — EN page exists`, () => {
      expect(anyExist(en), `none of these EN candidates exist:\n  ${en.join('\n  ')}`).not.toBeNull();
    });
    it(`${description} — ES sibling exists`, () => {
      expect(anyExist(es), `none of these ES candidates exist:\n  ${es.join('\n  ')}`).not.toBeNull();
    });
  }
});

describe('dynamic routes — no [slug].astro regression (#1047)', () => {
  const ROOTS = [
    'src/pages/en/explore',
    'src/pages/es/explorar',
    'src/pages/en/profile',
    'src/pages/es/perfil',
  ];

  function walk(dir: string): string[] {
    const out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        out.push(...walk(full));
      } else if (st.isFile()) {
        out.push(full);
      }
    }
    return out;
  }

  // A bracket-segment astro file is broken iff its `getStaticPaths` returns an
  // empty array (#1047). Files like `settings/[tab].astro` whose getStaticPaths
  // returns a concrete list ARE valid static routes — keep them.
  const EMPTY_STATIC_PATHS_RE = /getStaticPaths\s*\(\s*\)\s*\{\s*return\s*\[\s*\]\s*;?\s*\}/;

  function isBracketSegment(p: string): boolean {
    return /\[[^\]]+\]\.astro$/.test(p) || /\/\[[^\]]+\]\//.test(p);
  }

  for (const root of ROOTS) {
    it(`no dynamic-segment astro files with empty getStaticPaths under ${root}`, () => {
      const abs = resolve(REPO_ROOT, root);
      if (!existsSync(abs)) return;
      const offenders = walk(abs)
        .filter(isBracketSegment)
        .filter((p) => EMPTY_STATIC_PATHS_RE.test(readFileSync(p, 'utf8')));
      expect(
        offenders,
        `dynamic-segment files with empty getStaticPaths re-introduced (broken pattern from #1047):\n  ${offenders
          .map((p) => p.slice(REPO_ROOT.length + 1))
          .join('\n  ')}`,
      ).toEqual([]);
    });
  }
});
