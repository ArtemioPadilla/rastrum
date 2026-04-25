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
export async function identifyImageLocal(
  imageDataUrl: string,
  onProgress: (p: LoadProgress) => void,
  context?: { lat?: number; lng?: number; habitat?: string },
): Promise<LocalIDResult> {
  const engine = await loadVisionEngine(onProgress);

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
        { type: 'image_url', image_url: { url: imageDataUrl } },
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
