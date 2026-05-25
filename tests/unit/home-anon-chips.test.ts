/**
 * Home anon-CTA / signed-in chips guard.
 *
 * Background — the journey audit on rastrum.org/es/ flagged that the four
 * personalized chips (Bandeja, Validar, Falta-dex, Lista) on the homepage
 * landed anon visitors on a sign-in wall, all destinations require an
 * authenticated session. This test pins the fix in place:
 *
 *   1. The .hc-root nav (chips) starts `hidden` in the source.
 *   2. HomeChips renders a `.hc-anon-cta` block.
 *   3. The script reveals chips only when getCachedUser() returns a user
 *      and otherwise hides them; the anon CTA is the inverse.
 *   4. The CTA i18n key exists in both EN and ES.
 *   5. The sign-in href is locale-paired (/sign-in vs /ingresar).
 *   6. HomeChips is rendered OUTSIDE the `home-widgets hidden` section
 *      (otherwise the anon CTA would never paint).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chipsSrc = readFileSync(
  join(process.cwd(), 'src/components/home/HomeChips.astro'),
  'utf8',
);
const widgetsSrc = readFileSync(
  join(process.cwd(), 'src/components/HomeWidgets.astro'),
  'utf8',
);
const enJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/en.json'), 'utf8'),
);
const esJson = JSON.parse(
  readFileSync(join(process.cwd(), 'src/i18n/es.json'), 'utf8'),
);

describe('HomeChips anon gating', () => {
  it('the chips nav starts hidden in markup', () => {
    expect(chipsSrc).toMatch(/class="hc-root hidden/);
  });

  it('renders an anon CTA element that the script can flip', () => {
    expect(chipsSrc).toMatch(/class="hc-anon-cta/);
  });

  it('script gates on getCachedUser() and uses onAuthChange (no direct supabase.auth.onAuthStateChange)', () => {
    expect(chipsSrc).toMatch(/getCachedUser/);
    expect(chipsSrc).toMatch(/onAuthChange/);
    expect(chipsSrc).not.toMatch(/supabase\.auth\.onAuthStateChange/);
  });

  it('script reveals chips on signed-in and hides the anon CTA (and vice versa)', () => {
    // Signed-in: chips visible, CTA hidden.
    expect(chipsSrc).toMatch(/anonCta\?\.classList\.add\('hidden'\)/);
    expect(chipsSrc).toMatch(/root\.classList\.remove\('hidden'\)/);
    // Anon: chips hidden, CTA visible.
    expect(chipsSrc).toMatch(/root\.classList\.add\('hidden'\)/);
    expect(chipsSrc).toMatch(/anonCta\?\.classList\.remove\('hidden'\)/);
  });
});

describe('HomeChips lives outside the .home-widgets hidden section', () => {
  it('HomeWidgets renders HomeChips outside the section that starts hidden', () => {
    const chipsIdx = widgetsSrc.indexOf('<HomeChips');
    const sectionOpenIdx = widgetsSrc.indexOf(
      '<section\n  class="home-widgets hidden',
    );
    expect(chipsIdx).toBeGreaterThan(-1);
    expect(sectionOpenIdx).toBeGreaterThan(-1);
    // The component must be placed BEFORE the hidden section.
    expect(chipsIdx).toBeLessThan(sectionOpenIdx);
  });
});

describe('chips.anon_cta i18n parity', () => {
  it('exists in EN', () => {
    expect(enJson.home.widgets.chips.anon_cta).toBeDefined();
    expect(typeof enJson.home.widgets.chips.anon_cta.text).toBe('string');
    expect(enJson.home.widgets.chips.anon_cta.text.length).toBeGreaterThan(0);
  });

  it('exists in ES', () => {
    expect(esJson.home.widgets.chips.anon_cta).toBeDefined();
    expect(typeof esJson.home.widgets.chips.anon_cta.text).toBe('string');
    expect(esJson.home.widgets.chips.anon_cta.text.length).toBeGreaterThan(0);
  });

  it('uses the locale-paired sign-in path (en=/sign-in/, es=/ingresar/)', () => {
    expect(enJson.home.widgets.chips.anon_cta.link).toBe('/en/sign-in/');
    expect(esJson.home.widgets.chips.anon_cta.link).toBe('/es/ingresar/');
  });

  it('component renders the locale-paired sign-in href', () => {
    expect(chipsSrc).toMatch(
      /lang === 'es' \? '\/es\/ingresar\/' : '\/en\/sign-in\/'/,
    );
  });
});
