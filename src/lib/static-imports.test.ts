import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Regression guard: ensure WebLLM and local-ai are NEVER statically
 * imported. The full WebLLM SDK is ~5.8 MB; if any source file imports
 * it without `await import(...)`, Rollup pulls it into the initial
 * load graph and every visitor pays the bandwidth even if they never
 * trigger Phi-vision.
 *
 * We allow `import type { ... }` because TypeScript erases those at
 * compile time — they have zero runtime cost. We also allow imports
 * inside `local-ai.ts` itself (the lazy-loaded module) because that's
 * where the dynamic `import('@mlc-ai/web-llm')` actually happens.
 *
 * If this test fails, the offender either:
 * 1. Wrote `import { X } from '@mlc-ai/web-llm'` (should be
 *    `await import('@mlc-ai/web-llm')` inside an async function), or
 * 2. Wrote `import { X } from '../lib/local-ai'` (should be
 *    `await import('../lib/local-ai')` inside an async function).
 */

const SRC_DIR = join(__dirname, '..');
const FORBIDDEN_PATTERNS = [
  // Static value imports (NOT `import type`) of WebLLM
  /^\s*import\s+(?!type\b)[^;]*from\s+['"]@mlc-ai\/web-llm['"]/m,
  // Static value imports of local-ai (the wrapper module)
  /^\s*import\s+(?!type\b)[^;]*from\s+['"](?:\.\.?\/)+(?:lib\/)?local-ai['"]/m,
];

const ALLOW_FILES = new Set([
  // local-ai.ts is where the dynamic webllm import happens. Its own
  // static `import type` line is type-only and erased.
  'lib/local-ai.ts',
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (/\.(?:ts|astro|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe('static import guard', () => {
  it('no source file statically imports @mlc-ai/web-llm or local-ai (except local-ai.ts)', () => {
    const files = walk(SRC_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_DIR, file).replace(/\\/g, '/');
      if (ALLOW_FILES.has(rel)) continue;

      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          violations.push(`${rel}: ${match[0].trim()}`);
        }
      }
    }

    expect(violations, [
      'Static imports of WebLLM / local-ai found.',
      'These pull the ~5.8 MB WebLLM bundle into the initial load graph.',
      'Use `await import(...)` inside an async function instead.',
      'Violations:',
      ...violations.map((v) => '  ' + v),
    ].join('\n')).toEqual([]);
  });
});
