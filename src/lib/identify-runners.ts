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

export async function resolvePlantNetKey(): Promise<string> {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __RASTRUM_PLANTNET_KEY__?: string };
    if (w.__RASTRUM_PLANTNET_KEY__) return w.__RASTRUM_PLANTNET_KEY__;
  }
  const env = (import.meta.env.PUBLIC_PLANTNET_KEY as string | undefined) ?? '';
  if (env) return env;
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
    const key = await resolvePlantNetKey();
    if (!key) throw new Error('No PlantNet key');
    const form = new FormData();
    form.append('images', file);
    form.append('organs', 'auto');
    const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=${locale}&nb-results=5`;
    const res = await fetch(url, { method: 'POST', body: form, signal });
    if (res.status === 403 || res.status === 404) return null;  // not a plant
    if (!res.ok) throw new Error(`PlantNet HTTP ${res.status}`);
    const data = await res.json() as { results?: PlantNetMatch[] };
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const top = results[0];
    const sci = top.species?.scientificNameWithoutAuthor ?? top.species?.scientificName ?? '';
    if (!sci) return null;
    const out: UnifiedIdResult = {
      source: 'plantnet',
      scientific_name: sci,
      common_name: top.species?.commonNames?.[0] ?? null,
      confidence: top.score ?? 0,
      alternates: results.slice(1, 5).map((r) => ({
        scientific_name: r.species?.scientificNameWithoutAuthor ?? r.species?.scientificName ?? '',
        common_name: r.species?.commonNames?.[0] ?? null,
        score: r.score ?? 0,
      })),
      raw: data,
    };
    return out;
  };
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
    const { loadVisionEngine, VISION_MODEL_ID, getModelCacheStatus } = await import('./local-ai');
    const status = await getModelCacheStatus(VISION_MODEL_ID);
    if (!status.cached) throw new Error('phi-vision not cached');
    if (signal.aborted) throw new Error('aborted');
    const engine = await loadVisionEngine((p) => {
      onProgress?.(p.text, p.progress);
    });
    if (signal.aborted) throw new Error('aborted');
    const dataUrl = await fileToDataUrl(file);
    const prompt = buildClaudePrompt(locale);  // reuse JSON-locked prompt
    const reply = await engine.chat.completions.create({
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 400,
    });
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
