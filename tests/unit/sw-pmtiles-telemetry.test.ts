/**
 * Unit test for #818: SW pmtiles response latency telemetry.
 *
 * Verifies that servePmtilesRange:
 *   1. Calls self.clients.matchAll() after serving a range request.
 *   2. Posts a { type: 'pmtiles_latency', latencyMs, source } message to each client.
 *   3. Includes a non-negative latencyMs value.
 *   4. Reports correct `source` strings for memo-hit vs fresh-decode paths.
 *
 * The SW code cannot be imported directly (no module system), so we
 * inline a mirror of servePmtilesRange that matches the implementation.
 * This test pins the observable contract of the telemetry message shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fake client infrastructure ───────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyFn = (...args: any[]) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViFn = SpyFn & { mock: { calls: any[][] }; mockClear: () => void };
interface FakeClient { postMessage: ViFn; }

let fakeClients: FakeClient[] = [];

const _matchAllMock = vi.fn().mockImplementation(async () => fakeClients);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _selfMatchAll(): Promise<FakeClient[]> { return (_matchAllMock as any)(); }

const selfShim = {
  clients: { matchAll: _selfMatchAll },
};

// ── Cache shim ────────────────────────────────────────────────────────────

class CacheShim {
  private _store = new Map<string, Response>();
  async match(key: string) { return this._store.get(key)?.clone(); }
  async put(key: string, val: Response) { this._store.set(key, val.clone()); }
}
const _buckets = new Map<string, CacheShim>();
const cachesShim = {
  async open(name: string) {
    let c = _buckets.get(name);
    if (!c) { c = new CacheShim(); _buckets.set(name, c); }
    return c;
  },
};
Object.defineProperty(globalThis, 'caches', { configurable: true, value: cachesShim });

// ── Inline mirror of sw.js#servePmtilesRange (with telemetry) ────────────

const PMTILES_CACHE_NAME = 'rastrum/pmtiles';
let pmtilesBufferMemo: { key: string; buf: ArrayBuffer } | null = null;

async function servePmtilesRange(req: Request, url: URL): Promise<Response> {
  const _start = performance.now();
  function _reportLatency(source: string) {
    const latencyMs = Math.round(performance.now() - _start);
    selfShim.clients.matchAll().then((clients: FakeClient[]) =>
      clients.forEach((c: FakeClient) => c.postMessage({ type: 'pmtiles_latency', latencyMs, source }))
    );
  }
  try {
    const cache = await cachesShim.open(PMTILES_CACHE_NAME);
    const cached = await cache.match(url.href);
    if (!cached) { _reportLatency('network-fallback'); return new Response('fallback', { status: 599 }); }

    const range = req.headers.get('range');
    if (!range) { _reportLatency('cache-no-range'); return cached; }

    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m) { _reportLatency('cache-bad-range'); return cached; }

    const start = parseInt(m[1], 10);
    const end   = parseInt(m[2], 10);
    const etag  = cached.headers.get('etag') || '';
    const memoKey = `${url.href}|${etag}`;
    let buf: ArrayBuffer;
    let memoHit = false;
    if (pmtilesBufferMemo && pmtilesBufferMemo.key === memoKey) {
      buf = pmtilesBufferMemo.buf;
      memoHit = true;
    } else {
      buf = await cached.arrayBuffer();
      pmtilesBufferMemo = { key: memoKey, buf };
    }
    const total = buf.byteLength;
    if (start >= total) {
      _reportLatency('cache-416');
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const sliceEnd = Math.min(end + 1, total);
    const slice = buf.slice(start, sliceEnd);
    const headers = new Headers();
    headers.set('Content-Range', `bytes ${start}-${sliceEnd - 1}/${total}`);
    headers.set('Content-Length', String(slice.byteLength));
    headers.set('Accept-Ranges', 'bytes');
    if (etag) headers.set('ETag', etag);
    _reportLatency(memoHit ? 'cache-memo' : 'cache-decode');
    return new Response(slice, { status: 206, statusText: 'Partial Content', headers });
  } catch {
    _reportLatency('error-fallback');
    return new Response('error', { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRange(start: number, end: number) {
  return new Headers({ range: `bytes=${start}-${end}` });
}

async function seedCache(url: string, body: Uint8Array, etag = 'etag-v1') {
  const cache = await cachesShim.open(PMTILES_CACHE_NAME);
  await cache.put(url, new Response(body.buffer as BodyInit, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', etag },
  }));
}

function collectMessages(): { type: string; latencyMs: number; source: string }[] {
  return fakeClients.flatMap(c =>
    (c.postMessage.mock.calls as [[unknown]][]).map(([m]) => m as any)
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('#818 — SW pmtiles latency telemetry', () => {
  const URL_STR = 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles';
  const url = new URL(URL_STR);
  const body = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));

  beforeEach(() => {
    pmtilesBufferMemo = null;
    fakeClients = [{ postMessage: vi.fn() as unknown as ViFn }, { postMessage: vi.fn() as unknown as ViFn }];
    _buckets.clear();
    _matchAllMock.mockClear();
  });

  it('broadcasts pmtiles_latency after a successful range request', async () => {
    await seedCache(URL_STR, body);
    const req = new Request(URL_STR, { headers: makeRange(0, 7) });
    await servePmtilesRange(req, url);
    // Allow microtasks to flush (matchAll().then())
    await new Promise(r => setTimeout(r, 0));

    const msgs = collectMessages();
    expect(msgs.length).toBeGreaterThan(0);
    const msg = msgs[0];
    expect(msg.type).toBe('pmtiles_latency');
    expect(typeof msg.latencyMs).toBe('number');
    expect(msg.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('source is "cache-decode" on first fetch (no memo)', async () => {
    await seedCache(URL_STR, body);
    const req = new Request(URL_STR, { headers: makeRange(0, 7) });
    await servePmtilesRange(req, url);
    await new Promise(r => setTimeout(r, 0));

    const msgs = collectMessages();
    expect(msgs.some(m => m.source === 'cache-decode')).toBe(true);
  });

  it('source is "cache-memo" on second fetch (memo hit)', async () => {
    await seedCache(URL_STR, body);
    // First call populates memo
    await servePmtilesRange(new Request(URL_STR, { headers: makeRange(0, 7) }), url);
    await new Promise(r => setTimeout(r, 0));
    fakeClients.forEach(c => c.postMessage.mockClear());

    // Second call — memo hit
    await servePmtilesRange(new Request(URL_STR, { headers: makeRange(8, 15) }), url);
    await new Promise(r => setTimeout(r, 0));

    const msgs = collectMessages();
    expect(msgs.some(m => m.source === 'cache-memo')).toBe(true);
  });

  it('source is "network-fallback" when cache is empty', async () => {
    const req = new Request(URL_STR, { headers: makeRange(0, 7) });
    await servePmtilesRange(req, url);
    await new Promise(r => setTimeout(r, 0));

    const msgs = collectMessages();
    expect(msgs.some(m => m.source === 'network-fallback')).toBe(true);
  });

  it('broadcasts to ALL connected clients', async () => {
    await seedCache(URL_STR, body);
    const req = new Request(URL_STR, { headers: makeRange(0, 3) });
    await servePmtilesRange(req, url);
    await new Promise(r => setTimeout(r, 0));

    // Both fake clients should have received the message.
    fakeClients.forEach(c => {
      expect(c.postMessage).toHaveBeenCalled();
    });
  });

  it('source is "cache-416" when range starts beyond buffer end', async () => {
    await seedCache(URL_STR, body);
    const beyond = body.length + 100;
    const req = new Request(URL_STR, { headers: makeRange(beyond, beyond + 7) });
    await servePmtilesRange(req, url);
    await new Promise(r => setTimeout(r, 0));

    const msgs = collectMessages();
    expect(msgs.some(m => m.source === 'cache-416')).toBe(true);
  });
});
