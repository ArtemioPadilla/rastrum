/**
 * #1128 R2 guard — proves the per-source confidence cap is wired at
 * BOTH upsert_primary_identification call sites in sync.ts (the
 * client-id path + the cascade-winner path). Pure string asserts; no DB.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sync = readFileSync(resolve(here, '../../src/lib/sync.ts'), 'utf8');

describe('#1128 R2 confidence cap is wired end-to-end', () => {
  it('imports capConfidence from ./confidence-ceiling', () => {
    expect(sync).toContain("import { capConfidence } from './confidence-ceiling';");
  });

  it('caps the client-id path with the resolved source', () => {
    expect(sync).toContain('capConfidence(resolvedSource, clientId.confidence ?? 0)');
  });

  it('caps the cascade-winner path with its source', () => {
    expect(sync).toContain('capConfidence(r.source, r.confidence)');
  });

  it('no longer clamps the client-id confidence to [0,1] unconditionally', () => {
    expect(sync).not.toContain('Math.max(0, Math.min(1, clientId.confidence ?? 0))');
  });
});
