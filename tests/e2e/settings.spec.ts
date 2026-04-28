import { test, expect } from '@playwright/test';

/**
 * Settings shell e2e tests (PR-2 account hub + settings shell).
 *
 * Out of scope: anything requiring a real Supabase session (auth flows,
 * BYO key persistence). These tests verify static structure + redirects.
 *
 * Uses `request.get()` to fetch raw HTML — bypasses the browser, so
 * client-side auth redirects don't fire and we can assert the static-
 * generated structure regardless of whether Supabase env is set in CI.
 */

async function fetchHtml(request: import('@playwright/test').APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 });
  return { response, html: await response.text() };
}

test.describe('Settings shell — EN', () => {
  test('profile tab renders the edit form', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/profile/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Settings/i);
    expect(html).toContain('id="edit-form"');
    expect(html).toContain('aria-label="Settings tabs"');
  });

  test('preferences tab renders language and BYO keys sections', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/preferences/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Settings/i);
    expect(html).toContain('id="byo-keys-form"');
    expect(html).toContain('id="lang-es"');
  });

  test('data tab renders import and export sections', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/data/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Settings/i);
    expect(html).toMatch(/href="[^"]*import/);
    expect(html).toMatch(/href="[^"]*export/);
  });

  test('developer tab renders tokens and expert-apply sections', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/developer/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Settings/i);
    expect(html).toMatch(/href="[^"]*tokens/);
    expect(html).toMatch(/href="[^"]*expert-apply/);
  });

  test('privacy tab renders the matrix shell with 3 presets and 19 facets', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/privacy/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Settings/i);
    expect(html).toContain('rastrum-privacy-matrix');
    expect(html).toContain('data-preset="open_scientist"');
    expect(html).toContain('data-preset="researcher"');
    expect(html).toContain('data-preset="private_observer"');
    // 19 facet rows
    const rowMatches = html.match(/data-facet-row="/g) ?? [];
    expect(rowMatches.length).toBe(19);
  });

  test('/profile/settings/ (no tab) redirects to profile tab', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/en/profile/settings/');
    // Astro emits a meta-refresh redirect stub for the index path.
    // Either HTTP 200 with meta-refresh markup OR HTTP 301/302.
    const status = response.status();
    if (status >= 300 && status < 400) {
      const location = response.headers().location || '';
      expect(location).toContain('settings/profile');
    } else {
      expect(status).toBeLessThan(400);
      expect(html).toContain('settings/profile');
    }
  });
});

test.describe('Settings shell — ES', () => {
  test('profile tab renders in Spanish', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/es/perfil/ajustes/profile/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Ajustes/i);
    expect(html).toContain('id="edit-form"');
  });

  test('preferences tab renders in Spanish', async ({ request }) => {
    const { response, html } = await fetchHtml(request, '/es/perfil/ajustes/preferences/');
    expect(response.status()).toBeLessThan(400);
    expect(html).toMatch(/<title>[^<]*Ajustes/i);
    expect(html).toContain('id="byo-keys-form"');
  });
});

test.describe('Legacy redirects → settings (PR-2)', () => {
  // Assert the redirect at the HTTP-level (or via meta-refresh markup),
  // not by following it through the browser. The browser would chain
  // through to /sign-in if Supabase auth-gate kicks in, masking the 301.
  async function expectRedirectMarkup(
    request: import('@playwright/test').APIRequestContext,
    from: string,
    toContains: string,
  ) {
    const response = await request.get(from, { maxRedirects: 0 });
    const status = response.status();
    if (status >= 300 && status < 400) {
      const location = response.headers().location || '';
      expect(location, `Expected ${from} → ${toContains}, got Location ${location}`).toContain(toContains);
    } else {
      // Astro static-build redirect stub: meta-refresh in body
      expect(status).toBeLessThan(400);
      const html = await response.text();
      expect(html, `Expected ${from} stub to mention ${toContains}`).toContain(toContains);
    }
  }

  test('/en/profile/edit redirects to settings/profile', async ({ request }) => {
    await expectRedirectMarkup(request, '/en/profile/edit', 'settings/profile');
  });

  test('/es/perfil/editar redirects to ajustes/profile', async ({ request }) => {
    await expectRedirectMarkup(request, '/es/perfil/editar', 'ajustes/profile');
  });

  test('/en/profile/tokens redirects to settings/developer', async ({ request }) => {
    await expectRedirectMarkup(request, '/en/profile/tokens', 'settings/developer');
  });

  test('/en/profile/export redirects to settings/data', async ({ request }) => {
    await expectRedirectMarkup(request, '/en/profile/export', 'settings/data');
  });

  test('/en/profile/import redirects to settings/data', async ({ request }) => {
    await expectRedirectMarkup(request, '/en/profile/import', 'settings/data');
  });

  test('/en/profile/expert-apply redirects to settings/developer', async ({ request }) => {
    await expectRedirectMarkup(request, '/en/profile/expert-apply', 'settings/developer');
  });
});
