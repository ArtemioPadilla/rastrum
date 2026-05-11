/**
 * _shared/analytics.ts — server-side PostHog ingest for Edge Functions (#780)
 *
 * Deno/Edge Function compatible — uses fetch, not posthog-node.
 * All calls are fire-and-forget: analytics must never block the main EF path.
 *
 * Usage:
 *   import { captureServerEvent } from '../_shared/analytics.ts';
 *   await captureServerEvent(apiKey, userId, 'push_sent', { trigger: 'golden_hour' });
 *
 * Gracefully no-ops when apiKey is empty/undefined so the EF works
 * in local dev without POSTHOG_PROJECT_KEY set.
 */

const POSTHOG_INGEST_URL = 'https://app.posthog.com/capture/';

export async function captureServerEvent(
  apiKey: string | undefined,
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!apiKey) return;
  // Fire-and-forget — never block the Edge Function response.
  await fetch(POSTHOG_INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      distinct_id: distinctId,
      event,
      properties: {
        $lib: 'rastrum-edge-function',
        ...(properties ?? {}),
      },
    }),
  }).catch(() => {}); // intentional swallow — analytics must not throw
}
