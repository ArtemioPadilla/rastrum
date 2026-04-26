import { describe, it, expect, beforeEach } from 'vitest';

// Map-backed Cache API shim — happy-dom doesn't provide window.caches.
// Mirrors the shim in birdnet-cache.test.ts so behaviour is identical.
class CacheShim {
  private store = new Map<string, Response>();
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }
  async match(req: Request | string): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    const res = this.store.get(url);
    return res ? res.clone() : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const url = typeof req === 'string' ? req : req.url;
    this.store.set(url, res.clone());
  }
  async delete(req: Request | string): Promise<boolean> {
    const url = typeof req === 'string' ? req : req.url;
    return this.store.delete(url);
  }
  _peek() { return this.store; }
}

const cacheBuckets = new Map<string, CacheShim>();
const cachesShim = {
  async open(name: string) {
    let c = cacheBuckets.get(name);
    if (!c) {
      c = new CacheShim();
      cacheBuckets.set(name, c);
    }
    return c;
  },
  async delete(name: string) { return cacheBuckets.delete(name); },
  async has(name: string)    { return cacheBuckets.has(name); },
  async keys()               { return Array.from(cacheBuckets.keys()); },
  async match()              { return undefined; },
};

Object.defineProperty(globalThis, 'caches', { configurable: true, value: cachesShim });

const ORIGINAL_ENV = { ...import.meta.env };

import {
  ONNX_BASE_CACHE_NAME, ONNX_BASE_MODEL_FILE, ONNX_BASE_LABELS_FILE,
  getOnnxBaseCacheStatus, clearOnnxBaseCache,
  getCachedLabels, getCachedModelBuffer, getOnnxBaseWeightsBaseUrl,
  downloadOnnxBaseWeights,
} from './onnx-base-cache';

beforeEach(() => {
  cacheBuckets.clear();
  const env = import.meta.env as unknown as Record<string, unknown>;
  for (const k of Object.keys(env)) {
    if (!(k in ORIGINAL_ENV)) delete env[k];
  }
});

describe('onnx-base-cache module exports', () => {
  it('uses the documented cache name', () => {
    expect(ONNX_BASE_CACHE_NAME).toBe('rastrum/onnx-base');
  });
  it('uses the documented file names', () => {
    expect(ONNX_BASE_MODEL_FILE).toBe('efficientnet_lite0.onnx');
    expect(ONNX_BASE_LABELS_FILE).toBe('imagenet_labels.txt');
  });
});

describe('getOnnxBaseWeightsBaseUrl', () => {
  it('returns null when env var is unset', () => {
    expect(getOnnxBaseWeightsBaseUrl()).toBeNull();
  });

  it('strips trailing slashes when set', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_ONNX_BASE_URL = 'https://cdn.example/onnx-base/';
    expect(getOnnxBaseWeightsBaseUrl()).toBe('https://cdn.example/onnx-base');
  });
});

describe('getOnnxBaseCacheStatus', () => {
  it('reports nothing cached on a fresh cache', async () => {
    const s = await getOnnxBaseCacheStatus();
    expect(s.modelCached).toBe(false);
    expect(s.labelsCached).toBe(false);
    expect(s.approxBytes).toBe(0);
  });

  it('reports model + labels cached after manual put', async () => {
    const cache = await cachesShim.open(ONNX_BASE_CACHE_NAME);
    const labelsBody = 'n01440764 tench, Tinca tinca\n';
    await cache.put(
      new Request(`https://cdn.example/onnx-base/${ONNX_BASE_LABELS_FILE}`),
      new Response(labelsBody, { headers: { 'content-length': String(labelsBody.length) } }),
    );
    const modelBytes = new Uint8Array(2_800_000);
    await cache.put(
      new Request(`https://cdn.example/onnx-base/${ONNX_BASE_MODEL_FILE}`),
      new Response(modelBytes, { headers: { 'content-length': '2800000' } }),
    );
    const s = await getOnnxBaseCacheStatus();
    expect(s.modelCached).toBe(true);
    expect(s.labelsCached).toBe(true);
    expect(s.approxBytes).toBe(labelsBody.length + 2_800_000);
  });
});

describe('getCachedLabels / getCachedModelBuffer', () => {
  it('returns null when nothing cached', async () => {
    expect(await getCachedLabels()).toBeNull();
    expect(await getCachedModelBuffer()).toBeNull();
  });

  it('parses labels into trimmed, non-empty rows', async () => {
    const cache = await cachesShim.open(ONNX_BASE_CACHE_NAME);
    await cache.put(
      new Request(`https://cdn.example/onnx-base/${ONNX_BASE_LABELS_FILE}`),
      new Response('n01440764 tench\n\n  n01443537 goldfish  \nflamingo\n'),
    );
    const labels = await getCachedLabels();
    expect(labels).toEqual(['n01440764 tench', 'n01443537 goldfish', 'flamingo']);
  });

  it('returns the model buffer bytes when present', async () => {
    const cache = await cachesShim.open(ONNX_BASE_CACHE_NAME);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await cache.put(
      new Request(`https://cdn.example/onnx-base/${ONNX_BASE_MODEL_FILE}`),
      new Response(bytes),
    );
    const buf = await getCachedModelBuffer();
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(bytes);
  });
});

describe('clearOnnxBaseCache', () => {
  it('returns 0 when there is nothing to delete', async () => {
    const r = await clearOnnxBaseCache();
    expect(r.deleted).toBe(0);
  });

  it('deletes every cache entry and reports the count', async () => {
    const cache = await cachesShim.open(ONNX_BASE_CACHE_NAME);
    await cache.put(new Request('https://cdn.example/onnx-base/a.onnx'), new Response('a'));
    await cache.put(new Request('https://cdn.example/onnx-base/b.txt'),  new Response('b'));
    const r = await clearOnnxBaseCache();
    expect(r.deleted).toBe(2);
    const after = await getOnnxBaseCacheStatus();
    expect(after.modelCached).toBe(false);
    expect(after.labelsCached).toBe(false);
  });
});

describe('downloadOnnxBaseWeights', () => {
  it('throws a clear error when env var is unset', async () => {
    await expect(downloadOnnxBaseWeights()).rejects.toThrow(/PUBLIC_ONNX_BASE_URL/);
  });
});
