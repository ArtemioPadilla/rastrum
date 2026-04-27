import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// Mirrors src/i18n/utils.ts `routes` — the canonical list of public top-level
// pages we care about. Keep in sync if `routes` changes.
const ROUTES: Record<'en' | 'es', string[]> = {
  en: [
    '/en/',
    '/en/identify/',
    '/en/observe/',
    '/en/explore/',
    '/en/explore/map/',
    '/en/about/',
    '/en/docs/',
    '/en/sign-in/',
    '/en/profile/',
  ],
  es: [
    '/es/',
    '/es/identificar/',
    '/es/observar/',
    '/es/explorar/',
    '/es/explorar/mapa/',
    '/es/acerca/',
    '/es/docs/',
    '/es/ingresar/',
    '/es/perfil/',
  ],
};

// Console errors we tolerate. PWA/Supabase/MapLibre warnings on a static
// preview without secrets/network are expected — we only care about real
// page errors that indicate broken JS bundles.
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /supabase/i,
  /sw\.js/i,
  /favicon/i,
  /maplibre/i,
  /webgl/i,
  /Cannot read properties of undefined.*supabase/i,
];

function shouldIgnoreConsole(msg: ConsoleMessage): boolean {
  if (msg.type() !== 'error') return true;
  const text = msg.text();
  return IGNORED_CONSOLE.some(rx => rx.test(text));
}

// /en/profile/ and /es/perfil/ render an h1 only after the Supabase auth
// check resolves a session. In our preview env there's no session, so the
// h1 stays inside a `hidden` wrapper. Accept that as a smoke-level pass
// (the deeper "renders properly" check belongs in an authed e2e suite,
// out of scope for this audit).
const H1_OPTIONAL = new Set(['/en/profile/', '/es/perfil/']);

async function loadAndCheck(page: Page, path: string) {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (!shouldIgnoreConsole(msg)) consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => consoleErrors.push(`[pageerror] ${err.message}`));

  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `Navigation to ${path} returned no response`).not.toBeNull();
  expect(response!.status(), `Bad status for ${path}`).toBeLessThan(400);

  // Every page must have a non-empty <title>.
  await expect(page).toHaveTitle(/\S/);

  // Most pages have a visible <h1>; auth-gated pages render their h1
  // conditionally (see H1_OPTIONAL).
  if (!H1_OPTIONAL.has(path)) {
    await expect(page.locator('h1').first()).toBeVisible();
  } else {
    await expect(page.locator('h1').first()).toHaveCount(1);
  }

  // Hard-fail on any unexpected console errors.
  expect(consoleErrors, `Unexpected console errors on ${path}`).toEqual([]);
}

for (const lang of ['en', 'es'] as const) {
  test.describe(`smoke (${lang})`, () => {
    for (const path of ROUTES[lang]) {
      test(`loads ${path}`, async ({ page }) => {
        await loadAndCheck(page, path);
      });
    }
  });
}

test('lang attribute matches locale segment', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/es/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

// Regression: src/pages/share/obs/index.astro is the only share-obs file
// (locale-neutral). Three explore views previously built `/${lang}/share/obs/`
// which 404'd in production. Catch any future regression by hitting the
// canonical path with a junk id; the page must render its "id required"
// state, not a 404.
test('share/obs/ is locale-neutral and renders for any id', async ({ page }) => {
  const okPaths = ['/share/obs/', '/share/obs/?id=00000000-0000-0000-0000-000000000000'];
  for (const p of okPaths) {
    const res = await page.goto(p);
    expect(res?.status(), `expected 200 for ${p}`).toBe(200);
  }
  // The locale-prefixed forms must NOT exist.
  for (const bad of ['/en/share/obs/', '/es/share/obs/']) {
    const res = await page.goto(bad);
    expect(res?.status(), `expected non-200 for ${bad}`).not.toBe(200);
  }
});
