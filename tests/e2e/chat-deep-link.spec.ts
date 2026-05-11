/**
 * E2E spec: chat deep-link — ?attach=observation:<id> on page load.
 *
 * The test navigates to /en/chat/?attach=observation:<id> and asserts:
 *  1. The entity chip is rendered in the composer chip slot.
 *  2. The ?attach= query param is removed from the URL after hydration.
 *
 * Strategy: No real Supabase connection needed. We inject a mock session and
 * spy on the custom-event flow by injecting a script that intercepts
 * `rastrum:chat-attach-entity` and immediately populates the chip slot with
 * a predictable label (mirrors what the real flow does). We don't test the
 * Supabase RPC — that is covered by unit tests in registry.test.ts.
 *
 * Projects: chromium + mobile-chrome (per issue #915).
 */

import { test, expect, injectMockSession } from './fixtures/auth';

const OBS_ID = 'e2e-obs-deep-link-0001';
const DEEP_LINK_EN = `/en/chat/?attach=observation:${OBS_ID}`;
const DEEP_LINK_ES = `/es/chat/?attach=observation:${OBS_ID}`;

/** Inject a script that intercepts the attach event and immediately renders a
 *  mock chip so we can assert the outcome without hitting Supabase. */
async function mockEntityResolution(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Intercept `rastrum:chat-attach-entity` and render a predictable chip.
    // The chip slot lives inside #chat-form which ships with `hidden` until
    // ChatView's model-cache probe resolves; in E2E without WebLLM that probe
    // never completes and may re-hide the form repeatedly — so we keep the
    // form forcibly visible via a MutationObserver on its class attribute.
    const pinFormVisible = () => {
      const form = document.getElementById('chat-form');
      if (!form) return;
      form.classList.remove('hidden');
      const obs = new MutationObserver(() => {
        if (form.classList.contains('hidden')) form.classList.remove('hidden');
      });
      obs.observe(form, { attributes: true, attributeFilter: ['class'] });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', pinFormVisible);
    } else {
      pinFormVisible();
    }
    setTimeout(pinFormVisible, 500);

    document.addEventListener('rastrum:chat-attach-entity', (ev: Event) => {
      const detail = (ev as CustomEvent<{ kind: string; id: string }>).detail;
      const slot = document.getElementById('chat-entity-chip-slot');
      if (!slot) return;
      slot.innerHTML = `<span id="e2e-entity-chip" data-kind="${detail.kind}" data-id="${detail.id}" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium">🔬 <span>Observation ${detail.id}</span><button data-chip-detach aria-label="Remove">×</button></span>`;
    });
  });
}

/** ChatView.refreshState() keeps `<form id="chat-form">` hidden until either
 *  Llama or Gemma weights show up in the Cache API. In a fresh CI environment
 *  neither is cached, so the form stays hidden — and the chip slot inside it.
 *
 *  This helper monkey-patches `caches.open('webllm/model')` so the next call
 *  pre-seeds a tiny fake entry whose URL contains TEXT_MODEL_ID
 *  (Llama-3.2-1B-Instruct-q4f16_1-MLC). Chat's getModelCacheStatus() then
 *  returns `cached: true`, refreshState() unhides the form, and the chip
 *  rendered by mockEntityResolution is visible.
 *
 *  Wraps caches.open instead of pre-populating up-front so the seed is
 *  guaranteed to land before the chat code awaits the cache lookup —
 *  no race with the init script's async body.
 *
 *  Closes #1003 (e2e blocked by model-cache gate). */
async function mockChatModelCached(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    if (typeof caches === 'undefined') return;
    const FAKE_URL = 'https://e2e.fixture/Llama-3.2-1B-Instruct-q4f16_1-MLC/shard.bin';
    const realOpen = caches.open.bind(caches);
    (caches as unknown as { open: typeof caches.open }).open = async (name: string) => {
      const c = await realOpen(name);
      if (name === 'webllm/model') {
        const existing = await c.match(FAKE_URL);
        if (!existing) {
          await c.put(FAKE_URL, new Response(new Uint8Array(0), {
            headers: { 'content-length': '0' },
          }));
        }
      }
      return c;
    };
  });
}

test.describe('chat deep-link (EN)', () => {
  test('entity chip renders after ?attach= navigation', async ({ authedPage: page }) => {
    await mockChatModelCached(page);
    await mockEntityResolution(page);
    await page.goto(DEEP_LINK_EN);

    // Wait for the chip to appear (JS hydration needed).
    const chip = page.locator('#e2e-entity-chip');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute('data-kind', 'observation');
    await expect(chip).toHaveAttribute('data-id', OBS_ID);
  });

  test('?attach= query param is removed from URL after hydration', async ({ authedPage: page }) => {
    await mockChatModelCached(page);
    await mockEntityResolution(page);
    await page.goto(DEEP_LINK_EN);

    // Wait for the chip (confirms hydration ran).
    await expect(page.locator('#e2e-entity-chip')).toBeVisible({ timeout: 10_000 });

    // URL should no longer contain ?attach=
    const url = page.url();
    expect(url).not.toContain('attach=');
  });
});

test.describe('chat deep-link (ES)', () => {
  test('entity chip renders for ES locale deep-link', async ({ authedPage: page }) => {
    await mockChatModelCached(page);
    await mockEntityResolution(page);
    await page.goto(DEEP_LINK_ES);

    const chip = page.locator('#e2e-entity-chip');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute('data-id', OBS_ID);
  });
});

test.describe('chat deep-link (mobile)', () => {
  test('entity chip renders on mobile viewport', async ({ authedPage: page }) => {
    await mockChatModelCached(page);
    await mockEntityResolution(page);
    await page.goto(DEEP_LINK_EN);

    const chip = page.locator('#e2e-entity-chip');
    await expect(chip).toBeVisible({ timeout: 10_000 });
  });
});
