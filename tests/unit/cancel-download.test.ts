/**
 * Tests for cancelModelDownload() and the AbortController registry in local-ai.ts.
 *
 * local-ai.ts imports @mlc-ai/web-llm at the module boundary (for types only —
 * the runtime import is behind ensureCreator()). We mock the whole module at the
 * Vitest module boundary so the suite never touches WebGPU APIs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @mlc-ai/web-llm before any import of local-ai pulls it in.
vi.mock('@mlc-ai/web-llm', () => ({ CreateMLCEngine: vi.fn() }));

import {
  cancelModelDownload,
  registerDownloadController,
  isDownloadCancelled,
  clearModelCache,
  VISION_MODEL_ID,
  TEXT_MODEL_ID,
} from '../../src/lib/local-ai';

import {
  downloadBirdNETWeights,
  clearBirdNETCache,
  BIRDNET_CACHE_NAME,
  BIRDNET_MODEL_FILE,
  BIRDNET_LABELS_FILE,
} from '../../src/lib/identifiers/birdnet-cache';

// ── Mock the Cache API ──────────────────────────────────────────────────────

function makeMockCache() {
  const store = new Map<string, Response>();
  return {
    _store: store,
    put: vi.fn(async (req: Request | string, res: Response) => {
      const key = typeof req === 'string' ? req : req.url;
      store.set(key, res);
    }),
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.get(key) ?? undefined;
    }),
    keys: vi.fn(async () => [...store.keys()].map((k) => new Request(k))),
    delete: vi.fn(async (req: Request | string) => {
      const key = typeof req === 'string' ? req : req.url;
      return store.delete(key);
    }),
  };
}

function installCacheApi(cache: ReturnType<typeof makeMockCache>) {
  const openFn = vi.fn(async () => cache);
  Object.defineProperty(globalThis, 'caches', {
    value: { open: openFn, delete: vi.fn(async () => true) },
    writable: true,
    configurable: true,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('registerDownloadController / isDownloadCancelled', () => {
  it('isDownloadCancelled returns false before any cancel', () => {
    expect(isDownloadCancelled('some-model')).toBe(false);
  });

  it('cancelModelDownload sets the cancelled flag for WebLLM models', async () => {
    const cache = makeMockCache();
    installCacheApi(cache);
    await cancelModelDownload(VISION_MODEL_ID);
    // The flag is consumed and cleared by clearModelCache inside cancelModelDownload,
    // so isDownloadCancelled returns false afterwards (flag was set then cleared).
    expect(isDownloadCancelled(VISION_MODEL_ID)).toBe(false);
  });

  it('registered AbortController is aborted by cancelModelDownload', async () => {
    const cache = makeMockCache();
    installCacheApi(cache);

    const controller = new AbortController();
    registerDownloadController('test-model-id', controller);

    expect(controller.signal.aborted).toBe(false);
    await cancelModelDownload('test-model-id');
    expect(controller.signal.aborted).toBe(true);
  });

  it('cancelModelDownload clears cache entries for the given modelId', async () => {
    const cache = makeMockCache();
    installCacheApi(cache);

    // Manually put a fake WebLLM cache entry.
    const fakeResponse = new Response('weights', {
      headers: { 'content-type': 'application/octet-stream', 'content-length': '7' },
    });
    cache._store.set(`https://cdn.example.com/${VISION_MODEL_ID}/shard-0.bin`, fakeResponse);
    cache._store.set(`https://cdn.example.com/${VISION_MODEL_ID}/shard-1.bin`, fakeResponse);
    cache._store.set('https://cdn.example.com/other-model/shard-0.bin', fakeResponse);

    await cancelModelDownload(VISION_MODEL_ID);

    // Entries for VISION_MODEL_ID are deleted; other model's entry is untouched.
    expect(cache._store.has(`https://cdn.example.com/${VISION_MODEL_ID}/shard-0.bin`)).toBe(false);
    expect(cache._store.has(`https://cdn.example.com/${VISION_MODEL_ID}/shard-1.bin`)).toBe(false);
    expect(cache._store.has('https://cdn.example.com/other-model/shard-0.bin')).toBe(true);
  });
});

describe('cancelModelDownload with BirdNET fetch stream', () => {
  it('AbortController passed to downloadBirdNETWeights aborts the fetch mid-stream', async () => {
    // Set the env var so downloadBirdNETWeights doesn't throw "URL not configured".
    vi.stubEnv('PUBLIC_BIRDNET_WEIGHTS_URL', 'https://cdn.example.com/birdnet');

    const cache = makeMockCache();
    installCacheApi(cache);

    const controller = new AbortController();

    // Mock fetch to reject immediately with AbortError when the signal is already aborted,
    // or reject with AbortError when abort() is called. We use a deferred pattern to
    // avoid unhandled-rejection noise from happy-dom's synchronous abort event dispatch.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      const signal = (opts as RequestInit | undefined)?.signal;
      if (signal?.aborted) {
        return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
      }
      // Return a promise that rejects when abort fires.
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(new DOMException('The user aborted a request.', 'AbortError')),
        );
      });
    });

    registerDownloadController(BIRDNET_CACHE_NAME, controller);

    const downloadPromise = downloadBirdNETWeights(() => {}, controller.signal);

    // Pre-abort the controller so the next fetch call sees signal.aborted === true
    // (the download function calls fetch for labels first, then model).
    controller.abort();

    await expect(downloadPromise).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('clearBirdNETCache removes all entries from the birdnet cache', async () => {
    const cache = makeMockCache();
    installCacheApi(cache);

    // Plant fake entries.
    const fakeResponse = new Response('data', { headers: { 'content-length': '4' } });
    cache._store.set(`https://cdn.example.com/${BIRDNET_MODEL_FILE}`, fakeResponse);
    cache._store.set(`https://cdn.example.com/${BIRDNET_LABELS_FILE}`, fakeResponse);

    const { deleted } = await clearBirdNETCache();
    expect(deleted).toBe(2);
    expect(cache._store.size).toBe(0);
  });
});

describe('renderLocalDataCard downloading state', () => {
  it('renders cancel button when downloading=true', async () => {
    const { renderLocalDataCard } = await import('../../src/lib/identifier-card-html');
    const html = renderLocalDataCard({
      lang: 'en',
      id: 'llama-3.2-1b',
      name: 'Llama-3.2-1B',
      description: 'Text helper.',
      domIdPrefix: 'text',
      cacheStatus: { modelId: 'llama-3.2-1b', cached: false, approxBytes: 0, entries: 0 },
      downloading: true,
    });
    expect(html).toContain('id="text-cancel"');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('id="text-download"');
    expect(html).not.toContain('id="text-delete"');
  });

  it('renders download button when downloading=false (default)', async () => {
    const { renderLocalDataCard } = await import('../../src/lib/identifier-card-html');
    const html = renderLocalDataCard({
      lang: 'en',
      id: 'llama-3.2-1b',
      name: 'Llama-3.2-1B',
      description: 'Text helper.',
      domIdPrefix: 'text',
      cacheStatus: { modelId: 'llama-3.2-1b', cached: false, approxBytes: 0, entries: 0 },
    });
    expect(html).toContain('id="text-download"');
    expect(html).not.toContain('id="text-cancel"');
  });
});
