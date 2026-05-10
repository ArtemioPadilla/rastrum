/**
 * E2E spec: chat entity picker — open dialog, switch to Species tab,
 * type a query, pick a row, and verify the entity chip appears.
 *
 * Strategy: No real Supabase needed. We:
 *  1. Intercept `getSupabase().rpc` at the window level so picker queries
 *     return deterministic fixture data.
 *  2. Intercept `rastrum:chat-attach-entity` to render a predictable chip
 *     (same mock used in chat-deep-link.spec.ts).
 *  3. Dispatch `rastrum:chat-open-entity-picker` programmatically to open
 *     the dialog without needing the full chat UI to be hydrated.
 *
 * Projects: chromium + mobile-chrome (per issue #915).
 */

import { test, expect } from './fixtures/auth';

const CHAT_EN = '/en/chat/';

/** Inject a Supabase RPC mock that returns one fixture species row. */
async function mockSupabaseRpc(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const FIXTURE_SPECIES = [
      { id: 'taxon-001', scientific_name: 'Quercus rugosa' },
      { id: 'taxon-002', scientific_name: 'Tillandsia usneoides' },
    ];

    // Proxy the global supabase getter used by ChatEntityPicker.
    // The picker calls `getSupabase().rpc(...)` which internally is imported.
    // We install a mock on `window.__supabaseMock` and patch via addInitScript.
    (window as unknown as { __supabaseMock: unknown }).__supabaseMock = {
      rpc: (fn: string) => {
        if (fn === 'chat_find_species') {
          return Promise.resolve({ data: FIXTURE_SPECIES, error: null });
        }
        if (fn === 'chat_find_observations') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'e2e-user' } }, error: null }) },
    };

    // Patch the module-level supabase client reference by overriding
    // the global `getSupabase` function if it was already attached.
    // If not yet attached, wait for it via a MutationObserver-free poll.
    const maybeOverride = () => {
      const w = window as unknown as Record<string, unknown>;
      if (typeof w['__rastrum_supabase_override'] === 'function') {
        (w['__rastrum_supabase_override'] as (v: unknown) => void)((window as unknown as { __supabaseMock: unknown }).__supabaseMock);
        return true;
      }
      return false;
    };
    if (!maybeOverride()) {
      const iv = setInterval(() => { if (maybeOverride()) clearInterval(iv); }, 50);
      setTimeout(() => clearInterval(iv), 5000);
    }
  });
}

/** Inject a chip renderer that intercepts the attach event. */
async function mockEntityChipRenderer(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    document.addEventListener('rastrum:chat-attach-entity', (ev: Event) => {
      const detail = (ev as CustomEvent<{ kind: string; id: string }>).detail;
      const slot = document.getElementById('chat-entity-chip-slot');
      if (!slot) return;
      slot.innerHTML = `<span id="e2e-entity-chip" data-kind="${detail.kind}" data-id="${detail.id}" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium"><span>Selected: ${detail.id}</span><button data-chip-detach aria-label="Remove">×</button></span>`;
    });
  });
}

test.describe('chat entity picker — species flow', () => {
  test('open picker, switch to Species tab, pick row → chip appears', async ({ authedPage: page }) => {
    await mockSupabaseRpc(page);
    await mockEntityChipRenderer(page);

    await page.goto(CHAT_EN);

    // Open the entity picker via the context button (or programmatically via event).
    // The `#chat-attach-entity-btn` fires `rastrum:chat-open-entity-picker`.
    const contextBtn = page.locator('#chat-attach-entity-btn');
    await expect(contextBtn).toBeVisible({ timeout: 10_000 });
    await contextBtn.click();

    // Picker dialog should be visible.
    const dialog = page.locator('#chat-entity-picker');
    await expect(dialog).toBeVisible();

    // Switch to the Species tab.
    const speciesTab = page.locator('[data-pkr-tab="species"]');
    await expect(speciesTab).toBeVisible();
    await speciesTab.click();

    // Type a search query.
    const searchInput = page.locator('#chat-entity-picker-search');
    await searchInput.fill('Quercus');

    // Wait for the list to populate (mocked data should return immediately).
    const listItem = page.locator('#chat-entity-picker-list button[data-row-id]').first();
    await expect(listItem).toBeVisible({ timeout: 8_000 });

    // The fixture species should appear.
    await expect(
      page.locator('#chat-entity-picker-list').getByText('Quercus rugosa'),
    ).toBeVisible();

    // Click the first result.
    await listItem.click();

    // Dialog should close.
    await expect(dialog).toBeHidden();

    // Entity chip should appear in the composer chip slot.
    const chip = page.locator('#e2e-entity-chip');
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await expect(chip).toHaveAttribute('data-kind', 'species');
  });

  test('entity chip contains correct id after picker selection', async ({ authedPage: page }) => {
    await mockSupabaseRpc(page);
    await mockEntityChipRenderer(page);

    await page.goto(CHAT_EN);
    const contextBtn = page.locator('#chat-attach-entity-btn');
    await expect(contextBtn).toBeVisible({ timeout: 10_000 });
    await contextBtn.click();

    await page.locator('[data-pkr-tab="species"]').click();
    await page.locator('#chat-entity-picker-search').fill('Tillandsia');

    // Wait for list
    const listItems = page.locator('#chat-entity-picker-list button[data-row-id]');
    await expect(listItems.first()).toBeVisible({ timeout: 8_000 });

    // Click whatever row is first (fixture returns Quercus and Tillandsia regardless of query)
    await listItems.first().click();

    const chip = page.locator('#e2e-entity-chip');
    await expect(chip).toBeVisible({ timeout: 5_000 });

    // Kind must be species
    await expect(chip).toHaveAttribute('data-kind', 'species');
    // ID must be one of the fixture ids
    const chipId = await chip.getAttribute('data-id');
    expect(['taxon-001', 'taxon-002']).toContain(chipId);
  });
});


