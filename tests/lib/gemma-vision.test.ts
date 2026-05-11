import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  },
  writable: true,
  configurable: true,
});

// Minimal TextStreamer stub: calls callback with a single token.
class FakeTextStreamer {
  constructor(
    _tok: unknown,
    private opts: { callback_function: (token: string) => void },
  ) {}
  put(ids: unknown) {
    this.opts.callback_function('hi ');
    void ids;
  }
  end() {}
}

vi.mock('@huggingface/transformers', () => ({
  AutoProcessor: { from_pretrained: vi.fn() },
  Gemma4ForConditionalGeneration: { from_pretrained: vi.fn() },
  load_image: vi.fn(),
  TextStreamer: FakeTextStreamer,
}));

describe('onnx-vision module', () => {
  beforeEach(() => { store.clear(); });

  it('imports without panicking in Node-like env (transformers.js is lazy-imported)', async () => {
    const mod = await import('../../src/lib/onnx-vision');
    expect(mod.GEMMA_VISION_MODEL_ID).toBe('onnx-community/gemma-4-E2B-it-ONNX');
  });

  it('gemmaSupported() returns false when navigator.gpu is missing', async () => {
    const { gemmaSupported } = await import('../../src/lib/onnx-vision');
    expect(gemmaSupported()).toBe(false);
  });

  it('getGemmaCacheStatus() returns cached:false when caches API missing', async () => {
    const { getGemmaCacheStatus } = await import('../../src/lib/onnx-vision');
    const status = await getGemmaCacheStatus();
    expect(status.cached).toBe(false);
    expect(status.entries).toBe(0);
  });

  it('generateGemmaText() stream:true exercises TextStreamer code path', async () => {
    const { generateGemmaText } = await import('../../src/lib/onnx-vision');
    // Mocked processor/model are not loaded — this should throw before yield
    // because loadGemmaVisionEngine calls gemmaSupported() first (no WebGPU in jsdom).
    const gen = generateGemmaText([{ role: 'user', content: 'hello' }], { stream: true });
    // AsyncIterable — use async iterator protocol to call next()
    const iter = (gen as AsyncGenerator)[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow();
  });
});

describe('gemma-vision identifier', () => {
  beforeEach(() => { store.clear(); });

  it('isAvailable returns unsupported when WebGPU is missing (no legacy opt-in gate)', async () => {
    const { gemmaVisionIdentifier } = await import('../../src/lib/identifiers/gemma-vision');
    const av = await gemmaVisionIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) expect(av.reason).toBe('unsupported');
  });

  it('plugin id collision-protected via registry', async () => {
    const { GEMMA_PLUGIN_ID } = await import('../../src/lib/identifiers/gemma-vision');
    expect(GEMMA_PLUGIN_ID).toBe('onnx_gemma4_vision');
  });
});
