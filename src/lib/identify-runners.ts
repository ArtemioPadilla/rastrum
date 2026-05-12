/**
 * Concrete identifier runners used by the parallel cascade on /identify.
 *
 * Each runner takes a File + AbortSignal and returns a normalised
 * UnifiedIdResult or null. Errors are thrown so the cascade collects
 * them in `errors[]`.
 *
 * The runners are deliberately simple wrappers — no orchestration here,
 * that lives in identify-cascade-client.ts.
 */
import type { IdentifierRunner, UnifiedIdResult } from './identify-cascade-client';
import { parseVisionJson } from './identify-cascade-client';
import { resolveAnthropicKey } from './anthropic-key';

export type Locale = 'en' | 'es';

// ─────────────── PlantNet ───────────────

/**
 * Returns the user's BYO PlantNet key, or '' if none is configured.
 *
 * NOTE: The operator PlantNet key is server-side only (Edge Function env var
 * PLANTNET_API_KEY). It was previously also injected into the browser via
 * window.__RASTRUM_PLANTNET_KEY__ and PUBLIC_PLANTNET_KEY — those paths have
 * been removed (PR #1037 / fix/plantnet-key-cleanup) because they leaked the
 * key into browser network traffic and the JS bundle.
 *
 * PlantNet identification always works via the Edge Function regardless of
 * whether this function returns a key. A non-empty return value here only
 * means the *user* has supplied their own BYO key.
 */
export async function resolvePlantNetKey(): Promise<string> {
  try {
    const { getKey } = await import('./byo-keys');
    return getKey('plantnet', 'plantnet') ?? '';
  } catch {
    return '';
  }
}

interface PlantNetSpecies {
  scientificNameWithoutAuthor?: string;
  scientificName?: string;
  commonNames?: string[];
}

interface PlantNetMatch {
  score?: number;
  species?: PlantNetSpecies;
}

export function makePlantNetRunner(locale: Locale): IdentifierRunner {
  return async (file, signal) => {
    // ⚠️  Never call PlantNet directly from the browser — the API key would be
    // visible in the network panel and in the built JS bundle. Route through
    // the `identify` Edge Function which holds the key server-side.
    // The EF already supports force_provider:'plantnet' and accepts an
    // image_url OR a base64 data-URL via the `image_data` field.
    //
    // Additionally, PlantNet v2 only accepts JPEG/PNG. Convert the file
    // to a JPEG data-URL so HEIC / WebP / AVIF photos don't get a 400.
    const { getSupabase } = await import('./supabase');
    const { getKey } = await import('./byo-keys');

    // Encode file as JPEG via canvas (handles HEIC/WebP/AVIF → JPEG)
    let imageDataUrl: string;
    try {
      imageDataUrl = await fileToJpegDataUrl(file);
    } catch {
      // Canvas not available (e.g. test env) — fall back to raw base64
      imageDataUrl = await fileToDataUrl(file);
    }

    const supabase = getSupabase();
    const userKey = getKey('plantnet', 'plantnet') ?? undefined;
    const { data, error } = await supabase.functions.invoke('identify', {
      body: {
        observation_id: 'cascade-only',
        image_data: imageDataUrl,   // EF re-fetches or decodes this server-side
        force_provider: 'plantnet',
        lang: locale,
        client_keys: userKey ? { plantnet: userKey } : undefined,
      },
      ...(signal ? { signal } : {}),
    });
    if (error) throw error;
    const r = data as Partial<UnifiedIdResult> & { error?: string; results?: PlantNetMatch[] };
    if (r.error) throw new Error(r.error);
    // EF may return a normalised IDResult or raw PlantNet results
    if (r.scientific_name) {
      return {
        source: 'plantnet',
        scientific_name: r.scientific_name,
        common_name: r.common_name ?? null,
        confidence: r.confidence ?? 0,
        alternates: r.alternates ?? [],
        raw: r.raw,
      } satisfies UnifiedIdResult;
    }
    // Fallback: parse raw PlantNet results if EF forwarded them
    const results = r.results ?? [];
    if (results.length === 0) return null;
    const top = results[0];
    const sci = top.species?.scientificNameWithoutAuthor ?? top.species?.scientificName ?? '';
    if (!sci) return null;
    return {
      source: 'plantnet',
      scientific_name: sci,
      common_name: top.species?.commonNames?.[0] ?? null,
      confidence: top.score ?? 0,
      alternates: results.slice(1, 5).map((r) => ({
        scientific_name: r.species?.scientificNameWithoutAuthor ?? r.species?.scientificName ?? '',
        common_name: r.species?.commonNames?.[0] ?? null,
        score: r.score ?? 0,
      })),
      raw: r,
    } satisfies UnifiedIdResult;
  };
}

/** Convert any image File to a JPEG data-URL via an off-screen canvas. */
async function fileToJpegDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      // Cap at 1600px on the long edge — PlantNet works well at this res
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no 2d context')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('img load failed')); };
    img.src = objectUrl;
  });
}

// ─────────────── Claude Haiku (vision) ───────────────

function buildClaudePrompt(locale: Locale): string {
  return locale === 'es'
    ? 'Identifica la especie en esta foto y responde ÚNICAMENTE con JSON válido (sin texto antes ni después, sin bloques de código). Formato exacto:\n{"top":"Nombre científico","common":"Nombre común en español","confidence":0.85,"alternates":[{"sci":"...","common":"...","score":0.10}],"note":"Una frase con un dato interesante o detalle específico"}\nSi no estás seguro, baja la confianza pero responde. Si genuinamente no puedes identificar, devuelve {"top":null,"note":"explicación breve"}.'
    : 'Identify the species in this photo and reply ONLY with valid JSON (no preamble, no code fences). Exact format:\n{"top":"Scientific name","common":"Common name in English","confidence":0.85,"alternates":[{"sci":"...","common":"...","score":0.10}],"note":"One short sentence with an interesting detail"}\nIf unsure lower the confidence but answer. If you genuinely cannot identify, return {"top":null,"note":"brief explanation"}.';
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

export function makeClaudeRunner(locale: Locale): IdentifierRunner {
  return async (file, signal) => {
    const { key } = await resolveAnthropicKey();
    if (!key) throw new Error('No Anthropic key');
    const dataUrl = await fileToDataUrl(file);
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m) throw new Error('decode failed');
    const [, mediaType, base64] = m;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: buildClaudePrompt(locale) },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
    const data = await res.json() as AnthropicResponse;
    const piece = data.content?.find(p => p.type === 'text');
    const raw = piece?.text?.trim() ?? '';
    const parsed = parseVisionJson(raw);
    if (!parsed) {
      return {
        source: 'claude_haiku',
        scientific_name: '',
        common_name: null,
        confidence: 0,
        alternates: [],
        note: raw || null,
        raw: data,
      } as UnifiedIdResult;
    }
    return {
      source: 'claude_haiku',
      scientific_name: parsed.scientific_name,
      common_name: parsed.common_name,
      confidence: parsed.confidence,
      alternates: parsed.alternates,
      note: parsed.note ?? undefined,
      raw: data,
    };
  };
}

// ─────────────── Phi-3.5-vision (on-device) ───────────────

export function makePhiRunner(
  locale: Locale,
  onProgress?: (text: string, fraction: number) => void,
): IdentifierRunner {
  return async (file, signal) => {
    // Mark this device session as Phi-broken if a previous run crashed —
    // certain GPU/driver combos hit WebGPU validation errors
    // ("Binding size isn't a multiple of 4") that brick the device for
    // subsequent calls. Skip Phi for the rest of the session.
    if (typeof window !== 'undefined' && (window as { __rastrumPhiBroken?: boolean }).__rastrumPhiBroken) {
      throw new Error('phi-vision disabled this session (prior WebGPU error)');
    }
    const { loadVisionEngine, VISION_MODEL_ID, getModelCacheStatus, prepareImageForPhi } = await import('./local-ai');
    const status = await getModelCacheStatus(VISION_MODEL_ID);
    if (!status.cached) throw new Error('phi-vision not cached');
    if (signal.aborted) throw new Error('aborted');
    const engine = await loadVisionEngine((p) => {
      onProgress?.(p.text, p.progress);
    });
    if (signal.aborted) throw new Error('aborted');
    // Phi-3.5-vision MLC has a fixed image-embed shape (1921 tokens =
    // single 336×336 crop). Non-square inputs crash with
    // `expect embed.shape[0] to be 1921, but got <N>`.
    const rawDataUrl = await fileToDataUrl(file);
    const dataUrl = await prepareImageForPhi(rawDataUrl, 336);
    const prompt = buildClaudePrompt(locale);  // reuse JSON-locked prompt

    let reply;
    try {
      reply = await engine.chat.completions.create({
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        }],
        max_tokens: 400,
      });
    } catch (err) {
      // WebGPU / MLC runtime errors brick the GPUDevice for the rest of
      // the session. Mark Phi as broken so subsequent cascade runs skip
      // it instead of repeatedly crashing.
      const msg = err instanceof Error ? err.message : String(err);
      if (/WebGPU|GPUValidation|BindGroup|Binding size|CommandBuffer/i.test(msg)) {
        if (typeof window !== 'undefined') {
          (window as { __rastrumPhiBroken?: boolean }).__rastrumPhiBroken = true;
        }
      }
      throw err;
    }
    const raw = reply.choices?.[0]?.message?.content ?? '';
    const text = typeof raw === 'string' ? raw : '';
    const parsed = parseVisionJson(text);
    if (!parsed) {
      return {
        source: 'webllm_phi35_vision',
        scientific_name: '',
        common_name: null,
        confidence: 0,
        alternates: [],
        note: text || null,
        raw,
      } as UnifiedIdResult;
    }
    // Hard-cap Phi confidence at 0.4 — same as the database trigger.
    const capped = Math.min(parsed.confidence, 0.4);
    return {
      source: 'webllm_phi35_vision',
      scientific_name: parsed.scientific_name,
      common_name: parsed.common_name,
      confidence: capped,
      alternates: parsed.alternates,
      note: parsed.note ?? undefined,
      raw,
    };
  };
}

// ─────────────── Gemma 4 vision (on-device, transformers.js + ONNX) ───────────────

export function makeGemmaRunner(
  locale: Locale,
  onProgress?: (text: string, fraction: number) => void,
): IdentifierRunner {
  return async (file, signal) => {
    if (typeof window !== 'undefined' && (window as { __rastrumGemmaBroken?: boolean }).__rastrumGemmaBroken) {
      throw new Error('gemma-vision disabled this session (prior WebGPU error)');
    }
    const { loadGemmaVisionEngine, getGemmaCacheStatus } = await import('./onnx-vision');
    const status = await getGemmaCacheStatus();
    if (!status.cached) throw new Error('gemma-vision not cached');
    if (signal.aborted) throw new Error('aborted');

    const tx = await import('@huggingface/transformers');
    const load_image = (tx as unknown as { load_image: (src: string) => Promise<unknown> }).load_image;

    const { processor: proc, model: mdl } = await loadGemmaVisionEngine((p) => {
      onProgress?.(p.text, p.progress);
    });
    if (signal.aborted) throw new Error('aborted');

    const dataUrl = await fileToDataUrl(file);
    const promptText = buildClaudePrompt(locale);

    const messages = [{
      role: 'user',
      content: [
        { type: 'image' },
        { type: 'text', text: promptText },
      ],
    }];

    let raw: string;
    try {
      const procFn = proc as unknown as ((p: string, i: unknown, opts?: Record<string, unknown>) => Promise<unknown>) & {
        apply_chat_template: (messages: unknown, opts: Record<string, unknown>) => string;
        tokenizer: { batch_decode?: (ids: unknown, opts?: Record<string, unknown>) => string[] };
      };
      const chatPrompt = procFn.apply_chat_template(messages, {
        enable_thinking: false,
        add_generation_prompt: true,
      });
      const image = await load_image(dataUrl);
      const inputs = await procFn(chatPrompt, image, { add_special_tokens: false });
      const generated = await mdl.generate({
        ...(inputs as Record<string, unknown>),
        max_new_tokens: 400,
        do_sample: false,
      });
      const ids = (generated as { sequences?: unknown }).sequences ?? generated;
      const decoded = procFn.tokenizer.batch_decode?.(ids, { skip_special_tokens: true }) ?? [''];
      const full = Array.isArray(decoded) ? decoded[0] ?? '' : String(decoded ?? '');
      const lastMarker = full.lastIndexOf('model\n');
      raw = (lastMarker >= 0 ? full.slice(lastMarker + 'model\n'.length) : full).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/WebGPU|GPUValidation|BindGroup|Binding size|CommandBuffer|JSEP|ORT/i.test(msg)) {
        if (typeof window !== 'undefined') {
          (window as { __rastrumGemmaBroken?: boolean }).__rastrumGemmaBroken = true;
        }
      }
      throw err;
    }

    const parsed = parseVisionJson(raw);
    if (!parsed) {
      return {
        source: 'onnx_gemma4_vision',
        scientific_name: '',
        common_name: null,
        confidence: 0,
        alternates: [],
        note: raw || null,
        raw,
      } as UnifiedIdResult;
    }
    const capped = Math.min(parsed.confidence, 0.4);
    return {
      source: 'onnx_gemma4_vision',
      scientific_name: parsed.scientific_name,
      common_name: parsed.common_name,
      confidence: capped,
      alternates: parsed.alternates,
      note: parsed.note ?? undefined,
      raw,
    };
  };
}
