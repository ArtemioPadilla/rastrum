/**
 * On-device AI via WebLLM (MLC).
 *
 * Inspired by the WebLLM patterns in
 *   https://github.com/ArtemioPadilla/LexMX
 * adapted for Rastrum's biodiversity context.
 *
 * Two models are wired:
 *   - **Phi-3.5-vision-instruct** (q4f16_1, ~3.95 GB VRAM, ~3.5B params)
 *     The only multimodal option in WebLLM's prebuilt list today. Used as
 *     a *fallback* for image identification when neither a server-side nor
 *     client-side Anthropic key is available. See the disclaimer in
 *     identifyImageLocal() below — this is a general VLM, NOT a taxonomy
 *     specialist, so it WILL hallucinate species names. We mark every
 *     result `confidence ≤ 0.4` so the rest of the pipeline routes it as
 *     `needs_review` and never lets it count toward research-grade
 *     (the quality gate in supabase-schema.sql enforces that bound too).
 *
 *   - **Llama-3.2-1B-Instruct** (q4f16_1, ~880 MB VRAM, low-resource)
 *     Used for text-only helpers: ES↔EN translation of observation notes,
 *     local search over the user's own observation history, and field-note
 *     narrative generation from structured observation data. NOT used for
 *     identification.
 *
 * Models are loaded lazily on first use. WebLLM caches in OPFS, so the
 * second load is instant. We never auto-download — every model fetch is
 * triggered by an explicit user action (a button labelled with the size).
 *
 * See docs/specs/modules/11-in-browser-ai.md for the spec.
 */
import type { CreateMLCEngine as CreateMLCEngineFn, MLCEngineInterface } from '@mlc-ai/web-llm';

export const VISION_MODEL_ID = 'Phi-3.5-vision-instruct-q4f16_1-MLC';
export const TEXT_MODEL_ID   = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export type LoadProgress = {
  progress: number;             // 0..1
  text: string;                 // human-readable phase
  timeElapsedMs: number;
};

let visionEngine: MLCEngineInterface | null = null;
let textEngine: MLCEngineInterface | null = null;
let createEngine: typeof CreateMLCEngineFn | null = null;

/**
 * Per-modelId registry of AbortControllers for fetch-based downloads (BirdNET,
 * EfficientNet, MegaDetector, SpeciesNet). Used by cancelModelDownload().
 *
 * WebLLM models (Phi, Llama, Gemma) don't expose an AbortSignal through
 * CreateMLCEngine, so we track a cancelled flag per modelId instead. The next
 * progress callback checks the flag and the caller clears the partial cache.
 */
const downloadControllers = new Map<string, AbortController>();
const cancelledFlags = new Set<string>();

/**
 * Register an AbortController for a fetch-based model download.
 * Called by the cache loaders (birdnet-cache, onnx-base-cache, etc.)
 * after creating their AbortController so cancelModelDownload() can abort it.
 * Each call replaces any previous controller for the same modelId.
 */
export function registerDownloadController(modelId: string, controller: AbortController): void {
  downloadControllers.set(modelId, controller);
}

/**
 * Returns true if a WebLLM-style cancel was requested for this modelId.
 * Callers (loadVisionEngine / loadTextEngine) should check this in their
 * progress callback and abort loading. The flag is cleared automatically
 * by cancelModelDownload() after being read here, or by a fresh load start.
 */
export function isDownloadCancelled(modelId: string): boolean {
  return cancelledFlags.has(modelId);
}

/**
 * Cancel an in-flight model download and clear any partial cache.
 *
 * - For fetch-based models (BirdNET, EfficientNet, MegaDetector, SpeciesNet):
 *   aborts the registered AbortController so the fetch stream throws AbortError.
 * - For WebLLM models (Phi-3.5-vision, Llama-3.2-1B, Gemma via transformers.js):
 *   sets a cancelled flag checked by the progress callback; the load will fail on
 *   the next tick. This is a best-effort path — WebLLM's CreateMLCEngine does not
 *   expose an AbortSignal, so we cannot stop the in-flight GPU kernel compilation,
 *   only mark the session as cancelled so the UI transitions back to not-downloaded.
 *   Partial OPFS data is cleared via clearModelCache() regardless.
 */
export async function cancelModelDownload(modelId: string): Promise<void> {
  // Abort fetch-based downloads immediately.
  const controller = downloadControllers.get(modelId);
  if (controller) {
    controller.abort();
    downloadControllers.delete(modelId);
  }
  // Mark WebLLM-style loads as cancelled (checked by progress callbacks).
  cancelledFlags.add(modelId);
  // Always clear partial cache so the card returns to not-downloaded state.
  await clearModelCache(modelId);
  // The cancelled flag is left in the set; it's cleaned up by the next
  // loadVisionEngine / loadTextEngine call for this modelId (fresh start).
}

/**
 * Returns true when WebLLM can probably run on this device.
 * Hard requirement: WebGPU. Soft requirement: ≥6 GB device memory.
 * Mobile devices with ≤4 GB RAM will crash when loading the ~4 GB
 * Phi-3.5-vision model, so we gate on navigator.deviceMemory when
 * available (Chrome/Edge expose it; Safari/Firefox don't — for those
 * we fall through and rely on the download warning).
 */
export function localAISupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hasGpu = 'gpu' in navigator && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
  if (!hasGpu) return false;
  // navigator.deviceMemory is approximate (0.25, 0.5, 1, 2, 4, 8 GiB).
  // Phi-3.5-vision needs ~4 GB VRAM + overhead; reject devices reporting ≤4 GB.
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === 'number' && mem <= 4) return false;
  return true;
}

async function ensureCreator() {
  if (createEngine) return createEngine;
  const mod = await import('@mlc-ai/web-llm');
  createEngine = mod.CreateMLCEngine;
  return createEngine;
}

/** Load the Phi-3.5-vision model. ~4 GB; cached after first load. */
export async function loadVisionEngine(onProgress: (p: LoadProgress) => void): Promise<MLCEngineInterface> {
  if (visionEngine) return visionEngine;
  if (!localAISupported()) throw new Error('WebGPU not available — local AI unavailable on this browser.');
  // Clear any stale cancelled flag from a previous cancel on this modelId.
  cancelledFlags.delete(VISION_MODEL_ID);
  // Lock OPFS storage against eviction before downloading multi-GB weights
  await requestPersistentStorage().catch(() => {});
  const create = await ensureCreator();
  visionEngine = await create(VISION_MODEL_ID, {
    initProgressCallback: (p) => {
      if (cancelledFlags.has(VISION_MODEL_ID)) {
        throw new Error('Download cancelled');
      }
      onProgress({
        progress: p.progress ?? 0,
        text: p.text ?? '',
        timeElapsedMs: (p.timeElapsed ?? 0) * 1000,
      });
    },
  });
  return visionEngine;
}

export const GEMMA_TEXT_MODEL_ID = 'onnx_gemma4_text';

/**
 * Load Gemma 4 E2B for text-only chat. Reuses the transformers.js + ONNX
 * runtime path from onnx-vision.ts (same model weights). Cached after first
 * load like the WebLLM models. Returns a thin engine handle whose `generate`
 * method yields OpenAI-style chunks so chat-engine can consume Gemma and
 * Llama through the same iterator interface.
 */
export async function loadGemmaTextEngine(
  onProgress: (p: LoadProgress) => void,
): Promise<{
  generate: (
    messages: Array<{ role: string; content: string }>,
    opts?: { max_tokens?: number; stream?: boolean },
  ) => AsyncIterable<{ choices: Array<{ delta?: { content?: string }; message?: { content: string } }> }>;
}> {
  if (!localAISupported()) throw new Error('WebGPU not available — Gemma 4 unavailable on this browser.');
  cancelledFlags.delete(GEMMA_TEXT_MODEL_ID);
  await requestPersistentStorage().catch(() => {});

  const { loadGemmaVisionEngine, generateGemmaText } = await import('./onnx-vision');
  // Trigger weight load with cancellation-aware progress bridge.
  await loadGemmaVisionEngine((p) => {
    if (cancelledFlags.has(GEMMA_TEXT_MODEL_ID)) {
      throw new Error('Download cancelled');
    }
    onProgress(p);
  });

  return {
    generate: (messages, opts) => generateGemmaText(messages, opts ?? {}),
  };
}

/** Load the Llama-3.2-1B text model. ~880 MB; cached after first load. */
export async function loadTextEngine(onProgress: (p: LoadProgress) => void): Promise<MLCEngineInterface> {
  if (textEngine) return textEngine;
  if (!localAISupported()) throw new Error('WebGPU not available — local AI unavailable on this browser.');
  // Clear any stale cancelled flag from a previous cancel on this modelId.
  cancelledFlags.delete(TEXT_MODEL_ID);
  await requestPersistentStorage().catch(() => {});
  const create = await ensureCreator();
  textEngine = await create(TEXT_MODEL_ID, {
    initProgressCallback: (p) => {
      if (cancelledFlags.has(TEXT_MODEL_ID)) {
        throw new Error('Download cancelled');
      }
      onProgress({
        progress: p.progress ?? 0,
        text: p.text ?? '',
        timeElapsedMs: (p.timeElapsed ?? 0) * 1000,
      });
    },
  });
  return textEngine;
}

/**
 * Free the GPU memory used by both models — Phi/Llama via WebLLM and the
 * parallel Gemma 4 runtime via transformers.js. We dynamic-import the
 * onnx-vision module so Profile → Edit pages that haven't touched Gemma
 * don't drag the transformers.js bundle into their initial chunk.
 */
export async function unloadAll(): Promise<void> {
  const gemmaUnload = (async () => {
    try {
      const { unloadGemma } = await import('./onnx-vision');
      await unloadGemma();
    } catch {
      // transformers.js not loaded in this session — nothing to free.
    }
  })();
  await Promise.allSettled([
    visionEngine?.unload(),
    textEngine?.unload(),
    gemmaUnload,
  ]);
  visionEngine = null;
  textEngine = null;
}

// ───────────────────── Persistent storage + cache management ─────────────────────

/**
 * Ask the browser to mark our origin's storage as "persistent" so the OS
 * won't evict the multi-GB model under storage pressure. Without this,
 * iOS may delete OPFS data after 7 days of non-use.
 *
 * Calling this multiple times is harmless — `navigator.storage.persist()` is
 * idempotent and returns the current state.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

/** Total bytes used by all origin storage (rough estimate). */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0 };
  }
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}

/**
 * The cache names WebLLM uses for OPFS-backed model and wasm storage.
 * These string values are part of the `@mlc-ai/web-llm` runtime contract;
 * if WebLLM ever renames them, we'll see deletes silently no-op and need
 * to update.
 */
const WEBLLM_CACHE_NAMES = ['webllm/model', 'webllm/wasm', 'webllm/config'] as const;

export type ModelCacheStatus = {
  modelId: string;
  cached: boolean;
  approxBytes: number;        // 0 if not cached or browser doesn't expose Content-Length
  entries: number;
};

/**
 * Probe the Cache API to see if a given WebLLM model has weights cached
 * locally. Sums Content-Length where available — exact values aren't
 * always reliable since WebLLM streams shards, but the number is a useful
 * progress/diagnostic indicator.
 */
export async function getModelCacheStatus(modelId: string): Promise<ModelCacheStatus> {
  if (typeof caches === 'undefined') {
    return { modelId, cached: false, approxBytes: 0, entries: 0 };
  }
  let cached = false;
  let approxBytes = 0;
  let entries = 0;
  for (const name of WEBLLM_CACHE_NAMES) {
    const c = await caches.open(name).catch(() => null);
    if (!c) continue;
    const keys = await c.keys();
    for (const req of keys) {
      // WebLLM keys URLs by model id — match conservatively on substring
      if (req.url.includes(modelId)) {
        cached = true;
        entries++;
        try {
          const res = await c.match(req);
          const len = res?.headers.get('content-length');
          if (len) approxBytes += parseInt(len, 10);
        } catch { /* ignore */ }
      }
    }
  }
  return { modelId, cached, approxBytes, entries };
}

/**
 * Delete every cache entry whose URL contains the given model id. Frees
 * the OPFS-backed disk space. The model can be re-downloaded later by
 * calling loadVisionEngine/loadTextEngine again.
 *
 * Returns the number of entries deleted, summed across all WebLLM caches.
 */
export async function clearModelCache(modelId: string): Promise<{ deleted: number }> {
  if (typeof caches === 'undefined') return { deleted: 0 };
  // Clean up any lingering controller/flag state for this modelId.
  downloadControllers.delete(modelId);
  cancelledFlags.delete(modelId);
  // If the model is currently loaded into GPU memory, unload it first so
  // we don't hand back stale memory references after the disk wipe.
  if (modelId === VISION_MODEL_ID && visionEngine) {
    await visionEngine.unload();
    visionEngine = null;
  }
  if (modelId === TEXT_MODEL_ID && textEngine) {
    await textEngine.unload();
    textEngine = null;
  }

  let deleted = 0;
  for (const name of WEBLLM_CACHE_NAMES) {
    const c = await caches.open(name).catch(() => null);
    if (!c) continue;
    const keys = await c.keys();
    for (const req of keys) {
      if (req.url.includes(modelId)) {
        const ok = await c.delete(req);
        if (ok) deleted++;
      }
    }
  }
  return { deleted };
}

/**
 * Clear EVERY WebLLM cache — both models, all WASM, all config. Free
 * memory first. Use as the "remove all on-device AI data" nuclear option.
 */
export async function clearAllModelCaches(): Promise<{ deleted: number; cachesRemoved: number }> {
  await unloadAll();
  if (typeof caches === 'undefined') return { deleted: 0, cachesRemoved: 0 };
  let deleted = 0;
  let cachesRemoved = 0;
  for (const name of WEBLLM_CACHE_NAMES) {
    const removed = await caches.delete(name);
    if (removed) {
      cachesRemoved++;
      deleted = -1;
    }
  }
  // Gemma weights live in the standard transformers.js Cache API bucket
  // — separate from WebLLM's OPFS-backed names. Nuke that too so the
  // "Delete all on-device AI data" button actually deletes ALL.
  try {
    const { clearGemmaCache } = await import('./onnx-vision');
    const r = await clearGemmaCache();
    if (r.deleted > 0) {
      cachesRemoved++;
      deleted = -1;
    }
  } catch {
    // transformers.js not loaded — nothing to clear.
  }
  return { deleted, cachesRemoved };
}

// ───────────────────── Vision: image identification fallback ─────────────────────

export interface LocalIDResult {
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Unknown';
  family: string | null;
  confidence: number;            // capped at 0.4 — see disclaimer above
  notes: string;
  source: 'webllm_phi35_vision';
  warning: string;
}

/**
 * Identify a species from an image using on-device Phi-3.5-vision.
 *
 * **DISCLAIMER:** Phi-3.5-vision is a general-purpose VLM with NO
 * taxonomic training. It will confidently hallucinate species names,
 * especially for Neotropical taxa. We mark every result confidence ≤ 0.4
 * so the database trigger `enforce_research_grade_quality_trigger` blocks
 * it from ever reaching research-grade.
 *
 * Best-fit use cases:
 *   - Offline-only situations where SOME guess is better than nothing
 *   - Pre-filter: "is this even a plant/animal/fungus?" before paying for
 *     a Claude Vision call (cost optimisation)
 *
 * Wrong-fit use cases:
 *   - Authoritative ID for citizen science → use PlantNet + Claude
 *   - Sensitive species detection → use Claude only
 */

/**
 * Center-crop and resize a data URL image to a fixed square. The
 * MLC-compiled Phi-3.5-vision-q4f16_1 model has a hard-coded image-embed
 * sequence length (1921 tokens = single 336×336 crop). Non-square inputs
 * make the vision processor emit a different patch count and the model
 * crashes with `expect embed.shape[0] to be 1921, but got <N>`.
 * Pre-cropping here is the supported workaround.
 */
export async function prepareImageForPhi(dataUrl: string, size: number = 336): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        // Center-crop the source to its largest centred square, then scale.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth  - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

export async function identifyImageLocal(
  imageDataUrl: string,
  onProgress: (p: LoadProgress) => void,
  context?: { lat?: number; lng?: number; habitat?: string },
): Promise<LocalIDResult> {
  const engine = await loadVisionEngine(onProgress);

  // Phi-3.5-vision MLC-compiled q4f16_1 has a fixed image-embedding shape
  // (1921 tokens = single 336×336 crop). Non-square photos make the vision
  // processor emit extra tokens and the model throws
  // `expect embed.shape[0] to be 1921, but got <N>`. Center-crop to a
  // 336×336 square before passing.
  const normalised = await prepareImageForPhi(imageDataUrl, 336);

  const prompt = [
    'You see a photo from a biodiversity observation in Latin America.',
    'Identify the most likely species. If unsure, say so explicitly.',
    'Respond with JSON ONLY, matching exactly this shape:',
    '{"scientific_name":"","common_name_en":"","common_name_es":"","kingdom":"Plantae|Animalia|Fungi|Unknown","family":"","notes":""}',
    context?.lat && context?.lng ? `Location: ${context.lat}, ${context.lng}.` : '',
    context?.habitat ? `Habitat: ${context.habitat}.` : '',
  ].filter(Boolean).join('\n');

  const reply = await engine.chat.completions.create({
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: normalised } },
        { type: 'text', text: prompt },
      ],
    }],
    max_tokens: 256,
  });
  const raw = reply.choices?.[0]?.message?.content ?? '';
  const text = typeof raw === 'string' ? raw : '';
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  let parsed: Partial<LocalIDResult> = {};
  try { parsed = JSON.parse(cleaned); } catch { parsed = { scientific_name: '', notes: cleaned }; }

  return {
    scientific_name: parsed.scientific_name ?? '',
    common_name_en: parsed.common_name_en ?? null,
    common_name_es: parsed.common_name_es ?? null,
    kingdom: (parsed.kingdom as LocalIDResult['kingdom']) ?? 'Unknown',
    family: parsed.family ?? null,
    confidence: 0.35,                // hard cap, see disclaimer
    notes: parsed.notes ?? '',
    source: 'webllm_phi35_vision',
    warning: 'On-device general VLM result. Treat as a hint, not a verified ID. Quality-gated below 0.4 confidence.',
  };
}

// ───────────────────── Text helpers ─────────────────────

/**
 * Translate a short observation note between Spanish and English locally.
 * Useful for community contributors writing in one language but submitting
 * to a Darwin Core export that prefers the other.
 */
export async function translateNote(
  text: string,
  to: 'es' | 'en',
  onProgress: (p: LoadProgress) => void,
): Promise<string> {
  const engine = await loadTextEngine(onProgress);
  const target = to === 'es' ? 'Spanish' : 'English';
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: `You are a translator. Translate the user's biodiversity observation note into ${target}. Output the translation only, no preamble.` },
      { role: 'user', content: text },
    ],
    max_tokens: 200,
  });
  const raw = reply.choices?.[0]?.message?.content ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Generate a short field-note narrative from structured observation data.
 * Helps users with limited writing time turn coordinates + species into a
 * paragraph suitable for Darwin Core export.
 */
export async function generateFieldNote(
  data: { species: string; date: string; location: string; habitat?: string; weather?: string; notes?: string },
  lang: 'es' | 'en',
  onProgress: (p: LoadProgress) => void,
): Promise<string> {
  const engine = await loadTextEngine(onProgress);
  const targetLang = lang === 'es' ? 'Spanish' : 'English';
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: `You are a naturalist's writing assistant. Turn structured observation data into a short, professional field note in ${targetLang}, 2-3 sentences. Output the narrative only.` },
      { role: 'user', content: JSON.stringify(data) },
    ],
    max_tokens: 200,
  });
  const raw = reply.choices?.[0]?.message?.content ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

// ───────────────────── Generic chat (text-engine, streaming) ─────────────────────

export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatTurn { role: ChatRole; content: string; }

/**
 * Stream a chat completion using the loaded Llama-3.2-1B text engine.
 *
 * Calls `onToken(delta)` for each newly arrived chunk and resolves once the
 * model finishes. Returns the full assembled assistant message.
 *
 * Used by the in-browser chat page (`/en/chat`, `/es/chat`). Loading the
 * engine is the caller's responsibility — pass an already-loaded engine
 * from `loadTextEngine()` so the consent dialog stays in the UI layer.
 */
export async function streamChat(
  engine: MLCEngineInterface,
  messages: ChatTurn[],
  onToken: (delta: string, full: string) => void,
  opts?: { signal?: AbortSignal; maxTokens?: number },
): Promise<string> {
  const stream = await engine.chat.completions.create({
    messages,
    max_tokens: opts?.maxTokens ?? 512,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>) {
    if (opts?.signal?.aborted) break;
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (!delta) continue;
    full += delta;
    onToken(delta, full);
  }
  return full;
}
