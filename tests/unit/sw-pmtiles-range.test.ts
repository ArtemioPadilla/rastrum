/**
 * Behavioural spec for the pmtiles range-slicing algorithm in
 * `public/sw.js#servePmtilesRange`. The SW can't `import` from src/, so
 * the algorithm is duplicated below — this test pins what the SW must do
 * when MapLibre/pmtiles makes byte-range fetches against a pmtiles
 * archive that lives in the page-managed `rastrum/pmtiles` cache.
 *
 * Why this matters: src/lib/offline-map.ts stores the entire ~50 MB
 * pmtiles archive as a single 200 Response in the Cache API. PMTiles'
 * FetchSource issues `Range: bytes=A-B` GETs at every map render. The
 * SW intercepts those, looks up the cached 200, slices the body, and
 * returns a 206 Partial Content. Without this, the cached archive is
 * orphaned (page can write it, nothing reads it) and every map load
 * still hits the network.
 */
import { describe, it, expect, beforeEach } from 'vitest';

class CacheShim {
  private store = new Map<string, Response>();
  async match(key: string): Promise<Response | undefined> {
    const res = this.store.get(key);
    return res ? res.clone() : undefined;
  }
  async put(key: string, res: Response): Promise<void> {
    this.store.set(key, res.clone());
  }
}

const cacheBuckets = new Map<string, CacheShim>();
const cachesShim = {
  async open(name: string) {
    let c = cacheBuckets.get(name);
    if (!c) { c = new CacheShim(); cacheBuckets.set(name, c); }
    return c;
  },
};
Object.defineProperty(globalThis, 'caches', { configurable: true, value: cachesShim });

const PMTILES_CACHE_NAME = 'rastrum/pmtiles';

// Mirror of public/sw.js#servePmtilesRange. Keep in sync — divergence is
// caught by e2e in production but should not happen in code review.
async function servePmtilesRange(req: Request, url: URL): Promise<Response> {
  try {
    const cache = await cachesShim.open(PMTILES_CACHE_NAME);
    const cached = await cache.match(url.href);
    if (!cached) return new Response('network-fallback', { status: 599 });

    const range = req.headers.get('range');
    if (!range) return cached;

    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) return cached;

    const start = parseInt(m[1], 10);
    const end   = parseInt(m[2], 10);
    const buf   = await cached.arrayBuffer();
    const total = buf.byteLength;
    if (start >= total) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const sliceEnd = Math.min(end + 1, total);
    const slice = buf.slice(start, sliceEnd);

    const headers = new Headers();
    const contentType = cached.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);
    const etag = cached.headers.get('etag');
    if (etag) headers.set('ETag', etag);
    headers.set('Content-Range', `bytes ${start}-${sliceEnd - 1}/${total}`);
    headers.set('Content-Length', String(slice.byteLength));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(slice, { status: 206, statusText: 'Partial Content', headers });
  } catch {
    return new Response('network-fallback', { status: 599 });
  }
}

const ARCHIVE_URL = 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles';

function fillBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = i & 0xff;
  return a;
}

async function seed(body: Uint8Array): Promise<void> {
  const cache = await cachesShim.open(PMTILES_CACHE_NAME);
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.byteLength),
    'ETag': 'W/"test-etag"',
  });
  await cache.put(ARCHIVE_URL, new Response(body as BodyInit, { status: 200, headers }));
}

describe('servePmtilesRange', () => {
  beforeEach(() => {
    cacheBuckets.clear();
  });

  it('returns the full body when no Range header is present', async () => {
    const body = fillBytes(1024);
    await seed(body);
    const req = new Request(ARCHIVE_URL);
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));
    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.byteLength).toBe(1024);
    expect(got[0]).toBe(0);
    expect(got[255]).toBe(255);
  });

  it('serves a 206 with the requested slice for a closed-interval Range', async () => {
    const body = fillBytes(1024);
    await seed(body);
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=10-19' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 10-19/1024');
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('ETag')).toBe('W/"test-etag"');

    const slice = new Uint8Array(await res.arrayBuffer());
    expect(slice.byteLength).toBe(10);
    expect(Array.from(slice)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('clamps Range end past EOF to the archive length', async () => {
    const body = fillBytes(100);
    await seed(body);
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=90-200' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 90-99/100');
    expect(res.headers.get('Content-Length')).toBe('10');
    const slice = new Uint8Array(await res.arrayBuffer());
    expect(slice.byteLength).toBe(10);
    expect(slice[0]).toBe(90);
    expect(slice[9]).toBe(99);
  });

  it('returns 416 when Range start is at or beyond the archive length', async () => {
    const body = fillBytes(50);
    await seed(body);
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=100-200' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */50');
  });

  it('serves a single-byte Range correctly', async () => {
    const body = fillBytes(256);
    await seed(body);
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=42-42' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 42-42/256');
    expect(res.headers.get('Content-Length')).toBe('1');
    const slice = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(slice)).toEqual([42]);
  });

  it('returns the full cached body when the Range header is malformed', async () => {
    const body = fillBytes(64);
    await seed(body);
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=foo' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));

    expect(res.status).toBe(200);
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got.byteLength).toBe(64);
  });

  it('falls back to network on cache miss (no entry seeded)', async () => {
    const req = new Request(ARCHIVE_URL, { headers: { Range: 'bytes=0-100' } });
    const res = await servePmtilesRange(req, new URL(ARCHIVE_URL));
    expect(res.status).toBe(599);
    await expect(res.text()).resolves.toBe('network-fallback');
  });
});
