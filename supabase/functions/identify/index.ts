/**
 * /functions/v1/identify — parallel cascade entry point.
 *
 * See docs/specs/modules/01-photo-id.md for the cascade logic. This function
 * runs on Supabase Edge (Deno runtime). Invoke it from the PWA with a signed
 * media URL; this function re-fetches the image server-side so the client
 * never ships the Anthropic / PlantNet keys.
 *
 * v1.0.x — `identify-server-cascade` refactor:
 *   The previous implementation ran PlantNet, waited, then fell through to
 *   Claude — adding ~7 s latency for non-plant photos. Now both runners
 *   race in parallel; the first response with confidence ≥ 0.7 wins and the
 *   slower runner is aborted. If neither crosses the threshold, we return
 *   the highest-confidence response we did get. (See the client mirror in
 *   `src/lib/identify-cascade-client.ts`.)
 *
 *   Key resolution rule (server-side, post-sponsorship migration):
 *     1. BYO key from `client_keys.anthropic` / `client_anthropic_key` wins.
 *     2. Otherwise, if a JWT user is present, resolve a sponsorship via
 *        `_shared/sponsorship.ts` (rate-limit, decrypt vault, record usage).
 *     3. Otherwise the Claude runner is skipped (returns null) — the
 *        operator-key fallback (`Deno.env.get('ANTHROPIC_API_KEY')`) is
 *        intentionally NOT consulted; sponsorships replace that path.
 *
 * Required env vars (set via `supabase secrets set`):
 *   PLANTNET_API_KEY        PlantNet v2 API (optional — no-op if unset)
 *   SUPABASE_SERVICE_ROLE_KEY  Write-path for identifications rows + sponsorship lookups
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import {
  resolveSponsorship,
  decryptCredential,
  recordUsage,
  checkAndBumpRateLimit,
  autoPauseSponsorship,
  maybeNotifyThreshold,
  pickAuthHeader,
  type ResolvedSponsorship,
  type CredentialKind,
} from '../_shared/sponsorship.ts';

type IdentifyRequest = {
  observation_id: string;
  image_url: string;
  user_hint?: 'plant' | 'animal' | 'fungi' | 'unknown';
  location?: { lat: number; lng: number };
  /**
   * Bring-your-own keys keyed by provider name. The function uses each
   * key only for this single call; nothing is logged or persisted
   * server-side. PLANTNET_API_KEY is the operator-side fallback for
   * `plantnet`; for `anthropic` there is no env fallback — when the BYO
   * key is missing the function resolves a sponsorship (see file header).
   *
   * Supported names today: 'anthropic', 'plantnet'.
   */
  client_keys?: Record<string, string>;
  /**
   * Legacy field — same effect as client_keys.anthropic. Kept for
   * backwards compat with older clients that haven't migrated yet.
   */
  client_anthropic_key?: string;
  /**
   * Force a specific provider — used by the client cascade engine when it
   * wants to call exactly one server-side identifier (skip the default
   * parallel race). Values: 'plantnet' | 'claude_haiku'.
   */
  force_provider?: 'plantnet' | 'claude_haiku';
};

type IDResult = {
  scientific_name: string;
  common_name_es: string | null;
  common_name_en: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Chromista' | 'Bacteria' | 'Unknown';
  family: string | null;
  confidence: number;
  source: 'plantnet' | 'claude_haiku';
  raw: unknown;
};

const CONFIDENCE_THRESHOLD = 0.7;
const RACE_TIMEOUT_MS = 30_000;

// ─────────────── pure helpers ───────────────

async function fetchImageAsBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ─────────────── runner: PlantNet ───────────────

async function callPlantNet(
  imageBytes: Uint8Array,
  clientKey?: string,
  signal?: AbortSignal,
): Promise<IDResult | null> {
  const key = clientKey || Deno.env.get('PLANTNET_API_KEY');
  if (!key) return null;

  const form = new FormData();
  form.append('images', new Blob([imageBytes], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('organs', 'auto');

  const res = await fetch(
    `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=es&nb-results=5`,
    { method: 'POST', body: form, signal },
  );
  if (!res.ok) return null;
  const json = await res.json() as {
    results: Array<{
      score: number;
      species: {
        scientificNameWithoutAuthor: string;
        commonNames: string[];
        family: { scientificNameWithoutAuthor: string };
      };
    }>;
  };

  const top = json.results?.[0];
  if (!top) return null;

  return {
    scientific_name: top.species.scientificNameWithoutAuthor,
    common_name_es: top.species.commonNames?.[0] ?? null,
    common_name_en: null,
    kingdom: 'Plantae',
    family: top.species.family?.scientificNameWithoutAuthor ?? null,
    confidence: top.score,
    source: 'plantnet',
    raw: json,
  };
}

// ─────────────── runner: Claude Haiku vision ───────────────

interface ClaudeContext {
  lat?: number;
  lng?: number;
  plantnet_candidates?: string[];
  /**
   * Pre-resolved Anthropic credential. Either the BYO key forwarded by the
   * client, or a sponsor-supplied secret decrypted from Vault. The runner
   * does NOT fall back to env vars — the caller decides credential source.
   */
  credential?: { secret: string; kind: CredentialKind };
  signal?: AbortSignal;
}

async function callClaudeHaiku(
  imageBytes: Uint8Array,
  mimeType: string,
  context: ClaudeContext,
): Promise<IDResult | null> {
  if (!context.credential) return null;

  const b64 = bytesToBase64(imageBytes);

  const systemPrompt = [
    'You are a field biologist assistant specializing in Mexican biodiversity.',
    'Identify the species in the photo. Respond ONLY with valid JSON matching the schema.',
    'If you cannot identify, set confidence to 0 and explain in notes.',
    'Focus on species found in Mexico, Central America, and the Caribbean.',
  ].join('\n');

  const userText = context.plantnet_candidates?.length
    ? `PlantNet suggests: ${context.plantnet_candidates.join(', ')}. Confirm or correct.`
    : (context.lat && context.lng)
      ? `Location: ${context.lat}, ${context.lng}. Identify this species.`
      : 'Identify this species.';

  const body = {
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: b64 } },
        { type: 'text', text: userText + '\n\nRespond with JSON only: {"scientific_name": "", "common_name_es": "", "common_name_en": "", "family": "", "kingdom": "Plantae|Animalia|Fungi|Unknown", "confidence": 0.0, "nom_059_status": null, "notes": null, "alternative_species": []}' },
      ],
    }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: pickAuthHeader(context.credential.kind, context.credential.secret),
    body: JSON.stringify(body),
    signal: context.signal,
  });
  if (!res.ok) return null;

  const json = await res.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const textBlock = json.content?.find(c => c.type === 'text');
  if (!textBlock?.text) return null;

  const cleaned = textBlock.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: {
    scientific_name: string;
    common_name_es: string | null;
    common_name_en: string | null;
    family: string | null;
    kingdom: IDResult['kingdom'];
    confidence: number;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  return {
    scientific_name: parsed.scientific_name,
    common_name_es: parsed.common_name_es,
    common_name_en: parsed.common_name_en,
    kingdom: parsed.kingdom,
    family: parsed.family,
    confidence: parsed.confidence,
    source: 'claude_haiku',
    raw: json,
  };
}

// ─────────────── runner: ONNX-base placeholder ───────────────
//
// Server-side ONNX inference is not bundled into the EF (no onnxruntime in
// Deno Deploy without WASM weights). The runner is wired in so the parallel
// race shape is symmetric; it always returns null and never participates.
// When we ship a server-side ONNX-base path (likely behind a flag), this
// is the only function that needs to grow.
async function callOnnxBase(
  _imageBytes: Uint8Array,
  _signal?: AbortSignal,
): Promise<IDResult | null> {
  return null;
}

// ─────────────── parallel cascade ───────────────

type ServerRunner = (signal: AbortSignal) => Promise<IDResult | null>;

interface RunCascadeResult {
  result: IDResult | null;
  errors: Record<string, string>;
}

/**
 * Run every supplied runner in parallel; resolve as soon as one returns a
 * result with confidence ≥ CONFIDENCE_THRESHOLD (and abort the rest). If
 * none crosses the threshold, return the highest-confidence response that
 * did succeed. If everything fails, `result: null` and the caller can
 * surface the per-runner errors.
 *
 * Pure orchestration — kept here so the runner functions stay testable in
 * isolation when we eventually build a Deno test harness.
 */
async function runServerCascade(
  runners: Record<string, ServerRunner>,
  threshold = CONFIDENCE_THRESHOLD,
  timeoutMs = RACE_TIMEOUT_MS,
): Promise<RunCascadeResult> {
  const entries = Object.entries(runners);
  if (entries.length === 0) return { result: null, errors: { _: 'no runners' } };

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

  const collected: Array<{ id: string; result: IDResult }> = [];
  const errors: Record<string, string> = {};
  let winner: { id: string; result: IDResult } | null = null;

  const promises = entries.map(([id, runner]) =>
    runner(ctrl.signal)
      .then((r) => {
        if (r && r.confidence >= threshold && !winner) {
          winner = { id, result: r };
          ctrl.abort();
        } else if (r) {
          collected.push({ id, result: r });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('aborted')) errors[id] = msg;
      }),
  );

  try {
    await Promise.allSettled(promises);
  } finally {
    clearTimeout(timeoutId);
  }

  if (winner) return { result: (winner as { id: string; result: IDResult }).result, errors };
  if (collected.length > 0) {
    collected.sort((a, b) => b.result.confidence - a.result.confidence);
    return { result: collected[0].result, errors };
  }
  return { result: null, errors };
}

// ─────────────── HTTP handler ───────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return corsResponse('Method not allowed', { status: 405 });
  }

  // Per-IP rate limit for unauthenticated callers — guests on the
  // /es/identificar page can otherwise mass-drain the shared PlantNet
  // 500/day quota. Signed-in users (with an Authorization header) are
  // assumed to be paying their own quota cost via BYO key or are
  // already gated by RLS on the resulting INSERT. See runbook #10.
  const hasAuth = req.headers.has('authorization')
    && req.headers.get('authorization')!.toLowerCase().startsWith('bearer ');
  if (!hasAuth) {
    const ip = req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'unknown';
    const key = `ip:${ip}`;
    const ipMap = (globalThis as unknown as { __identifyRateMap?: Map<string, number[]> }).__identifyRateMap
      ?? new Map<string, number[]>();
    (globalThis as unknown as { __identifyRateMap?: Map<string, number[]> }).__identifyRateMap = ipMap;
    const WINDOW_MS = 60 * 60 * 1000;        // 1 hour
    const ANON_LIMIT = 10;                    // 10 IDs / hour / IP
    const now = Date.now();
    const recent = (ipMap.get(key) ?? []).filter(t => now - t < WINDOW_MS);
    if (recent.length >= ANON_LIMIT) {
      return corsResponse(
        JSON.stringify({ error: 'rate_limited', retry_after_seconds: 3600 }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      );
    }
    recent.push(now);
    ipMap.set(key, recent);
  }

  let body: IdentifyRequest;
  try {
    body = await req.json();
  } catch {
    return corsResponse('Invalid JSON', { status: 400 });
  }

  if (!body.observation_id || !body.image_url) {
    return corsResponse('Missing observation_id or image_url', { status: 400 });
  }

  const imageBytes = await fetchImageAsBytes(body.image_url);
  const mimeType = 'image/jpeg';

  const byoPlantnet = body.client_keys?.plantnet;
  const byoAnthropic = body.client_keys?.anthropic ?? body.client_anthropic_key;

  // Service-role client for sponsorship lookups, vault decryption, usage
  // writes, and the eventual identifications insert. Created lazily so
  // anonymous BYO calls (no JWT, no sponsorship) don't pay the round trip.
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  let serviceDb: SupabaseClient | null = null;
  function db(): SupabaseClient {
    if (!serviceDb) {
      if (!serviceRole || !supabaseUrl) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      }
      serviceDb = createClient(supabaseUrl, serviceRole);
    }
    return serviceDb;
  }

  // Resolve the JWT-bearing user (if any). Used as the sponsorship beneficiary
  // and as the rate-limit subject. Anonymous callers fall through to BYO-only.
  let beneficiaryId: string | null = null;
  if (hasAuth && serviceRole && supabaseUrl) {
    const jwt = req.headers.get('authorization')!.slice('Bearer '.length).trim();
    try {
      const { data, error } = await db().auth.getUser(jwt);
      if (!error && data.user) beneficiaryId = data.user.id;
    } catch {
      beneficiaryId = null;
    }
  }

  // Decide what credential the Claude runner gets. Order:
  //   1. BYO key forwarded by the client.
  //   2. Sponsor-supplied credential resolved via _shared/sponsorship.ts.
  //   3. Nothing — the Claude runner is skipped (no operator-key fallback).
  let claudeCred: { secret: string; kind: CredentialKind } | null = null;
  let sponsorshipCtx: ResolvedSponsorship | null = null;
  let sponsorshipSkipReason: string | null = null;

  if (byoAnthropic) {
    claudeCred = { secret: byoAnthropic, kind: 'api_key' };
  } else if (beneficiaryId) {
    try {
      const rl = await checkAndBumpRateLimit(db(), beneficiaryId, 'anthropic');
      if (!rl.allowed) {
        sponsorshipSkipReason = rl.reason ?? 'rate_limit';
        if (rl.reason?.startsWith('rate_limit:')) {
          const ctxNow = await resolveSponsorship(db(), beneficiaryId, 'anthropic');
          if (ctxNow) await autoPauseSponsorship(db(), ctxNow.sponsorshipId, rl.reason, beneficiaryId);
        }
      } else {
        // Sponsored users add ~3 DB round-trips vs BYO: resolve, decrypt vault, rate-limit bump.
        // Acceptable at v1 scale; profile if /identify p95 latency regresses.
        sponsorshipCtx = await resolveSponsorship(db(), beneficiaryId, 'anthropic');
        if (sponsorshipCtx) {
          const secret = await decryptCredential(db(), sponsorshipCtx.vaultSecretId);
          claudeCred = { secret, kind: sponsorshipCtx.kind };
        }
      }
    } catch (err) {
      // allowed: log level + no secret
      console.warn(`[identify] sponsorship resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let result: IDResult | null = null;

  if (body.force_provider === 'plantnet') {
    result = await callPlantNet(imageBytes, byoPlantnet);
  } else if (body.force_provider === 'claude_haiku') {
    result = await callClaudeHaiku(imageBytes, mimeType, {
      lat: body.location?.lat,
      lng: body.location?.lng,
      credential: claudeCred ?? undefined,
    });
  } else {
    // Default: race PlantNet, Claude Haiku, and (placeholder) ONNX-base in
    // parallel. The first to return confidence ≥ threshold wins; the rest
    // are aborted. user_hint is used to bias the threshold slightly later
    // (today it just gates which runners we even start).
    const runners: Record<string, ServerRunner> = {};
    const isPlantLike = body.user_hint === 'plant' || body.user_hint === 'fungi' || !body.user_hint;
    if (isPlantLike) {
      runners.plantnet = (signal) => callPlantNet(imageBytes, byoPlantnet, signal);
    }
    runners.claude_haiku = (signal) => callClaudeHaiku(imageBytes, mimeType, {
      lat: body.location?.lat,
      lng: body.location?.lng,
      credential: claudeCred ?? undefined,
      signal,
    });
    runners.onnx_base = (signal) => callOnnxBase(imageBytes, signal);

    const cascaded = await runServerCascade(runners);
    result = cascaded.result;
  }

  // If Claude won and a sponsorship paid for it, record usage + threshold notify.
  if (
    result
    && result.source === 'claude_haiku'
    && sponsorshipCtx
    && beneficiaryId
  ) {
    try {
      const usageBlock = (result.raw as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      const usage = await recordUsage(db(), {
        sponsorshipId: sponsorshipCtx.sponsorshipId,
        sponsorId:     sponsorshipCtx.sponsorId,
        beneficiaryId,
        provider:      'anthropic',
        tokensIn:      usageBlock?.input_tokens,
        tokensOut:     usageBlock?.output_tokens,
      });
      await maybeNotifyThreshold(db(), sponsorshipCtx.sponsorshipId, usage.pctUsed);
    } catch (err) {
      // allowed: log level + no secret
      console.warn(`[identify] recordUsage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!result) {
    const hasAnyClaudeCred = !!claudeCred;
    return corsResponse(JSON.stringify({
      error: hasAnyClaudeCred ? 'identification_failed' : 'no_id_engine_available',
      hint: hasAnyClaudeCred
        ? 'PlantNet returned nothing and Claude failed to parse the response.'
        : sponsorshipSkipReason
          ? `Claude skipped (${sponsorshipSkipReason}). Supply a BYO key, accept a sponsorship, or wait for the rate-limit window to reset.`
          : 'No Claude credential available. Supply a BYO key (client_keys.anthropic) or accept a sponsorship; the operator no longer provides a fallback key.',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body.observation_id !== 'cascade-only') {
    if (serviceRole && supabaseUrl) {
      await db().from('identifications').insert({
        observation_id: body.observation_id,
        scientific_name: result.scientific_name,
        confidence: result.confidence,
        source: result.source,
        raw_response: result.raw as object,
        is_primary: true,
      });
    }
  }

  return corsResponse(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  });
});
