/**
 * On-device vision via transformers.js + ONNX (Gemma 4 E2B).
 *
 * Parallel runtime to `local-ai.ts` (which uses MLC/WebLLM for Phi-3.5-vision).
 * Both ride the same opt-in pattern in Profile → Edit and surface as
 * separate registered identifiers — when one crashes on a given hardware
 * combo, the other can still work because they take completely different
 * WebGPU code paths (MLC's TVM-compiled kernels vs. transformers.js's ORT
 * kernels). The intent is resilience, not replacement.
 *
 * License note: Gemma 4 ships under Apache 2.0 (no field-of-use
 * restrictions), which is more permissive than Phi-3.5's MIT for some
 * downstream redistribution scenarios.
 *
 * Model: ~500 MB on disk (q4f16), ~1.3–1.5 GB VRAM at inference.
 */

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
  const generated = await mdl.generate({
    ...(inputs as Record<string, unknown>),
    max_new_tokens,
    do_sample: false,
  });
  const decoded = await decodeGeneration(proc, generated);

  if (opts.stream) {
    yield { choices: [{ delta: { content: decoded } }] };
  } else {
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
