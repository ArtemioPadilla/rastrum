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
 * Returns true when WebLLM can probably run on this device.
 * Hard requirement: WebGPU. Soft requirement: ≥4 GB RAM (we can't reliably
 * detect free VRAM, so we rely on the user to opt in informedly).
 */
export function localAISupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'gpu' in navigator && typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
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
  // Lock OPFS storage against eviction before downloading multi-GB weights
  await requestPersistentStorage().catch(() => {});
  const create = await ensureCreator();
  visionEngine = await create(VISION_MODEL_ID, {
    initProgressCallback: (p) => onProgress({
      progress: p.progress ?? 0,
      text: p.text ?? '',
      timeElapsedMs: (p.timeElapsed ?? 0) * 1000,
    }),
  });
  return visionEngine;
}

/** Load the Llama-3.2-1B text model. ~880 MB; cached after first load. */
export async function loadTextEngine(onProgress: (p: LoadProgress) => void): Promise<MLCEngineInterface> {
  if (textEngine) return textEngine;
  if (!localAISupported()) throw new Error('WebGPU not available — local AI unavailable on this browser.');
  await requestPersistentStorage().catch(() => {});
  const create = await ensureCreator();
  textEngine = await create(TEXT_MODEL_ID, {
    initProgressCallback: (p) => onProgress({
      progress: p.progress ?? 0,
      text: p.text ?? '',
      timeElapsedMs: (p.timeElapsed ?? 0) * 1000,
    }),
  });
  return textEngine;
}

/** Free the GPU memory used by both models. */
export async function unloadAll(): Promise<void> {
  await Promise.allSettled([
    visionEngine?.unload(),
    textEngine?.unload(),
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
      // We don't know how many entries were inside — just report the buckets
      deleted = -1;
    }
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
