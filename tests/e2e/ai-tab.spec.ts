/**
 * AI tab e2e spec — unified-card lifecycle (#697).
 *
 * Covers:
 *   1. AI tab loads: visible section headers present, SpeciesNet absent (env unset).
 *   2. PlantNet Disable/Enable toggle persists in localStorage and across reload.
 *   3. Storage migration: legacy keys retire to rastrum.pipeline.disabled.
 *   4. ES locale: section headers and status pills in Spanish.
 *
 * Auth: injects a mock session via the existing auth fixture so the page
 * renders in its signed-in state. The AI registry itself is client-hydrated
 * and doesn't require a live Supabase session — the mock is sufficient.
 *
 * Section header note: The audio section header only appears when
 * PUBLIC_BIRDNET_WEIGHTS_URL is set (model_not_bundled filters BirdNET out
 * otherwise). We assert only the three headers that appear in every build:
 * Specialists, Generalists (appears twice — once for cloud generalists, once
 * for the experimental on-device section), and Other local data.
 *
 * addInitScript note: Playwright re-runs addInitScript scripts on every
 * navigation including reload(). Use page.evaluate() to mutate localStorage
 * AFTER page load when the value should survive a reload.
 */
import { test, expect } from './fixtures/auth';

const EN_AI_URL = '/en/profile/settings/ai/';
const ES_AI_URL = '/es/perfil/ajustes/ai/';

/** Wait until #identifier-list has rendered at least one card (not the loading placeholder). */
async function waitForRegistry(page: import('@playwright/test').Page) {
  // #1127: the identifier registry ("power panel") now lives behind the
  // collapsed "Identificación · Avanzado" <details>. Open it so the
  // registry content is visible for the assertions below — the registry
  // itself is unchanged, only relocated behind the disclosure. Idempotent
  // and safe pre-paint (the <details> is server-rendered static markup).
  await page.evaluate(() => {
    const d = document.getElementById('ai-advanced') as HTMLDetailsElement | null;
    if (d) d.open = true;
  });
  await page.waitForFunction(() => {
    const list = document.getElementById('identifier-list');
    if (!list) return false;
    // The initial placeholder is a single <li> with "Loading…" / "Cargando…".
    // After paintRegistry() runs there is at least one h3 section header.
    return list.querySelectorAll('h3').length > 0;
  }, undefined, { timeout: 15_000 });
}

// ── Scenario 1: AI tab loads with expected section headers, SpeciesNet absent ──

test.describe('AI tab — EN load', () => {
  test('expected section headers visible and SpeciesNet absent', async ({ authedPage: page }) => {
    await page.goto(EN_AI_URL);
    await waitForRegistry(page);

    // Headers that are always visible regardless of env vars:
    //   Specialists = PlantNet (cloud, always ready).
    //   Generalists = Claude + experimental Phi/Gemma (rendered even without key / download).
    //   Other local data = Llama + offline map (always rendered).
    // Audio (BirdNET) is hidden when PUBLIC_BIRDNET_WEIGHTS_URL is not set (model_not_bundled).
    const alwaysPresentHeaders = [
      '📷 Photo identifiers · Specialists',
      '📷 Photo identifiers · Generalists',
      '🗂 Other local data',
    ];

    for (const header of alwaysPresentHeaders) {
      await expect(
        page.locator('#identifier-list h3').filter({ hasText: header }).first(),
      ).toBeVisible();
    }

    // SpeciesNet must NOT be present because PUBLIC_SPECIESNET_WEIGHTS_URL is
    // not set in the test build (model_not_bundled → filtered by paintRegistry).
    await expect(
      page.locator('[data-toggle-plugin="speciesnet_distilled"]'),
    ).toHaveCount(0);
  });
});

// ── Scenario 2: PlantNet Disable/Enable toggle persists across reload ────────

test.describe('PlantNet toggle lifecycle', () => {
  test('Disable flips pill and persists; Enable clears entry', async ({ authedPage: page }) => {
    await page.goto(EN_AI_URL);
    await waitForRegistry(page);

    // Clear any prior disabled state AFTER page load so addInitScript doesn't
    // undo this on reload (addInitScript runs on every navigation).
    await page.evaluate(() => localStorage.removeItem('rastrum.pipeline.disabled'));

    // Re-paint to reflect the cleared state (reload would also work but is slower).
    await page.reload();
    await waitForRegistry(page);

    // PlantNet starts as Active (cloud plugin — always ready, always shows Disable).
    const plantnetToggle = page.locator('[data-toggle-plugin="plantnet"]').first();
    await expect(plantnetToggle).toBeVisible();
    await expect(plantnetToggle).toHaveText('Disable');

    // ── Click Disable ──────────────────────────────────────────────────────────
    await plantnetToggle.click();

    // After click, paintRegistry() re-renders the list. Wait for button to say "Enable".
    await expect(
      page.locator('[data-toggle-plugin="plantnet"]').first(),
    ).toHaveText('Enable');

    // Pill text should flip to "⏸ Disabled".
    await expect(
      page.locator('#identifier-list').getByText('⏸ Disabled').first(),
    ).toBeVisible();

    // Verify localStorage contains "plantnet" in the disabled list.
    const disabledAfterToggle = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('rastrum.pipeline.disabled') ?? '[]');
      } catch {
        return [];
      }
    });
    expect(disabledAfterToggle).toContain('plantnet');

    // ── Reload and assert persistence ─────────────────────────────────────────
    await page.reload();
    await waitForRegistry(page);

    await expect(
      page.locator('[data-toggle-plugin="plantnet"]').first(),
    ).toHaveText('Enable');

    const disabledAfterReload = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('rastrum.pipeline.disabled') ?? '[]');
      } catch {
        return [];
      }
    });
    expect(disabledAfterReload).toContain('plantnet');

    // ── Click Enable ───────────────────────────────────────────────────────────
    await page.locator('[data-toggle-plugin="plantnet"]').first().click();

    await expect(
      page.locator('[data-toggle-plugin="plantnet"]').first(),
    ).toHaveText('Disable');

    const disabledAfterEnable = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('rastrum.pipeline.disabled') ?? '[]');
      } catch {
        return [];
      }
    });
    expect(disabledAfterEnable).not.toContain('plantnet');
  });
});

// ── Scenario 3: Storage migration smoke ──────────────────────────────────────

test.describe('Storage migration', () => {
  test('legacy keys migrate to rastrum.pipeline.disabled on AI tab paint', async ({ authedPage: page }) => {
    // Set the two legacy keys BEFORE page load so runStorageMigration() sees them.
    // rastrum.localAiOptIn='true' + rastrum.prefs.usePhiVision='false' means:
    //   - localAiOptIn was opted in (this key is just deleted — no plugin mapping)
    //   - usePhiVision='false' → webllm_phi35_vision is added to the disabled list
    await page.addInitScript(() => {
      localStorage.removeItem('rastrum.pipeline.disabled');
      localStorage.setItem('rastrum.localAiOptIn', 'true');
      localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    });

    await page.goto(EN_AI_URL);
    await waitForRegistry(page);

    // After paint, both legacy keys must be gone.
    const legacyOptIn = await page.evaluate(() => localStorage.getItem('rastrum.localAiOptIn'));
    const legacyPhi = await page.evaluate(() => localStorage.getItem('rastrum.prefs.usePhiVision'));
    expect(legacyOptIn).toBeNull();
    expect(legacyPhi).toBeNull();

    // webllm_phi35_vision must appear in rastrum.pipeline.disabled.
    const disabled = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('rastrum.pipeline.disabled') ?? '[]');
      } catch {
        return [];
      }
    });
    expect(disabled).toContain('webllm_phi35_vision');
  });
});

// ── Scenario 4: ES locale ────────────────────────────────────────────────────

test.describe('AI tab — ES locale', () => {
  test('section headers in Spanish', async ({ authedPage: page }) => {
    await page.goto(ES_AI_URL);
    await waitForRegistry(page);

    // Same build-agnostic subset as the EN test — audio omitted.
    const expectedSpanishHeaders = [
      '📷 Identificadores de foto · Especialistas',
      '📷 Identificadores de foto · Generalistas',
      '🗂 Otros datos locales',
    ];

    for (const header of expectedSpanishHeaders) {
      await expect(
        page.locator('#identifier-list h3').filter({ hasText: header }).first(),
      ).toBeVisible();
    }
  });

  test('PlantNet pill shows Spanish labels after toggle', async ({ authedPage: page }) => {
    await page.goto(ES_AI_URL);
    await waitForRegistry(page);

    // Clear disabled state after load so we start from a known baseline.
    await page.evaluate(() => localStorage.removeItem('rastrum.pipeline.disabled'));
    await page.reload();
    await waitForRegistry(page);

    // Initially Active → button says "Desactivar".
    const toggleBtn = page.locator('[data-toggle-plugin="plantnet"]').first();
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText('Desactivar');

    // Click Disable.
    await toggleBtn.click();

    // Button should now say "Activar".
    await expect(
      page.locator('[data-toggle-plugin="plantnet"]').first(),
    ).toHaveText('Activar');

    // Pill should show "⏸ Desactivado".
    await expect(
      page.locator('#identifier-list').getByText('⏸ Desactivado').first(),
    ).toBeVisible();

    // Restore state so other tests start clean.
    await page.locator('[data-toggle-plugin="plantnet"]').first().click();
  });
});
