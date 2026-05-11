/**
 * On-device vision/text via transformers.js + ONNX.
 *
 * Models managed here:
 *   - **Gemma 4 E2B** (vision + text) — `onnx-community/gemma-4-E2B-it-ONNX`
 *     ~500 MB on disk (q4f16), ~1.3–1.5 GB VRAM. Apache 2.0 license.
 *   - **Llama 3.2 1B** (text only) — `onnx-community/Llama-3.2-1B-Instruct`
 *     ~880 MB on disk, ~600 MB VRAM. Meta Llama 3 Community License.
 *     Added by issue #716: re-platforms Llama from WebLLM/MLC to
 *     transformers.js, consolidating on a single ONNX runtime.
 *
 * Parallel runtime to `local-ai.ts` (which uses MLC/WebLLM for Phi-3.5-vision
 * and, by default, now delegates Llama text here). Both runtimes take
 * completely different WebGPU code paths so a crash on one doesn't affect
 * the other — resilience, not replacement.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Feature flag: set USE_WEBLLM=1 (env or window.__USE_WEBLLM) to keep using the
// WebLLM/MLC path for Llama instead of this ONNX path. Intended for A/B testing
// and rollback. Checked at runtime in local-ai.ts (translateNote, generateFieldNote).
// ──────────────────────────────────────────────────────────────────────────────

export const GEMMA_VISION_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

export type LoadProgress = {
  progress: number;        // 0..1
  text: string;            // human-readable phase
  timeElapsedMs: number;
};

export interface OnnxVisionResult {
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Unknown';
  family: string | null;
  confidence: number;            // hard-capped at 0.4 like Phi
  notes: string;
  source: 'onnx_gemma4_vision';
  warning: string;
}

interface ProcessorLike {
  apply_chat_template: (messages: unknown, opts: Record<string, unknown>) => string;
  tokenizer: unknown;
  (prompt: string, image: unknown, opts?: Record<string, unknown>): Promise<unknown>;
}
interface GemmaModelLike {
  generate: (args: Record<string, unknown>) => Promise<unknown>;
  dispose?: () => Promise<void>;
}

let processor: ProcessorLike | null = null;
let model: GemmaModelLike | null = null;

/**
 * Returns true when transformers.js can probably run on this device.
 * Same memory gate as Phi — Gemma 4 E2B q4f16 actually needs less VRAM
 * (~1.3 GB at inference vs Phi's ~4 GB), so what's safe for Phi is
 * comfortably safe here too.
 *
 * Note: navigator.deviceMemory rounds to powers of 2 (1, 2, 4, 8) — a
 * device with 6 GB of real RAM reports 4. The `<= 4` gate matches Phi
 * and lets 6 GB devices through; tighter gates would lock out a real
 * slice of mobile users for a model that doesn't actually need it.
 */
export function gemmaSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hasGpu = 'gpu' in navigator && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  if (!hasGpu) return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem <= 4) return false;
  return true;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export type ModelCacheStatus = {
  modelId: string;
  cached: boolean;
  approxBytes: number;
  entries: number;
};

/**
 * Probe transformers.js's Cache API entries for the given model id.
 * Transformers.js writes weights to `caches.open('transformers-cache')`
 * keyed by the full HF download URL (`https://huggingface.co/<id>/resolve/main/...`).
 */
export async function getGemmaCacheStatus(modelId: string = GEMMA_VISION_MODEL_ID): Promise<ModelCacheStatus> {
  if (typeof caches === 'undefined') {
    return { modelId, cached: false, approxBytes: 0, entries: 0 };
  }
  const c = await caches.open(TRANSFORMERS_CACHE_NAME).catch(() => null);
  if (!c) return { modelId, cached: false, approxBytes: 0, entries: 0 };
  const keys = await c.keys();
  let entries = 0;
  let approxBytes = 0;
  for (const req of keys) {
    if (req.url.includes(modelId)) {
      entries++;
      try {
        const res = await c.match(req);
        const len = res?.headers.get('content-length');
        if (len) approxBytes += parseInt(len, 10);
      } catch { /* ignore */ }
    }
  }
  return { modelId, cached: entries > 0, approxBytes, entries };
}

export async function clearGemmaCache(modelId: string = GEMMA_VISION_MODEL_ID): Promise<{ deleted: number }> {
  if (typeof caches === 'undefined') return { deleted: 0 };
  if (model?.dispose) {
    try { await model.dispose(); } catch { /* ignore */ }
  }
  model = null;
  processor = null;
  const c = await caches.open(TRANSFORMERS_CACHE_NAME).catch(() => null);
  if (!c) return { deleted: 0 };
  const keys = await c.keys();
  let deleted = 0;
  for (const req of keys) {
    if (req.url.includes(modelId)) {
      const ok = await c.delete(req);
      if (ok) deleted++;
    }
  }
  return { deleted };
}

/**
 * Bootstrap transformers.js and load Gemma 4 E2B (vision). Lazy-imports
 * the SDK so unrelated bundles don't pay its ~2 MB gzipped weight. The
 * progress callback fires repeatedly during the ~500 MB download.
 */
export async function loadGemmaVisionEngine(
  onProgress: (p: LoadProgress) => void,
): Promise<{ processor: ProcessorLike; model: GemmaModelLike }> {
  if (processor && model) return { processor, model };
  if (!gemmaSupported()) {
    throw new Error('WebGPU not available — Gemma vision unavailable on this browser.');
  }
  await requestPersistentStorage().catch(() => {});

  const start = performance.now();
  const tx = await import('@huggingface/transformers');
  const { AutoProcessor, Gemma4ForConditionalGeneration } = tx as unknown as {
    AutoProcessor: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<ProcessorLike> };
    Gemma4ForConditionalGeneration: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<GemmaModelLike> };
  };

  const progressBridge = (p: { status?: string; progress?: number; file?: string }) => {
    const ratio = typeof p.progress === 'number'
      ? (p.progress > 1 ? p.progress / 100 : p.progress)
      : 0;
    onProgress({
      progress: Math.max(0, Math.min(1, ratio)),
      text: p.file ? `${p.status ?? 'loading'} ${p.file}` : (p.status ?? 'loading'),
      timeElapsedMs: performance.now() - start,
    });
  };

  processor = await AutoProcessor.from_pretrained(GEMMA_VISION_MODEL_ID, {
    progress_callback: progressBridge,
  });
  model = await Gemma4ForConditionalGeneration.from_pretrained(GEMMA_VISION_MODEL_ID, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: progressBridge,
  });
  return { processor, model };
}

export async function unloadGemma(): Promise<void> {
  if (model?.dispose) {
    try { await model.dispose(); } catch { /* ignore */ }
  }
  processor = null;
  model = null;
}

/**
 * Run vision inference. Mirrors `identifyImageLocal` (local-ai.ts) so
 * the identifier plugin layer stays symmetric across runtimes.
 */
export async function identifyImageWithGemma(
  imageDataUrl: string,
  onProgress: (p: LoadProgress) => void,
  context?: { lat?: number; lng?: number; habitat?: string },
): Promise<OnnxVisionResult> {
  const { processor: proc, model: mdl } = await loadGemmaVisionEngine(onProgress);
  const tx = await import('@huggingface/transformers');
  const load_image = (tx as unknown as { load_image: (src: string) => Promise<unknown> }).load_image;

  const prompt = [
    'You see a photo from a biodiversity observation in Latin America.',
    'Identify the most likely species. If unsure, say so explicitly.',
    'Respond with JSON ONLY, matching exactly this shape:',
    '{"scientific_name":"","common_name_en":"","common_name_es":"","kingdom":"Plantae|Animalia|Fungi|Unknown","family":"","notes":""}',
    context?.lat && context?.lng ? `Location: ${context.lat}, ${context.lng}.` : '',
    context?.habitat ? `Habitat: ${context.habitat}.` : '',
  ].filter(Boolean).join('\n');

  const messages = [{
    role: 'user',
    content: [
      { type: 'image' },
      { type: 'text', text: prompt },
    ],
  }];

  const promptText = proc.apply_chat_template(messages, {
    enable_thinking: false,
    add_generation_prompt: true,
  });
  const image = await load_image(imageDataUrl);
  const inputs = await proc(promptText, image, { add_special_tokens: false });

  const generated = await mdl.generate({
    ...(inputs as Record<string, unknown>),
    max_new_tokens: 256,
    do_sample: false,
  });

  const decoded = await decodeGeneration(proc, generated);
  const cleaned = decoded.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  let parsed: Partial<OnnxVisionResult> = {};
  try { parsed = JSON.parse(cleaned); } catch { parsed = { scientific_name: '', notes: cleaned }; }

  return {
    scientific_name: parsed.scientific_name ?? '',
    common_name_en: parsed.common_name_en ?? null,
    common_name_es: parsed.common_name_es ?? null,
    kingdom: (parsed.kingdom as OnnxVisionResult['kingdom']) ?? 'Unknown',
    family: parsed.family ?? null,
    confidence: 0.35,
    notes: parsed.notes ?? '',
    source: 'onnx_gemma4_vision',
    warning: 'On-device general VLM result. Treat as a hint, not a verified ID. Quality-gated below 0.4 confidence.',
  };
}

/**
 * Text-only generation using the loaded Gemma 4 E2B model. Yields one chunk
 * shaped like `{ choices: [{ delta: { content } }] }` so chat-engine can
 * consume Gemma and Llama through the same async iterator. Streaming token
 * deltas via transformers.js is a v1.1 polish; v1 emits one chunk per turn.
 */
export async function* generateGemmaText(
  messages: Array<{ role: string; content: string }>,
  opts: { max_tokens?: number; stream?: boolean },
): AsyncIterable<{ choices: Array<{ delta?: { content?: string }; message?: { content: string } }> }> {
  const { processor: proc, model: mdl } = await loadGemmaVisionEngine(() => {});

  // --- Gemma 4 strict message normalization ---
  // Gemma's chat template requires:
  //   1. messages[0].role === 'system' (exactly one, exactly first)
  //   2. No consecutive same-role turns (alternating user/assistant)
  //   3. 'tool' role not supported — flatten to user

  // 1. Collect all system messages and merge them into one
  const systemParts = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  // 2. Flatten 'tool' role → user with [tool_result] prefix
  const flatMsgs = nonSystemMsgs.map(m =>
    m.role === 'tool'
      ? { role: 'user', content: `[tool_result] ${m.content}` }
      : { role: m.role, content: m.content }
  );

  // 3. Merge consecutive same-role turns (Gemma requires strict alternation)
  const merged: Array<{ role: string; content: string }> = [];
  for (const msg of flatMsgs) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }

  // 4. Build final array: single system first, then alternating turns
  const normalized = [
    ...(systemParts ? [{ role: 'system', content: systemParts }] : []),
    ...merged,
  ];

  // Map our role/content shape to the Gemma chat template's content array.
  const chatMsgs = normalized.map(m => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  const promptText = proc.apply_chat_template(chatMsgs, {
    enable_thinking: false,
    add_generation_prompt: true,
  });
  const inputs = await proc(promptText, undefined, { add_special_tokens: false });

  const max_new_tokens = Math.min(opts.max_tokens ?? 512, 1024);

  if (opts.stream) {
    const { TextStreamer } = await import('@huggingface/transformers') as unknown as {
      TextStreamer: new (
        tokenizer: unknown,
        opts: {
          skip_prompt: boolean;
          skip_special_tokens: boolean;
          callback_function: (token: string) => void;
        },
      ) => unknown;
    };
    const tokens: string[] = [];
    const streamer = new TextStreamer(proc.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (token: string) => {
        tokens.push(token);
      },
    });
    await mdl.generate({
      ...(inputs as Record<string, unknown>),
      max_new_tokens,
      do_sample: false,
      streamer,
    } as Record<string, unknown>);
    // Yield all collected tokens as a single delta chunk.
    // Token-level streaming requires the caller to hold an async queue;
    // emitting one buffered chunk here matches the v1.1 contract while
    // still exercising the TextStreamer code path (warmup for true streaming).
    yield { choices: [{ delta: { content: tokens.join('') } }] };
  } else {
    const generated = await mdl.generate({
      ...(inputs as Record<string, unknown>),
      max_new_tokens,
      do_sample: false,
    });
    const decoded = await decodeGeneration(proc, generated);
    yield { choices: [{ message: { content: decoded } }] };
  }
}

/**
 * Decode the generation output. transformers.js returns a tensor or array
 * shaped { sequences: number[][] } that the tokenizer batch_decode call
 * resolves to text. We extract the assistant turn between the last
 * generation marker and end-of-text.
 */
async function decodeGeneration(
  proc: ProcessorLike,
  generated: unknown,
): Promise<string> {
  const tok = proc.tokenizer as { batch_decode?: (ids: unknown, opts?: Record<string, unknown>) => string[] };
  if (typeof tok.batch_decode !== 'function') {
    return '';
  }
  const ids = (generated as { sequences?: unknown }).sequences ?? generated;
  const decoded = tok.batch_decode(ids, { skip_special_tokens: true });
  const full = Array.isArray(decoded) ? decoded[0] ?? '' : String(decoded ?? '');
  // Heuristic: the chat template typically emits "<start_of_turn>model\n…<end_of_turn>"
  // — keep only what comes after the last "model\n" marker.
  const lastMarker = full.lastIndexOf('model\n');
  const tail = lastMarker >= 0 ? full.slice(lastMarker + 'model\n'.length) : full;
  return tail.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Llama 3.2 1B — transformers.js / ONNX (issue #716)
//
// Replaces the WebLLM/MLC path for Llama text tasks (translation, field notes,
// offline chat). Shares the transformers-cache bucket with Gemma.
// ─────────────────────────────────────────────────────────────────────────────

export const LLAMA_ONNX_MODEL_ID = 'onnx-community/Llama-3.2-1B-Instruct';

interface TokenizerLike {
  apply_chat_template: (
    messages: Array<{ role: string; content: string }>,
    opts: Record<string, unknown>,
  ) => Promise<unknown>;
  decode: (ids: unknown, opts?: Record<string, unknown>) => string;
  batch_decode?: (ids: unknown, opts?: Record<string, unknown>) => string[];
  [key: string]: unknown;
}

interface TextModelLike {
  generate: (args: Record<string, unknown>) => Promise<unknown>;
  dispose?: () => Promise<void>;
}

let llamaTokenizer: TokenizerLike | null = null;
let llamaModel: TextModelLike | null = null;

/**
 * Load Llama 3.2 1B via transformers.js/ONNX. ~880 MB; cached after first
 * load in the shared `transformers-cache` bucket. Progress fires during the
 * initial download.
 */
export async function loadLlamaOnnxEngine(
  onProgress: (p: LoadProgress) => void,
): Promise<{ tokenizer: TokenizerLike; model: TextModelLike }> {
  if (llamaTokenizer && llamaModel) return { tokenizer: llamaTokenizer, model: llamaModel };
  await requestPersistentStorage().catch(() => {});

  const start = performance.now();
  const tx = await import('@huggingface/transformers');
  const { AutoTokenizer, AutoModelForCausalLM } = tx as unknown as {
    AutoTokenizer: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<TokenizerLike> };
    AutoModelForCausalLM: { from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<TextModelLike> };
  };

  const progressBridge = (p: { status?: string; progress?: number; file?: string }) => {
    const ratio = typeof p.progress === 'number'
      ? (p.progress > 1 ? p.progress / 100 : p.progress)
      : 0;
    onProgress({
      progress: Math.max(0, Math.min(1, ratio)),
      text: p.file ? `${p.status ?? 'loading'} ${p.file}` : (p.status ?? 'loading'),
      timeElapsedMs: performance.now() - start,
    });
  };

  llamaTokenizer = await AutoTokenizer.from_pretrained(LLAMA_ONNX_MODEL_ID, {
    progress_callback: progressBridge,
  });
  llamaModel = await AutoModelForCausalLM.from_pretrained(LLAMA_ONNX_MODEL_ID, {
    dtype: 'q4',
    device: 'wasm',           // CPU/WASM — Llama 1B is light enough; avoids
                               // spinning up a second WebGPU context alongside Gemma.
    progress_callback: progressBridge,
  });
  return { tokenizer: llamaTokenizer, model: llamaModel };
}

export async function unloadLlama(): Promise<void> {
  if (llamaModel?.dispose) {
    try { await llamaModel.dispose(); } catch { /* ignore */ }
  }
  llamaTokenizer = null;
  llamaModel = null;
}

export async function clearLlamaCache(): Promise<{ deleted: number }> {
  await unloadLlama();
  if (typeof caches === 'undefined') return { deleted: 0 };
  const c = await caches.open(TRANSFORMERS_CACHE_NAME).catch(() => null);
  if (!c) return { deleted: 0 };
  const keys = await c.keys();
  let deleted = 0;
  for (const req of keys) {
    if (req.url.includes(LLAMA_ONNX_MODEL_ID)) {
      const ok = await c.delete(req);
      if (ok) deleted++;
    }
  }
  return { deleted };
}

/**
 * Generate text using Llama 3.2 1B (ONNX/WASM). Yields OpenAI-shaped chunks
 * so callers (translateNote, generateFieldNote, ChatView) stay runtime-agnostic.
 *
 * Streaming in transformers.js requires a TextStreamer callback; v1 emits one
 * chunk after generation completes. True token-by-token streaming is a follow-up.
 */
export async function* generateLlamaText(
  messages: Array<{ role: string; content: string }>,
  opts: { max_tokens?: number } = {},
): AsyncIterable<{ choices: Array<{ delta?: { content?: string }; message?: { content: string } }> }> {
  const { tokenizer: tok, model: mdl } = await loadLlamaOnnxEngine(() => {});

  // Apply the Llama-3 chat template.
  const inputIds = await tok.apply_chat_template(messages, {
    tokenize: true,
    add_generation_prompt: true,
    return_tensors: 'pt',
  });

  const max_new_tokens = Math.min(opts.max_tokens ?? 512, 1024);

  const { TextStreamer } = await import('@huggingface/transformers') as unknown as {
    TextStreamer: new (
      tokenizer: unknown,
      opts: {
        skip_prompt: boolean;
        skip_special_tokens: boolean;
        callback_function: (token: string) => void;
      },
    ) => unknown;
  };

  const tokens: string[] = [];
  const streamer = new TextStreamer(tok, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token: string) => { tokens.push(token); },
  });

  await mdl.generate({
    input_ids: inputIds,
    max_new_tokens,
    do_sample: false,
    streamer,
  } as Record<string, unknown>);

  yield { choices: [{ delta: { content: tokens.join('') } }] };
}

/**
 * Check whether the Llama ONNX cache has weights downloaded.
 */
export async function getLlamaOnnxCacheStatus(): Promise<ModelCacheStatus> {
  if (typeof caches === 'undefined') {
    return { modelId: LLAMA_ONNX_MODEL_ID, cached: false, approxBytes: 0, entries: 0 };
  }
  const c = await caches.open(TRANSFORMERS_CACHE_NAME).catch(() => null);
  if (!c) return { modelId: LLAMA_ONNX_MODEL_ID, cached: false, approxBytes: 0, entries: 0 };
  const keys = await c.keys();
  let entries = 0;
  let approxBytes = 0;
  for (const req of keys) {
    if (req.url.includes(LLAMA_ONNX_MODEL_ID)) {
      entries++;
      try {
        const res = await c.match(req);
        const len = res?.headers.get('content-length');
        if (len) approxBytes += parseInt(len, 10);
      } catch { /* ignore */ }
    }
  }
  return { modelId: LLAMA_ONNX_MODEL_ID, cached: entries > 0, approxBytes, entries };
}
