/**
 * Registry-consistency test for supabase/functions/admin/handlers/index.ts.
 *
 * Deno does not support filesystem glob imports, so the handler registry
 * in handlers/index.ts must be maintained by hand. This test catches the
 * most common omission: adding a new handler file without registering it
 * in the HANDLERS map (or vice-versa).
 *
 * Two invariants are enforced:
 *   1. Every *.ts file in the handlers/ directory (except index.ts and
 *      files starting with '_') has a matching import in index.ts.
 *   2. Every handler symbol imported in index.ts appears as a value in
 *      the HANDLERS map object literal.
 *
 * This is a source-level regex scan, not a runtime import. It catches
 * typos and forgotten entries without needing Deno available in the Vitest
 * environment.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HANDLERS_DIR = join(
  import.meta.dirname ?? __dirname,
  '..', '..', 'supabase', 'functions', 'admin', 'handlers',
);

const indexContent = readFileSync(join(HANDLERS_DIR, 'index.ts'), 'utf-8');

describe('admin handlers registry consistency', () => {
  it('every handler file has a matching import in handlers/index.ts', () => {
    const files = readdirSync(HANDLERS_DIR).filter(
      (f) => f.endsWith('.ts') && f !== 'index.ts' && !f.startsWith('_'),
    );

    for (const file of files) {
      const baseName = file.replace(/\.ts$/, '');
      // Expect a line like: import { ... } from './<baseName>.ts';
      expect(
        indexContent,
        `handler file "${file}" is missing an import in handlers/index.ts`,
      ).toMatch(new RegExp(`from\\s*['"]\\.\/${baseName}\\.ts['"]`));
    }
  });

  it('every imported handler symbol appears in the HANDLERS map', () => {
    // Capture all imported handler names: import { fooBarHandler } from ...
    const importMatches = [...indexContent.matchAll(/import\s+\{\s*(\w+Handler)\s*\}/g)];
    const handlerNames = importMatches.map((m) => m[1]);

    expect(handlerNames.length).toBeGreaterThan(0);

    for (const name of handlerNames) {
      // Expect a map entry like: 'some.action': fooBarHandler
      expect(
        indexContent,
        `imported handler "${name}" is not referenced in the HANDLERS map`,
      ).toMatch(new RegExp(`['"'][a-zA-Z_.]+['"']\\s*:\\s*${name}`));
    }
  });
});
