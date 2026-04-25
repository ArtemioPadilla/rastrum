import { describe, it, expect, beforeEach } from 'vitest';

// Map-backed Cache API shim — happy-dom doesn't provide window.caches.
// We model only the surface birdnet-cache uses: open, keys, match, put,
// delete. The shim is reset between tests via clearShim() below.
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
  BIRDNET_CACHE_NAME, BIRDNET_MODEL_FILE, BIRDNET_LABELS_FILE,
  getBirdNETCacheStatus, clearBirdNETCache,
  getCachedLabels, getCachedModelBuffer, getBirdNETWeightsBaseUrl,
  downloadBirdNETWeights,
} from './birdnet-cache';

beforeEach(() => {
  cacheBuckets.clear();
  // Restore env between tests (vitest preserves the proxy, but tests
  // that mutate it should reset for isolation).
  const env = import.meta.env as unknown as Record<string, unknown>;
  for (const k of Object.keys(env)) {
    if (!(k in ORIGINAL_ENV)) delete env[k];
  }
});

describe('birdnet-cache module exports', () => {
  it('uses the documented cache name', () => {
    expect(BIRDNET_CACHE_NAME).toBe('rastrum/birdnet');
  });
  it('uses the documented file names', () => {
    expect(BIRDNET_MODEL_FILE).toBe('birdnet_v2.4.onnx');
    expect(BIRDNET_LABELS_FILE).toBe('BirdNET_GLOBAL_6K_V2.4_Labels.txt');
  });
});

describe('getBirdNETWeightsBaseUrl', () => {
  it('returns null when env var is unset', () => {
    expect(getBirdNETWeightsBaseUrl()).toBeNull();
  });

  it('strips trailing slashes when set', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_BIRDNET_WEIGHTS_URL = 'https://cdn.example/birdnet/';
    expect(getBirdNETWeightsBaseUrl()).toBe('https://cdn.example/birdnet');
  });
});

describe('getBirdNETCacheStatus', () => {
  it('reports nothing cached on a fresh cache', async () => {
    const s = await getBirdNETCacheStatus();
    expect(s.modelCached).toBe(false);
    expect(s.labelsCached).toBe(false);
    expect(s.approxBytes).toBe(0);
  });

  it('reports model + labels cached after manual put', async () => {
    const cache = await cachesShim.open(BIRDNET_CACHE_NAME);
    const labelsBody = 'Tyrannus melancholicus_Tropical Kingbird\n';
    await cache.put(
      new Request(`https://cdn.example/birdnet/${BIRDNET_LABELS_FILE}`),
      new Response(labelsBody, { headers: { 'content-length': String(labelsBody.length) } }),
    );
    const modelBytes = new Uint8Array(1234);
    await cache.put(
      new Request(`https://cdn.example/birdnet/${BIRDNET_MODEL_FILE}`),
      new Response(modelBytes, { headers: { 'content-length': '1234' } }),
    );
    const s = await getBirdNETCacheStatus();
    expect(s.modelCached).toBe(true);
    expect(s.labelsCached).toBe(true);
    expect(s.approxBytes).toBe(labelsBody.length + 1234);
  });
});

describe('getCachedLabels / getCachedModelBuffer', () => {
  it('returns null when nothing cached', async () => {
    expect(await getCachedLabels()).toBeNull();
    expect(await getCachedModelBuffer()).toBeNull();
  });

  it('parses labels into trimmed, non-empty rows', async () => {
    const cache = await cachesShim.open(BIRDNET_CACHE_NAME);
    await cache.put(
      new Request(`https://cdn.example/birdnet/${BIRDNET_LABELS_FILE}`),
      new Response('A_x\n\n  B_y  \nC\n'),
    );
    const labels = await getCachedLabels();
    expect(labels).toEqual(['A_x', 'B_y', 'C']);
  });

  it('returns the model buffer bytes when present', async () => {
    const cache = await cachesShim.open(BIRDNET_CACHE_NAME);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await cache.put(
      new Request(`https://cdn.example/birdnet/${BIRDNET_MODEL_FILE}`),
      new Response(bytes),
    );
    const buf = await getCachedModelBuffer();
    expect(buf).not.toBeNull();
    expect(new Uint8Array(buf!)).toEqual(bytes);
  });
});

describe('clearBirdNETCache', () => {
  it('returns 0 when there is nothing to delete', async () => {
    const r = await clearBirdNETCache();
    expect(r.deleted).toBe(0);
  });

  it('deletes every cache entry and reports the count', async () => {
    const cache = await cachesShim.open(BIRDNET_CACHE_NAME);
    await cache.put(new Request('https://cdn.example/birdnet/a.onnx'), new Response('a'));
    await cache.put(new Request('https://cdn.example/birdnet/b.txt'),  new Response('b'));
    const r = await clearBirdNETCache();
    expect(r.deleted).toBe(2);
    const after = await getBirdNETCacheStatus();
    expect(after.modelCached).toBe(false);
    expect(after.labelsCached).toBe(false);
  });
});

describe('downloadBirdNETWeights', () => {
  it('throws a clear error when env var is unset', async () => {
    await expect(downloadBirdNETWeights()).rejects.toThrow(/PUBLIC_BIRDNET_WEIGHTS_URL/);
  });
});
