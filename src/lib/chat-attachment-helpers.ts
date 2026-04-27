/**
 * Pure helpers for the chat attachment flow (photo / audio).
 *
 * Kept side-effect free so they can be unit-tested without a browser:
 *   - `buildCascadeInterpretationPrompt(...)` — produces the prompt sent to
 *     Llama-3.2-1B after the identifier cascade returns a structured result.
 *   - `buildVisionFallbackPrompt(...)` — for the Claude Haiku vision-LLM
 *     fallback when the cascade fails.
 *   - `buildPendingObservation(...)` / `parsePendingObservation(...)` — the
 *     payload contract between the chat page and the observe form, stored
 *     in sessionStorage under `PENDING_OBSERVATION_KEY`.
 */
import type { Locale } from './local-ai-helpers';

export const PENDING_OBSERVATION_KEY = 'rastrum.pendingObservation';

export type AttachmentKind = 'photo' | 'audio';

/**
 * One identifier candidate as it appears in `cascadeResult.attempts` after
 * the cascade has run. We only keep the fields we actually need for the
 * interpretation prompt.
 */
export interface CascadeCandidate {
  scientific_name: string;
  common_name_en?: string | null;
  common_name_es?: string | null;
  family?: string | null;
  kingdom?: string | null;
  confidence: number;
  source: string;
}

export interface BuildPromptOptions {
  /** What the user uploaded — 'photo' or 'audio recording' phrasing. */
  kind: AttachmentKind;
  /** What the user typed alongside the attachment. May be empty. */
  userText: string;
  /** Locale for the natural-language reply. */
  locale: Locale;
  /** Top match returned by the cascade. */
  best: CascadeCandidate;
  /** Optional next 2-4 candidates for "other top matches". */
  alternates?: CascadeCandidate[];
}

/** Builds the Llama prompt that turns a structured cascade result into prose. */
export function buildCascadeInterpretationPrompt(opts: BuildPromptOptions): string {
  const kindLabel = opts.kind === 'photo' ? 'photo' : 'audio recording';
  const language = opts.locale === 'es' ? 'Spanish' : 'English';
  const userText = opts.userText.trim() || (opts.locale === 'es' ? '¿qué es esto?' : 'what is this?');
  const pct = Math.round((opts.best.confidence ?? 0) * 100);
  const common = pickCommonName(opts.best, opts.locale);
  const altLines = (opts.alternates ?? [])
    .filter(a => a.scientific_name && a.scientific_name !== opts.best.scientific_name)
    .slice(0, 4)
    .map(a => `${a.scientific_name} (${Math.round((a.confidence ?? 0) * 100)}%)`)
    .join(', ');

  const lines: string[] = [];
  lines.push(`The user uploaded a ${kindLabel} and asked: "${userText}"`);
  lines.push('Identification cascade returned:');
  lines.push(`  Top species: ${opts.best.scientific_name || '(unknown)'} (${pct}%, source: ${opts.best.source})`);
  if (common) lines.push(`  Common name: ${common}`);
  const taxLine = [opts.best.family, opts.best.kingdom].filter(Boolean).join(', ');
  if (taxLine) lines.push(`  Taxonomy: ${taxLine}`);
  if (altLines) lines.push(`  Other top matches: ${altLines}`);
  lines.push('');
  lines.push(`In ${language}, write a brief 2-4 sentence reply that:`);
  lines.push('  - Confirms the identification in plain language');
  lines.push('  - Adds one interesting natural-history fact about the species (only if confident)');
  lines.push('  - Suggests a follow-up question or action');
  lines.push('Do not invent details. If confidence is below 40%, say so explicitly.');
  return lines.join('\n');
}

export interface VisionFallbackOpts {
  userText: string;
  locale: Locale;
}

/** Prompt for the Phi-3.5-vision / Claude vision fallback. */
export function buildVisionFallbackPrompt(opts: VisionFallbackOpts): string {
  const language = opts.locale === 'es' ? 'Spanish' : 'English';
  const userText = opts.userText.trim() || (opts.locale === 'es' ? '¿qué es esto?' : 'what is this?');
  return [
    'Look at this photo.',
    `The user asked: "${userText}".`,
    `Reply in ${language}, 2-4 sentences.`,
    'If you can identify the species or describe what is happening, do so.',
    'If not, say what you can see and what you cannot.',
  ].join(' ');
}

function pickCommonName(c: CascadeCandidate, locale: Locale): string | null {
  const es = c.common_name_es ?? null;
  const en = c.common_name_en ?? null;
  if (locale === 'es') return es ?? en ?? null;
  return en ?? es ?? null;
}

// ───────────────────────── Observe-page handoff ─────────────────────────

/** Payload stored in sessionStorage under `PENDING_OBSERVATION_KEY`. */
export interface PendingObservation {
  /** Object URL or data URL the observe form fetches into a Blob. */
  blob_url: string;
  /** MIME type of the attachment (e.g. 'image/jpeg', 'audio/webm'). */
  mime_type: string;
  /** Best identification from the cascade. May be empty if cascade failed. */
  scientific_name: string;
  confidence: number;
  source: string;
  common_name: string | null;
  kind: AttachmentKind;
}

export function buildPendingObservation(p: PendingObservation): string {
  return JSON.stringify(p);
}

export function parsePendingObservation(raw: string | null | undefined): PendingObservation | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingObservation>;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.blob_url !== 'string' || v.blob_url.trim() === '') return null;
    if (v.kind !== 'photo' && v.kind !== 'audio') return null;
    return {
      blob_url: v.blob_url,
      mime_type: typeof v.mime_type === 'string' ? v.mime_type : 'application/octet-stream',
      scientific_name: typeof v.scientific_name === 'string' ? v.scientific_name : '',
      confidence: typeof v.confidence === 'number' ? v.confidence : 0,
      source: typeof v.source === 'string' ? v.source : 'human',
      common_name: typeof v.common_name === 'string' ? v.common_name : null,
      kind: v.kind,
    };
  } catch {
    return null;
  }
}

/**
 * Map a cascade plugin id to the `Observation['identification']['source']`
 * union accepted by the observe form / database (`IDSource` in types.ts).
 * Falls back to 'human' so unknown plugins still satisfy the type contract.
 *
 * Plugins that don't have a dedicated IDSource value (BirdNET-Lite,
 * Phi-3.5-vision, ONNX-base) collapse to the closest equivalent. The chat
 * page handoff uses this only as a default — the user can still edit the
 * field on the observe form before saving.
 */
export function pluginIdToObservationSource(pluginId: string):
  | 'plantnet' | 'claude_haiku' | 'claude_sonnet' | 'onnx_offline' | 'human' {
  switch (pluginId) {
    case 'plantnet':
      return 'plantnet';
    case 'claude_haiku':
      return 'claude_haiku';
    case 'claude_sonnet':
      return 'claude_sonnet';
    case 'webllm_phi35_vision':
    case 'onnx_efficientnet_lite0':
    case 'birdnet_lite':
      return 'onnx_offline';
    default:
      return 'human';
  }
}
