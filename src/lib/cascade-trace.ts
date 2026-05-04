/**
 * Cascade trace serializer (#586).
 *
 * The client-persist path in sync.ts step 4.5 used to write a minimal
 * raw_response (just common names + a marker) — losing top-k alternates,
 * scores, plantnet candidates, claude rationale, etc. The server EF path
 * stored the full provider response. This asymmetry made forensics
 * impossible for client-persisted IDs and starved future re-rank passes.
 *
 * `serializeClientCascade` produces a bounded summary suitable for
 * `identifications.raw_response` (jsonb). Cap is 4 KB; we strip pixel-level
 * data, drop GPS, and truncate large strings.
 *
 * Companion to #584 (CascadeTrace UI component) — that issue defines
 * adapters that consume this same shape from the database row.
 */

export interface CascadeAttemptSummary {
  id: string;
  ok: boolean;
  confidence?: number;
  error?: string;
  duration_ms?: number;
}

export interface ClientCascadeTrace {
  client_persisted: true;
  cascade_attempts: CascadeAttemptSummary[];
  winner: {
    source: string;
    scientific_name: string;
    confidence: number;
    common_name_en: string | null;
    common_name_es: string | null;
    family: string | null;
    kingdom: string;
    raw_provider_response?: unknown;
  } | null;
}

const SIZE_CAP_BYTES = 4_096;
const STRING_TRUNCATE = 200;
const TOP_K_CAP = 5;
const PII_KEYS = new Set(['lat', 'lng', 'latitude', 'longitude', 'gps', 'location']);

function truncateStrings(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') {
    return value.length > STRING_TRUNCATE ? value.slice(0, STRING_TRUNCATE - 1) + '…' : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, TOP_K_CAP).map(v => truncateStrings(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k.toLowerCase())) continue;
      out[k] = truncateStrings(v, depth + 1);
    }
    return out;
  }
  return value;
}

interface RunCascadeAttemptLike {
  id: string;
  ok: boolean;
  confidence?: number;
  error?: string;
  duration_ms?: number;
  result?: {
    scientific_name: string;
    common_name_en: string | null;
    common_name_es: string | null;
    family: string | null;
    kingdom: string;
    confidence: number;
    source: string;
    raw?: unknown;
  };
}

interface RunCascadeResultLike {
  best: {
    scientific_name: string;
    common_name_en: string | null;
    common_name_es: string | null;
    family: string | null;
    kingdom: string;
    confidence: number;
    source: string;
    raw?: unknown;
  } | null;
  attempts: RunCascadeAttemptLike[];
}

export function serializeClientCascade(r: RunCascadeResultLike): ClientCascadeTrace {
  const attempts: CascadeAttemptSummary[] = r.attempts.map(a => ({
    id: a.id,
    ok: a.ok,
    confidence: a.confidence ?? a.result?.confidence,
    error: a.error,
    duration_ms: a.duration_ms,
  }));

  let winner: ClientCascadeTrace['winner'] = null;
  if (r.best) {
    const rawProvider = truncateStrings(r.best.raw ?? null);
    winner = {
      source: r.best.source,
      scientific_name: r.best.scientific_name,
      confidence: r.best.confidence,
      common_name_en: r.best.common_name_en,
      common_name_es: r.best.common_name_es,
      family: r.best.family,
      kingdom: r.best.kingdom,
      raw_provider_response: rawProvider,
    };
  }

  let trace: ClientCascadeTrace = {
    client_persisted: true,
    cascade_attempts: attempts,
    winner,
  };

  // If still over cap, drop raw_provider_response — keep cascade_attempts summary.
  if (JSON.stringify(trace).length > SIZE_CAP_BYTES && winner) {
    trace = {
      client_persisted: true,
      cascade_attempts: attempts,
      winner: { ...winner, raw_provider_response: undefined },
    };
  }

  return trace;
}

// ─────────────────────────────────────────────────────────────────────────────
// #584 — UI-facing types + adapters consumed by <CascadeTrace> Astro
// component. Three input shapes: live runCascade result (chat),
// EF response (server cascade), and identifications row (post-hoc replay).
// ─────────────────────────────────────────────────────────────────────────────

export type CascadeAttemptStateUI =
  | 'accepted' | 'rejected' | 'skipped' | 'failed' | 'aborted' | 'not_run';

export interface CascadeAttemptUI {
  id: string;
  display_name: string;
  brand?: string;
  runtime?: 'client' | 'server';
  state: CascadeAttemptStateUI;
  confidence?: number;
  threshold?: number;
  reason?: string;
  result?: { scientific_name: string; common_name?: string };
}

export interface CascadeTraceData {
  media: { kind: 'photo' | 'audio' | 'video'; mime?: string; size_bytes?: number };
  attempts: CascadeAttemptUI[];
  winner?: { provider_id: string };
  threshold: number;
}

const ACCEPT_THRESHOLD = 0.7;

const DISPLAY: Record<string, { name: string; brand: string }> = {
  plantnet:                  { name: 'PlantNet',          brand: '🪴' },
  claude_haiku:              { name: 'Claude Haiku',      brand: '✨' },
  webllm_phi35_vision:       { name: 'Phi-3.5-vision',    brand: '📱' },
  birdnet_lite:              { name: 'BirdNET-Lite',      brand: '🐦' },
  onnx_efficientnet_lite0:   { name: 'EfficientNet-Lite0',brand: '🌎' },
  camera_trap_megadetector:  { name: 'MegaDetector',      brand: '🎯' },
  speciesnet_distilled:      { name: 'SpeciesNet',        brand: '🦌' },
  bedrock:                   { name: 'AWS Bedrock',       brand: '☁️' },
  vertex_ai:                 { name: 'Vertex AI',         brand: '☁️' },
  openai:                    { name: 'OpenAI',            brand: '☁️' },
  azure_openai:              { name: 'Azure OpenAI',      brand: '☁️' },
  gemini:                    { name: 'Gemini',            brand: '☁️' },
};

function display(id: string): { name: string; brand: string } {
  return DISPLAY[id] ?? { name: id, brand: '🧪' };
}

interface RunCascadeAttemptIn {
  id: string;
  ok: boolean;
  confidence?: number;
  error?: string;
  result?: { scientific_name: string; common_name_en?: string | null; confidence: number; source: string };
}
interface RunCascadeResultIn {
  best: { source: string; confidence: number } | null;
  attempts: RunCascadeAttemptIn[];
}

function attemptStateFromRun(a: RunCascadeAttemptIn, isWinner: boolean): CascadeAttemptStateUI {
  if (a.ok && a.result) {
    if (isWinner && a.result.confidence >= ACCEPT_THRESHOLD) return 'accepted';
    return 'rejected';
  }
  if (a.error?.toLowerCase().includes('aborted')) return 'aborted';
  if (a.error?.startsWith('needs_') || a.error?.startsWith('disabled') || a.error?.startsWith('model_not_bundled')) return 'skipped';
  return 'failed';
}

export function fromRunCascade(
  r: RunCascadeResultIn,
  mediaKind: 'photo' | 'audio' | 'video',
): CascadeTraceData {
  const winnerId = r.best?.source;
  const attempts: CascadeAttemptUI[] = r.attempts.map((a) => {
    const isWin = !!winnerId && a.result?.source === winnerId && a.result?.confidence === r.best?.confidence;
    const d = display(a.id);
    return {
      id: a.id,
      display_name: d.name,
      brand: d.brand,
      runtime: 'client',
      state: attemptStateFromRun(a, isWin),
      confidence: a.confidence ?? a.result?.confidence,
      threshold: ACCEPT_THRESHOLD,
      reason: a.error,
      result: a.result ? { scientific_name: a.result.scientific_name, common_name: a.result.common_name_en ?? undefined } : undefined,
    };
  });
  return {
    media: { kind: mediaKind },
    attempts,
    winner: r.best ? { provider_id: r.best.source } : undefined,
    threshold: ACCEPT_THRESHOLD,
  };
}

interface EfResultIn {
  source?: string;
  scientific_name?: string;
  confidence?: number;
  cascade_attempts?: Array<{ provider: string; confidence: number | null; error?: string }>;
}

export function fromEfResponse(r: EfResultIn, mediaKind: 'photo' | 'audio' | 'video' = 'photo'): CascadeTraceData {
  const attempts: CascadeAttemptUI[] = (r.cascade_attempts ?? []).map((a) => {
    const d = display(a.provider);
    const isWinner = r.source === a.provider && r.confidence === (a.confidence ?? -1);
    let state: CascadeAttemptStateUI = 'failed';
    if (a.error?.toLowerCase().includes('aborted')) state = 'aborted';
    else if (a.confidence != null && a.confidence >= ACCEPT_THRESHOLD && isWinner) state = 'accepted';
    else if (a.confidence != null) state = 'rejected';
    return {
      id: a.provider,
      display_name: d.name,
      brand: d.brand,
      runtime: 'server',
      state,
      confidence: a.confidence ?? undefined,
      threshold: ACCEPT_THRESHOLD,
      reason: a.error,
    };
  });
  return {
    media: { kind: mediaKind },
    attempts,
    winner: r.source ? { provider_id: r.source } : undefined,
    threshold: ACCEPT_THRESHOLD,
  };
}

interface IdentificationRowIn {
  source: string;
  scientific_name: string;
  confidence?: number;
  raw_response?: unknown;
}

export function fromIdentificationRow(row: IdentificationRowIn, mediaKind: 'photo' | 'audio' | 'video' = 'photo'): CascadeTraceData | null {
  const raw = row.raw_response as { cascade_attempts?: Array<{ id?: string; provider?: string; confidence?: number; error?: string }> } | null | undefined;
  if (!raw?.cascade_attempts || !Array.isArray(raw.cascade_attempts)) {
    const d = display(row.source);
    return {
      media: { kind: mediaKind },
      attempts: [{
        id: row.source,
        display_name: d.name,
        brand: d.brand,
        state: row.confidence != null && row.confidence >= ACCEPT_THRESHOLD ? 'accepted' : 'rejected',
        confidence: row.confidence,
        threshold: ACCEPT_THRESHOLD,
        result: { scientific_name: row.scientific_name },
      }],
      winner: { provider_id: row.source },
      threshold: ACCEPT_THRESHOLD,
    };
  }
  return fromEfResponse({
    source: row.source,
    scientific_name: row.scientific_name,
    confidence: row.confidence,
    cascade_attempts: raw.cascade_attempts.map(a => ({
      provider: a.provider ?? a.id ?? 'unknown',
      confidence: a.confidence ?? null,
      error: a.error,
    })),
  }, mediaKind);
}
