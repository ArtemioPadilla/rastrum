/**
 * Shared journey-spec helpers. DRY for the two cross-cutting init steps
 * (consent banner dismissal, WebLLM cache seed) plus a pageerror collector
 * — the single highest-value assertion for the "throws and stalls" bug
 * class (the 2026-05-15 identify saga). See
 * docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md.
 */
import type { Page } from '@playwright/test';

/** The analytics consent banner sits at z-9000 and intercepts clicks.
 *  Suppress it before any navigation. */
export async function dismissConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem('rastrum_analytics_consent', 'false'); } catch { /* noop */ }
  });
}

/** Pre-seed the WebLLM model cache so chat renders past its cache gate.
 *  Mirrors mockChatModelCached in chat-deep-link.spec.ts. */
export async function seedWebLLMCache(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof caches === 'undefined') return;
    const FAKE_URL = 'https://e2e.fixture/Llama-3.2-1B-Instruct-q4f16_1-MLC/shard.bin';
    const realOpen = caches.open.bind(caches);
    (caches as unknown as { open: typeof caches.open }).open = async (name: string) => {
      const c = await realOpen(name);
      if (name === 'webllm/model') {
        const existing = await c.match(FAKE_URL);
        if (!existing) {
          await c.put(FAKE_URL, new Response(new Uint8Array(0), { headers: { 'content-length': '0' } }));
        }
      }
      return c;
    };
  });
}

/** Collect uncaught page errors. Assert the returned array is empty at
 *  test end — directly catches the "feature throws, pipeline stalls,
 *  nothing shown" regression class. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
