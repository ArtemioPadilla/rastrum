import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// PBI 2.2 regression guard (UI/UX audit roadmap #1193).
//
// MapLibre is a ~1 MB chunk. Loading it from any non-map route inflates
// every page's "unused-javascript" budget, so we restrict top-level
// `import … from 'maplibre-gl'` to a small allowlist of map-rendering
// components. Every other consumer MUST use a dynamic
// `await import('maplibre-gl')` so the chunk is only fetched when the
// map is actually about to mount.

const REPO_ROOT = resolve(__dirname, '../..');

// The only files allowed to do a static (top-level) `import … from 'maplibre-gl'`.
// Anything else is a regression — keep this list tight and challenge any
// additions in code review.
const STATIC_IMPORT_ALLOWLIST = new Set<string>([
  'src/components/ExploreMap.astro',
]);

function listSourceFiles(): string[] {
  const out = execSync(
    `git ls-files 'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx'`,
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
}

describe('bundle-imports — MapLibre is dynamically imported off map routes', () => {
  const files = listSourceFiles();

  // Sanity: the scan saw something. A 0-file scan would silently pass.
  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('only allowlisted files static-import maplibre-gl', () => {
    const staticImportRe = /^[\s]*import\s+[^;]*?from\s+['"]maplibre-gl['"]/m;
    const violators: string[] = [];
    for (const rel of files) {
      const abs = resolve(REPO_ROOT, rel);
      const src = readFileSync(abs, 'utf8');
      if (!staticImportRe.test(src)) continue;
      if (!STATIC_IMPORT_ALLOWLIST.has(rel)) violators.push(rel);
    }
    expect(violators, `Move these to dynamic \`await import('maplibre-gl')\` inside the function that mounts the map:\n${violators.join('\n')}`).toEqual([]);
  });

  it('every non-allowlisted maplibre consumer uses dynamic import', () => {
    const dynamicRe = /import\(\s*['"]maplibre-gl['"]/;
    const consumerRe = /maplibre-gl/;
    const missingDynamic: string[] = [];
    for (const rel of files) {
      if (STATIC_IMPORT_ALLOWLIST.has(rel)) continue;
      const abs = resolve(REPO_ROOT, rel);
      const src = readFileSync(abs, 'utf8');
      if (!consumerRe.test(src)) continue;
      // Files that only reference the package via a type-only `import('maplibre-gl').X`
      // satisfy the dynamic-import regex — that's fine, type imports don't ship JS.
      // Files that mount a map MUST contain at least one runtime dynamic import.
      const mountsMap = /new\s+\w*\.?Map\(/.test(src) || /\.Marker\(/.test(src);
      if (!mountsMap) continue;
      if (!dynamicRe.test(src)) missingDynamic.push(rel);
    }
    expect(missingDynamic, `These mount a MapLibre map but don't dynamically import 'maplibre-gl':\n${missingDynamic.join('\n')}`).toEqual([]);
  });
});
