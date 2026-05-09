/**
 * Regression guard for scripts/inject-version.js — pins the placeholder
 * substitution contract. The CLI is otherwise untested; the bug in #816
 * was that the source-of-truth `public/sw.js` had a hardcoded literal
 * that drifted from the deployed version, so we want loud failure if
 * the placeholder is ever removed.
 */
import { describe, it, expect } from 'vitest';
import {
  PLACEHOLDER,
  substituteSwVersion,
  substituteManifestVersion,
} from '../../scripts/inject-version.js';

describe('inject-version', () => {
  it('exposes the placeholder constant', () => {
    expect(PLACEHOLDER).toBe('__BUILD_VERSION__');
  });

  describe('substituteSwVersion', () => {
    it('replaces the placeholder line with the real VERSION literal', () => {
      const source = [
        '// preamble',
        `const VERSION = '${PLACEHOLDER}';`,
        '// rest',
      ].join('\n');
      const out = substituteSwVersion(source, '2026.5.99');
      expect(out).toContain(`const VERSION = 'rastrum-shell-2026.5.99';`);
      expect(out).not.toContain(PLACEHOLDER);
    });

    it('throws if the placeholder is missing', () => {
      const source = `const VERSION = 'rastrum-shell-2026.5.1';`;
      expect(() => substituteSwVersion(source, '2026.5.2')).toThrow(/placeholder/i);
    });

    it('throws if a maintainer hand-edits the placeholder away', () => {
      const source = `const VERSION = 'something-else';`;
      expect(() => substituteSwVersion(source, '2026.5.2')).toThrow();
    });
  });

  describe('substituteManifestVersion', () => {
    it('replaces the version field when the placeholder is present', () => {
      const manifest = { name: 'Rastrum', version: PLACEHOLDER };
      const out = substituteManifestVersion(manifest, '2026.5.99');
      expect(out.version).toBe('2026.5.99');
      expect(out.name).toBe('Rastrum');
    });

    it('throws if the version field is not the placeholder', () => {
      const manifest = { name: 'Rastrum', version: '2026.5.1' };
      expect(() => substituteManifestVersion(manifest, '2026.5.2')).toThrow(/__BUILD_VERSION__/);
    });
  });
});
