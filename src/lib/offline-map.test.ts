import { describe, it, expect, beforeEach } from 'vitest';

// Map-backed Cache API shim — happy-dom doesn't provide window.caches.
// Mirrors the shim in identifiers/birdnet-cache.test.ts so we can drive
// the cache surface (open, keys, match, put, delete) without a browser.
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
  PMTILES_CACHE_NAME, PMTILES_MX_FILE,
  getPmtilesMxUrl, getPmtilesCacheStatus, clearPmtilesCache,
  downloadPmtilesMx, decideTileSource,
  getPmtilesCacheKey, getPmtilesProtocolUrl,
} from './offline-map';

beforeEach(() => {
  cacheBuckets.clear();
  const env = import.meta.env as unknown as Record<string, unknown>;
  for (const k of Object.keys(env)) {
    if (!(k in ORIGINAL_ENV)) delete env[k];
  }
});

describe('offline-map module exports', () => {
  it('uses the documented cache name', () => {
    expect(PMTILES_CACHE_NAME).toBe('rastrum/pmtiles');
  });
  it('uses the documented archive filename', () => {
    expect(PMTILES_MX_FILE).toBe('mexico-z0-10.pmtiles');
  });
});

describe('getPmtilesMxUrl', () => {
  it('returns null when env var is unset', () => {
    expect(getPmtilesMxUrl()).toBeNull();
  });

  it('returns the configured URL', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL =
      'https://cdn.example/tiles/mexico-z0-10.pmtiles';
    expect(getPmtilesMxUrl()).toBe('https://cdn.example/tiles/mexico-z0-10.pmtiles');
  });

  it('treats whitespace-only env var as unset', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL = '   ';
    expect(getPmtilesMxUrl()).toBeNull();
  });
});

describe('getPmtilesCacheKey / getPmtilesProtocolUrl', () => {
  it('cache key matches the configured URL exactly', () => {
    const url = 'https://cdn.example/tiles/mexico-z0-10.pmtiles';
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL = url;
    expect(getPmtilesCacheKey()).toBe(url);
  });

  it('protocol URL prefixes pmtiles://', () => {
    const url = 'https://cdn.example/tiles/mexico-z0-10.pmtiles';
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL = url;
    expect(getPmtilesProtocolUrl()).toBe(`pmtiles://${url}`);
  });

  it('returns null when env var is unset', () => {
    expect(getPmtilesCacheKey()).toBeNull();
    expect(getPmtilesProtocolUrl()).toBeNull();
  });
});

describe('getPmtilesCacheStatus', () => {
  it('reports nothing cached on a fresh cache', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL =
      'https://cdn.example/tiles/mexico-z0-10.pmtiles';
    const s = await getPmtilesCacheStatus();
    expect(s.cached).toBe(false);
    expect(s.approxBytes).toBe(0);
  });

  it('reports cached + bytes after manual put', async () => {
    const url = 'https://cdn.example/tiles/mexico-z0-10.pmtiles';
    (import.meta.env as unknown as Record<string, string>).PUBLIC_PMTILES_MX_URL = url;
    const cache = await cachesShim.open(PMTILES_CACHE_NAME);
    const bytes = new Uint8Array(987_654);
    await cache.put(
      new Request(url),
      new Response(bytes, { headers: { 'content-length': '987654' } }),
    );
    const s = await getPmtilesCacheStatus();
    expect(s.cached).toBe(true);
    expect(s.approxBytes).toBe(987_654);
  });

  it('treats unconfigured env as not-cached', async () => {
    // Even if some entry happens to live in the bucket, without a
    // configured URL there's nothing to match against.
    const cache = await cachesShim.open(PMTILES_CACHE_NAME);
    await cache.put(
      new Request('https://stale.example/old.pmtiles'),
      new Response(new Uint8Array(1)),
    );
    const s = await getPmtilesCacheStatus();
    expect(s.cached).toBe(false);
  });
});

describe('clearPmtilesCache', () => {
  it('returns 0 on empty cache', async () => {
    const r = await clearPmtilesCache();
    expect(r.deleted).toBe(0);
  });

  it('deletes every entry in the pmtiles cache', async () => {
    const cache = await cachesShim.open(PMTILES_CACHE_NAME);
    await cache.put(new Request('https://cdn.example/tiles/a.pmtiles'), new Response('a'));
    await cache.put(new Request('https://cdn.example/tiles/b.pmtiles'), new Response('b'));
    const r = await clearPmtilesCache();
    expect(r.deleted).toBe(2);
  });
});

describe('downloadPmtilesMx', () => {
  it('throws a clear error when env var is unset', async () => {
    await expect(downloadPmtilesMx()).rejects.toThrow(/PUBLIC_PMTILES_MX_URL/);
  });
});

describe('decideTileSource', () => {
  it('returns unconfigured when the env var is missing', () => {
    expect(decideTileSource({ configured: false, hasCache: false, online: true })).toBe('unconfigured');
    expect(decideTileSource({ configured: false, hasCache: true,  online: false })).toBe('unconfigured');
  });

  it('returns cached when the archive is present, regardless of connectivity', () => {
    expect(decideTileSource({ configured: true, hasCache: true, online: true  })).toBe('cached');
    expect(decideTileSource({ configured: true, hasCache: true, online: false })).toBe('cached');
  });

  it('returns remote when online without a local cache', () => {
    expect(decideTileSource({ configured: true, hasCache: false, online: true })).toBe('remote');
  });

  it('returns offline-no-cache when offline without a local cache', () => {
    expect(decideTileSource({ configured: true, hasCache: false, online: false })).toBe('offline-no-cache');
  });

  it('still prefers cache when preferCacheWhenOnline is omitted', () => {
    // The preferCacheWhenOnline flag is informational; the decision
    // matrix already prefers cache on online+cached. Spot-check that
    // toggling it doesn't change the outcome.
    expect(decideTileSource({ configured: true, hasCache: true, online: true, preferCacheWhenOnline: true  })).toBe('cached');
    expect(decideTileSource({ configured: true, hasCache: true, online: true, preferCacheWhenOnline: false })).toBe('cached');
  });
});
