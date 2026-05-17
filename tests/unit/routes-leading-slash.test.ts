/**
 * Every `routes` entry must be a leading-slash path (or empty for `home`).
 * Guards the #1130 class: a missing leading slash makes locale-prefix
 * concatenation produce broken URLs like `/enfield-guide`.
 */
import { describe, it, expect } from 'vitest';
import { routes } from '../../src/i18n/utils';

describe('routes — leading-slash invariant (#1130)', () => {
  for (const [key, pair] of Object.entries(routes)) {
    for (const lang of ['en', 'es'] as const) {
      it(`routes.${key}.${lang} is '' or starts with '/'`, () => {
        const v = pair[lang];
        expect(
          v === '' || v.startsWith('/'),
          `routes.${key}.${lang} = ${JSON.stringify(v)} — must be '' (home only) or start with '/'`,
        ).toBe(true);
      });
    }
  }
});
