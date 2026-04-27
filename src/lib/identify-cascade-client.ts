/**
 * Client-side parallel identifier cascade.
 *
 * Runs every available identifier (PlantNet, Claude Haiku, Phi-3.5-vision)
 * in parallel and returns the **first responder with confidence ≥ 0.5**.
 * If no identifier crosses the threshold, returns the highest-confidence
 * response with `uncertain: true`. If everything fails, returns
 * `{ kind: 'all_failed', errors }` for a single consolidated error.
 *
 * The previous implementation ran PlantNet, then waited for 403/404, then
 * started Claude — adding ~7 s latency for non-plant photos. Running in
 * parallel and racing on confidence is closer to user expectation: "fast,
 * and right when it can be."
 *
 * This module is pure orchestration — the actual HTTP calls live behind
 * the runner functions you pass in. That keeps the unit tests free of
 * network mocks.
 */

export interface UnifiedIdResult {
  /** Stable plugin id (`plantnet`, `claude_haiku`, `webllm_phi35_vision`). */
  source: string;
  scientific_name: string;
  common_name: string | null;
  confidence: number;
  alternates: Array<{ scientific_name: string; common_name: string | null; score: number }>;
  /** Optional human-readable note (e.g. "general VLM, treat as a hint"). */
  note?: string;
  /** Verbatim raw response, kept for debugging. */
  raw?: unknown;
}

export type IdentifierRunner = (
  file: File,
  signal: AbortSignal,
) => Promise<UnifiedIdResult | null>;

export interface RunParallelIdentifyOptions {
  /** Plugin-id → runner. Pass only the runners that should compete. */
  runners: Record<string, IdentifierRunner>;
  /** Confidence floor for "winner". Defaults to 0.5. */
  threshold?: number;
  /** Wall-clock cap (ms) before we give up on slow runners. Default 30s. */
  timeoutMs?: number;
}

export type ParallelIdentifyOutcome =
  | { kind: 'winner'; result: UnifiedIdResult; uncertain: false }
  | { kind: 'uncertain'; result: UnifiedIdResult; uncertain: true }
  | { kind: 'all_failed'; errors: Record<string, string> };

/**
 * Run every supplied identifier in parallel.
 *
 * Resolution rules:
 *   - As soon as a runner returns a result with `confidence >= threshold`
 *     (default 0.5), we abort the others and resolve with `kind: 'winner'`.
 *   - Otherwise we wait for all to settle, then return the highest-
 *     confidence response with `kind: 'uncertain'` (or `all_failed` if
 *     none succeeded).
 *
 * The caller owns the AbortController for cancellation from the UI side
 * (the function creates a child controller internally for the cancel
 * race; passing `external: AbortSignal` aborts the whole batch).
 */
export async function runParallelIdentify(
  file: File,
  opts: RunParallelIdentifyOptions,
  external?: AbortSignal,
): Promise<ParallelIdentifyOutcome> {
  const threshold = opts.threshold ?? 0.5;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const entries = Object.entries(opts.runners);
  if (entries.length === 0) {
    return { kind: 'all_failed', errors: { _: 'no runners' } };
  }

  const internalCtrl = new AbortController();
  const onExternalAbort = () => internalCtrl.abort();
  if (external) external.addEventListener('abort', onExternalAbort);
  const timeoutId = setTimeout(() => internalCtrl.abort(), timeoutMs);

  const results: Array<{ id: string; result: UnifiedIdResult }> = [];
  const errors: Record<string, string> = {};

  let winner: { id: string; result: UnifiedIdResult } | null = null;

  const promises = entries.map(([id, runner]) =>
    runner(file, internalCtrl.signal)
      .then((r) => {
        if (r && r.confidence >= threshold && !winner) {
          winner = { id, result: r };
          internalCtrl.abort();
        } else if (r) {
          results.push({ id, result: r });
        }
      })
      .catch((err: unknown) => {
        errors[id] = err instanceof Error ? err.message : String(err);
      }),
  );

  try {
    await Promise.allSettled(promises);
  } finally {
    clearTimeout(timeoutId);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }

  if (winner) {
    return { kind: 'winner', result: (winner as { id: string; result: UnifiedIdResult }).result, uncertain: false };
  }

  if (results.length > 0) {
    results.sort((a, b) => b.result.confidence - a.result.confidence);
    return { kind: 'uncertain', result: results[0].result, uncertain: true };
  }

  return { kind: 'all_failed', errors };
}

// ─────────────── JSON parsing helpers (shared with vision fallback) ───────────────

/**
 * Strip a Markdown code fence and grab the first JSON object substring.
 * Used by both the Claude vision and Phi-vision JSON-locked prompts —
 * Phi sometimes adds a preamble; Claude occasionally wraps in ```json.
 */
export function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```\s*$/g, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export interface ParsedVisionJson {
  scientific_name: string;
  common_name: string | null;
  confidence: number;
  alternates: Array<{ scientific_name: string; common_name: string | null; score: number }>;
  note: string | null;
}

interface RawVisionShape {
  top?: string | null;
  scientific_name?: string | null;
  common?: string | null;
  common_name?: string | null;
  common_name_en?: string | null;
  common_name_es?: string | null;
  confidence?: number;
  alternates?: Array<{ sci?: string; scientific_name?: string; common?: string | null; score?: number }>;
  note?: string;
  notes?: string;
}

/**
 * Parse a JSON-locked vision response from either Claude or Phi-3.5-vision
 * into a normalised shape. Returns null when the JSON is unparseable or
 * empty — the caller should fall back to displaying the raw prose.
 */
export function parseVisionJson(raw: string): ParsedVisionJson | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: RawVisionShape;
  try {
    parsed = JSON.parse(json) as RawVisionShape;
  } catch {
    return null;
  }
  const top = parsed.top ?? parsed.scientific_name ?? '';
  if (!top) return null;
  const common =
    parsed.common ??
    parsed.common_name ??
    parsed.common_name_en ??
    parsed.common_name_es ??
    null;
  const confidence = clampConfidence(parsed.confidence);
  const alternates = (parsed.alternates ?? []).slice(0, 4).map((a) => ({
    scientific_name: a.sci ?? a.scientific_name ?? '',
    common_name: a.common ?? null,
    score: clampConfidence(a.score),
  }));
  return {
    scientific_name: top,
    common_name: common,
    confidence,
    alternates,
    note: parsed.note ?? parsed.notes ?? null,
  };
}

function clampConfidence(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
