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
