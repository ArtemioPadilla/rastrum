/**
 * Tests for the #813 ES URL slug override: /docs/sorpresas/ alongside /docs/surprises/.
 *
 * Verifies:
 * 1. getDocPath('es', 'surprises') returns the sorpresas slug in ES
 * 2. getDocPath('en', 'surprises') still returns the English slug
 * 3. Other doc pages are not affected by the override
 * 4. getDocPath without a page returns the docs root unchanged
 */

import { describe, it, expect } from 'vitest';
import { getDocPath } from '../../src/i18n/utils';

describe('getDocPath – ES slug override for surprises (#813)', () => {
  it('returns /es/docs/sorpresas/ for ES surprises', () => {
    expect(getDocPath('es', 'surprises')).toBe('/es/docs/sorpresas/');
  });

  it('keeps /en/docs/surprises/ for EN surprises', () => {
    expect(getDocPath('en', 'surprises')).toBe('/en/docs/surprises/');
  });

  it('does not affect other doc pages in ES', () => {
    expect(getDocPath('es', 'vision')).toBe('/es/docs/vision/');
    expect(getDocPath('es', 'privacy')).toBe('/es/docs/privacy/');
    expect(getDocPath('es', 'features')).toBe('/es/docs/features/');
  });

  it('returns the docs root when no page is provided', () => {
    expect(getDocPath('es')).toBe('/es/docs/');
    expect(getDocPath('en')).toBe('/en/docs/');
  });
});
