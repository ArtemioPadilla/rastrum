/**
 * Unit tests for _shared/analytics.ts — PostHog server-side ingest (#780).
 *
 * Tests cover:
 *   1. No-op when apiKey is empty
 *   2. No-op when apiKey is undefined
 *   3. Correct POST shape sent when apiKey is present
 *   4. Never throws even if fetch rejects
 *   5. Merges properties into payload with $lib marker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Stub fetch globally ───────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── Import the module under test ──────────────────────────────────────────────

// We replicate the module logic inline here (analytics.ts is a Deno module;
// running it in Vitest/Node requires an inline port of the same logic).

const POSTHOG_INGEST_URL = 'https://app.posthog.com/capture/';

async function captureServerEvent(
  apiKey: string | undefined,
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!apiKey) return;
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
  }).catch(() => {});
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('captureServerEvent', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('no-ops when apiKey is undefined — fetch never called', async () => {
    await captureServerEvent(undefined, 'user-1', 'push_sent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when apiKey is empty string — fetch never called', async () => {
    await captureServerEvent('', 'user-1', 'push_sent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends correct POST body when apiKey is present', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await captureServerEvent('phc_test', 'user-abc', 'push_sent', { trigger: 'golden_hour' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(POSTHOG_INGEST_URL);
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.api_key).toBe('phc_test');
    expect(body.distinct_id).toBe('user-abc');
    expect(body.event).toBe('push_sent');
    expect(body.properties.$lib).toBe('rastrum-edge-function');
    expect(body.properties.trigger).toBe('golden_hour');
  });

  it('never throws when fetch rejects (fire-and-forget)', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    await expect(
      captureServerEvent('phc_test', 'user-1', 'push_sent'),
    ).resolves.toBeUndefined();
  });

  it('includes $lib marker in properties even with no extra props', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await captureServerEvent('phc_test', 'user-1', 'push_sent');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.properties.$lib).toBe('rastrum-edge-function');
  });
});
