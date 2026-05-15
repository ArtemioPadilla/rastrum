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
 *     1. Owner-personal Vault credential (#655) — when the JWT user owns
 *        a `sponsor_credentials` row with `use_personally = true`, decrypt
 *        and use it WITHOUT recording sponsorship_usage / consuming a pool
 *        slot. It's the owner's own credit, no quota.
 *     2. BYO key from `client_keys.anthropic` / `client_anthropic_key`.
 *     3. Otherwise, if a JWT user is present, resolve a sponsorship via
 *        `_shared/sponsorship.ts` (rate-limit, decrypt vault, record usage).
 *     4. Otherwise the Claude runner is skipped (returns null) — the
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
  type ResolvedSponsorship,
  type CredentialKind,
} from '../_shared/sponsorship.ts';
import {
  buildProvider,
  DEFAULT_SYSTEM_PROMPT,
  CredentialUnauthorizedError,
  type ResolvedCredential,
  type VisionResult,
} from '../_shared/vision-provider.ts';
import { reportFunctionError } from '../admin/_shared/error-reporter.ts';
import { checkAnonRateLimit } from '../_shared/anon-rate-limit.ts';

type IdentifyRequest = {
  observation_id: string;
  /**
   * Public URL of the image to identify. Mutually exclusive with image_data.
   * The function fetches the image server-side so the client never needs
   * to expose provider keys.
   */
  image_url?: string;
  /**
   * Base64 data-URL (e.g. "data:image/jpeg;base64,...") sent directly from
   * the client. Use this when the image is not yet publicly accessible
   * (e.g. before it has been uploaded to storage). Mutually exclusive with
   * image_url; image_data takes precedence when both are provided.
   */
  image_data?: string;
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
  /**
   * When true, run ALL available server-side runners in parallel (mirrors
   * the client-side cascade from `src/lib/identifiers/cascade.ts`).
   * Default false — existing behaviour unchanged.
   */
  cascade?: boolean;
  /** Provider ids to exclude from the cascade (e.g. ['plantnet']). */
  excluded_providers?: string[];
  /** Provider ids to run first, in declared order. Others follow in
   *  default order after the preferred set. */
  preferred_providers?: string[];
  /**
   * Pixel-space bounding box [x1, y1, x2, y2] from MegaDetector. When
   * provided, vision providers append a focus instruction to their system
   * prompt so the model concentrates on the detected animal region.
   * PlantNet ignores this (plant-focused, no bbox hint support).
   */
  crop_bbox?: [number, number, number, number];
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

type CascadeAttempt = {
  provider: string;
  confidence: number | null;
  error?: string;
};

import { isPlantLikeHint } from './_helpers.ts';

const CONFIDENCE_THRESHOLD = 0.7;
const RACE_TIMEOUT_MS = 30_000;

interface PersonalCredential {
  secret: string;
  kind: CredentialKind;
  model: string;
  endpoint: string | null;
}

/**
 * #655: resolve the JWT user's own Vault credential when they have one
 * marked `use_personally = true`. This bypasses sponsorship_usage and
 * pool consumption — the owner pays for their own calls. Returns null
 * when the user has no personal credential set up.
 *
 * Currently scoped to `provider = 'anthropic'` to match the existing
 * cascade contract; pool/sponsorship + the Claude runner are the only
 * paths that consume server-side credentials today.
 */
async function resolvePersonalCredential(
  supabase: SupabaseClient,
  userId: string,
): Promise<PersonalCredential | null> {
  const { data, error } = await supabase
    .from('sponsor_credentials')
    .select('id, kind, vault_secret_id, preferred_model, endpoint')
    .eq('user_id', userId)
    .eq('use_personally', true)
    .eq('provider', 'anthropic')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string; kind: CredentialKind; vault_secret_id: string;
    preferred_model: string | null; endpoint: string | null;
  };
  const secret = await decryptCredential(supabase, row.vault_secret_id);
  return {
    secret,
    kind: row.kind,
    model: row.preferred_model ?? 'claude-haiku-4-5',
    endpoint: row.endpoint,
  };
}

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
  // TODO(security): rotate PLANTNET_API_KEY — old key 2b10E7bp6hVnxBvvJWc3IGv9ae was exposed
  // in browser traffic pre-PR#1037 (window.__RASTRUM_PLANTNET_KEY__ / PUBLIC_PLANTNET_KEY).
  // Rotate via the PlantNet dashboard: https://my.plantnet.org/account/settings
  if (!key) {
    // Why: a missing key returns null silently, which presents to the user
    // as "no plant suggestion" indistinguishable from "PlantNet found nothing".
    // Surface the misconfig so an operator grepping function logs sees it.
    console.warn(`[identify] callPlantNet skipped: no key (clientKey=${clientKey ? 'set' : 'unset'}, env=unset)`);
    return null;
  }

  const form = new FormData();
  form.append('images', new Blob([imageBytes], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('organs', 'auto');

  const res = await fetch(
    `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=es&nb-results=5`,
    { method: 'POST', body: form, signal },
  );
  if (!res.ok) {
    // Why: PlantNet failures (401 revoked key, 403 IP allowlist, 429 quota
    // exhausted, 5xx upstream) previously returned null silently. Log status
    // + body snippet so operators can distinguish the cases. Key itself is
    // never logged — only whether the call used a BYO or operator key.
    let bodySnippet = '';
    try { bodySnippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    console.warn(`[identify] callPlantNet failed: HTTP ${res.status} ${res.statusText}, body=${bodySnippet}, key_source=${clientKey ? 'byo' : 'operator'}`);
    return null;
  }
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
  /** When set, overrides the credential.kind → provider mapping. Used
   *  for sponsored / pool calls where the provider/model came from
   *  the sponsor_credentials row. */
  resolvedCredential?: ResolvedCredential;
  plantnet_candidates?: string[];
  /**
   * Pre-resolved Anthropic credential. Either the BYO key forwarded by the
   * client, or a sponsor-supplied secret decrypted from Vault. The runner
   * does NOT fall back to env vars — the caller decides credential source.
   */
  credential?: { secret: string; kind: CredentialKind };
  signal?: AbortSignal;
  /** MegaDetector bounding box forwarded to the vision provider. */
  crop_bbox?: [number, number, number, number];
}

async function callClaudeHaiku(
  imageBytes: Uint8Array,
  mimeType: string,
  context: ClaudeContext,
): Promise<IDResult | null> {
  // Multi-provider path (M27.1, #116/#118): when a resolved credential
  // is supplied, dispatch via the abstraction layer. The legacy
  // BYO-key path (no resolvedCredential, just `credential`) falls
  // through to direct-Anthropic for backwards compat.
  if (context.resolvedCredential) {
    return await callViaProvider(imageBytes, mimeType, context, context.resolvedCredential);
  }
  if (!context.credential) return null;

  // Legacy BYO direct-Anthropic path.
  const legacyCred: ResolvedCredential = {
    kind: context.credential.kind,
    secret: context.credential.secret,
    model: 'claude-haiku-4-5',
    endpoint: null,
  };
  return await callViaProvider(imageBytes, mimeType, context, legacyCred);
}

async function callViaProvider(
  imageBytes: Uint8Array,
  mimeType: string,
  context: ClaudeContext,
  cred: ResolvedCredential,
): Promise<IDResult | null> {
  const b64 = bytesToBase64(imageBytes);

  const userText = context.plantnet_candidates?.length
    ? `PlantNet suggests: ${context.plantnet_candidates.join(', ')}. Confirm or correct.`
    : (context.lat && context.lng)
      ? `Location: ${context.lat}, ${context.lng}. Identify this species.`
      : 'Identify this species.';

  let provider;
  try {
    provider = buildProvider(cred);
  } catch (err) {
    console.warn(`[identify] buildProvider failed for kind=${cred.kind}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  let visionResult: VisionResult | null;
  try {
    visionResult = await provider.identify({
      imageBase64: b64,
      mimeType,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      userText,
      signal: context.signal,
      crop_bbox: context.crop_bbox,
    });
  } catch (err) {
    // Re-throw 401s so the cascade can fall through to the next credential.
    if (err instanceof CredentialUnauthorizedError) throw err;
    console.warn(`[identify] provider.identify failed kind=${cred.kind}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!visionResult) return null;
  return {
    scientific_name: visionResult.scientific_name,
    common_name_es:  visionResult.common_name_es,
    common_name_en:  visionResult.common_name_en,
    kingdom:         visionResult.kingdom,
    family:          visionResult.family,
    confidence:      visionResult.confidence,
    source:          visionResult.source as IDResult['source'],
    raw:             visionResult.raw,
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
  attempts: CascadeAttempt[];
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
  if (entries.length === 0) return { result: null, errors: { _: 'no runners' }, attempts: [] };

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

  const collected: Array<{ id: string; result: IDResult }> = [];
  const errors: Record<string, string> = {};
  const attempts: CascadeAttempt[] = [];
  let winner: { id: string; result: IDResult } | null = null;

  const promises = entries.map(([id, runner]) =>
    runner(ctrl.signal)
      .then((r) => {
        if (r && r.confidence >= threshold && !winner) {
          winner = { id, result: r };
          attempts.push({ provider: id, confidence: r.confidence });
          ctrl.abort();
        } else if (r) {
          collected.push({ id, result: r });
          attempts.push({ provider: id, confidence: r.confidence });
        } else {
          attempts.push({ provider: id, confidence: null });
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('aborted')) {
          errors[id] = msg;
          attempts.push({ provider: id, confidence: null, error: msg });
        }
      }),
  );

  try {
    await Promise.allSettled(promises);
  } finally {
    clearTimeout(timeoutId);
  }

  if (winner) return { result: (winner as { id: string; result: IDResult }).result, errors, attempts };
  if (collected.length > 0) {
    collected.sort((a, b) => b.result.confidence - a.result.confidence);
    return { result: collected[0].result, errors, attempts };
  }
  return { result: null, errors, attempts };
}

// ─────────────── HTTP handler ───────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build, x-rastrum-cascade',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

export async function handler(req: Request): Promise<Response> {
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
    // Persistent rate-limit (#581): the previous globalThis Map reset on
    // every V8 cold start and was per-isolate. Now backed by Postgres
    // (anon_rate_limit table + 6h cleanup cron).
    const ip = req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'unknown';
    const ANON_LIMIT = 10;
    const WINDOW_SEC = 60 * 60;
    const supabaseUrlForRl = Deno.env.get('SUPABASE_URL');
    const serviceRoleForRl = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrlForRl && serviceRoleForRl) {
      const dbForRl = createClient(supabaseUrlForRl, serviceRoleForRl, { auth: { persistSession: false } });
      const allowed = await checkAnonRateLimit(dbForRl, ip, 'identify', ANON_LIMIT, WINDOW_SEC);
      if (!allowed) {
        return corsResponse(
          JSON.stringify({ error: 'rate_limited', retry_after_seconds: WINDOW_SEC }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      }
    }
    // If env is not set we fail open — better to serve traffic than to
    // brick the EF when env is misconfigured. Misconfiguration is loud
    // elsewhere (the function would 500 on serviceRole reads anyway).
  }

  let body: IdentifyRequest;
  try {
    body = await req.json();
  } catch {
    return corsResponse('Invalid JSON', { status: 400 });
  }

  if (!body.observation_id || (!body.image_url && !body.image_data)) {
    return corsResponse('Missing observation_id and image_url or image_data', { status: 400 });
  }

  // Resolve image bytes — prefer image_data (already on the wire) over image_url
  let imageBytes: Uint8Array;
  if (body.image_data) {
    // Strip the data-URL prefix ("data:image/jpeg;base64,") and decode
    const base64 = body.image_data.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(base64);
    imageBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) imageBytes[i] = binary.charCodeAt(i);
  } else {
    imageBytes = await fetchImageAsBytes(body.image_url!);
  }
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

  // Credential resolution — ordered fallback chain (#693).
  //
  // Each supplier is lazy: it's only invoked when the previous credential
  // returned 401. The pool slot is consumed atomically at resolve-time via
  // `consume_pool_slot()`; if the pool credential then 401s, we surface a
  // hard failure (the slot is already spent, and the issue spec says pool
  // is the last resort).
  //
  // Resolution order:
  //   1. Owner-personal Vault credential (#655, #664) — `use_personally = true`.
  //   2. BYO key forwarded by the client (client_keys.anthropic).
  //   3. Sponsor-supplied credential via _shared/sponsorship.ts.
  //   4. Platform pool — round-robin via `consume_pool_slot()` RPC.
  //   5. Nothing — the Claude runner is skipped.

  interface CredentialWithMeta {
    cred: ResolvedCredential;
    sponsorCtx: ResolvedSponsorship | null;
    poolInfo: { poolId: string; credentialId: string } | null;
    label: string;   // for logging only — never contains the secret
  }

  // Step 1: personal Vault credential (#655).
  let personalCred: CredentialWithMeta | null = null;
  if (beneficiaryId) {
    try {
      const personal = await resolvePersonalCredential(db(), beneficiaryId);
      if (personal) {
        personalCred = {
          cred: {
            kind:     personal.kind as ResolvedCredential['kind'],
            secret:   personal.secret,
            model:    personal.model,
            endpoint: personal.endpoint,
          },
          sponsorCtx: null,
          poolInfo: null,
          label: 'personal',
        };
      }
    } catch (err) {
      console.warn(`[identify] personal credential resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Lazy suppliers for steps 2–4. Each returns null if the slot is
  // unavailable (no sponsorship, no pool capacity, rate-limited, etc.).
  let sponsorshipSkipReason: string | null = null;

  const byoSupplier = (): CredentialWithMeta | null => {
    if (!byoAnthropic) return null;
    return {
      cred: { kind: 'api_key', secret: byoAnthropic, model: 'claude-haiku-4-5', endpoint: null },
      sponsorCtx: null,
      poolInfo: null,
      label: 'byo',
    };
  };

  const sponsorshipSupplier = async (): Promise<CredentialWithMeta | null> => {
    if (!beneficiaryId) return null;
    try {
      const rl = await checkAndBumpRateLimit(db(), beneficiaryId, 'anthropic');
      if (!rl.allowed) {
        sponsorshipSkipReason = rl.reason ?? 'rate_limit';
        if (rl.reason?.startsWith('rate_limit:')) {
          const ctxNow = await resolveSponsorship(db(), beneficiaryId, 'anthropic');
          if (ctxNow) await autoPauseSponsorship(db(), ctxNow.sponsorshipId, rl.reason, beneficiaryId);
        }
        return null;
      }
      const ctx = await resolveSponsorship(db(), beneficiaryId, 'anthropic');
      if (!ctx) return null;
      const secret = await decryptCredential(db(), ctx.vaultSecretId);
      return {
        cred: {
          kind:     ctx.kind as ResolvedCredential['kind'],
          secret,
          model:    ctx.preferredModel,
          endpoint: ctx.endpoint,
        },
        sponsorCtx: ctx,
        poolInfo: null,
        label: 'sponsorship',
      };
    } catch (err) {
      console.warn(`[identify] sponsorship resolution failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const poolSupplier = async (): Promise<CredentialWithMeta | null> => {
    if (!beneficiaryId) return null;
    try {
      const { data: poolRows, error: poolErr } = await db().rpc('consume_pool_slot', {
        p_user_id: beneficiaryId,
      });
      if (poolErr) {
        console.warn(`[identify] consume_pool_slot failed: ${poolErr.message}`);
        return null;
      }
      if (!Array.isArray(poolRows) || poolRows.length === 0) return null;
      const slot = poolRows[0] as {
        pool_id: string; credential_id: string; preferred_model: string;
      };
      const { data: credRow, error: credErr } = await db()
        .from('sponsor_credentials')
        .select('kind, vault_secret_id, endpoint')
        .eq('id', slot.credential_id)
        .single();
      if (credErr) {
        console.warn(`[identify] pool credential lookup failed: ${credErr.message}`);
        return null;
      }
      if (!credRow) return null;
      const secret = await decryptCredential(db(), (credRow as { vault_secret_id: string }).vault_secret_id);
      const kind = (credRow as { kind: CredentialKind }).kind;
      return {
        cred: {
          kind:     kind as ResolvedCredential['kind'],
          secret,
          model:    slot.preferred_model,
          endpoint: (credRow as { endpoint: string | null }).endpoint,
        },
        sponsorCtx: null,
        poolInfo: { poolId: slot.pool_id, credentialId: slot.credential_id },
        label: 'pool',
      };
    } catch (err) {
      console.warn(`[identify] pool resolution failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  // Build the ordered chain. Personal cred is already resolved; BYO is
  // trivial; sponsorship and pool are async lazy suppliers.
  // We use a discriminated union so TypeScript can distinguish sync vs async.
  type CredSupplier =
    | { kind: 'resolved'; value: CredentialWithMeta | null }
    | { kind: 'sync';     fn: () => CredentialWithMeta | null }
    | { kind: 'async';    fn: () => Promise<CredentialWithMeta | null> };

  const credChain: CredSupplier[] = [
    { kind: 'resolved', value: personalCred },
    { kind: 'sync',     fn: byoSupplier },
    { kind: 'async',    fn: sponsorshipSupplier },
    { kind: 'async',    fn: poolSupplier },
  ];

  /**
   * Try each credential supplier in order. On 401, log a structured
   * warning (no secret) and continue to the next. Returns the first
   * successful result plus which credential won.
   */
  async function callClaudeWithFallback(
    imgBytes: Uint8Array,
    mime: string,
    context: Omit<ClaudeContext, 'credential' | 'resolvedCredential'>,
    chain: CredSupplier[],
  ): Promise<{ result: IDResult | null; winner: CredentialWithMeta | null }> {
    for (const supplier of chain) {
      let meta: CredentialWithMeta | null;
      if (supplier.kind === 'resolved') {
        meta = supplier.value;
      } else if (supplier.kind === 'sync') {
        meta = supplier.fn();
      } else {
        meta = await supplier.fn();
      }
      if (!meta) continue;

      try {
        const r = await callClaudeHaiku(imgBytes, mime, {
          ...context,
          credential: { secret: meta.cred.secret, kind: meta.cred.kind as CredentialKind },
          resolvedCredential: meta.cred,
        });
        return { result: r, winner: meta };
      } catch (err) {
        if (err instanceof CredentialUnauthorizedError) {
          console.warn(`[identify] credential 401 on label=${meta.label} kind=${meta.cred.kind} — falling through to next (user_id=${beneficiaryId ?? 'anon'})`);
          // Best-effort structured log — never blocks.
          if (serviceRole && supabaseUrl) {
            reportFunctionError(
              db(),
              'identify',
              'byo_401_fallthrough',
              beneficiaryId,
              { credential_label: meta.label, credential_kind: meta.cred.kind },
            ).catch(() => {/* swallow — reporter is best-effort */});
          }
          continue;
        }
        throw err;
      }
    }
    return { result: null, winner: null };
  }

  // Snapshot the resolved state after identification so usage recording
  // and pool-drip work correctly regardless of which credential won.
  let sponsorshipCtx: ResolvedSponsorship | null = null;
  let poolUsed: { poolId: string; credentialId: string } | null = null;
  // hasAnyCred: true when at least one supplier would have produced a
  // credential, used for the error hint message.
  const hasAnyCred = personalCred !== null || !!byoAnthropic || !!beneficiaryId;

  let result: IDResult | null = null;
  let cascadeAttempts: CascadeAttempt[] | null = null;
  let providerUsed: string | null = null;

  const claudeContext: Omit<ClaudeContext, 'credential' | 'resolvedCredential'> = {
    lat: body.location?.lat,
    lng: body.location?.lng,
    crop_bbox: body.crop_bbox,
  };

  if (body.force_provider === 'plantnet') {
    result = await callPlantNet(imageBytes, byoPlantnet);
  } else if (body.force_provider === 'claude_haiku') {
    const { result: r, winner } = await callClaudeWithFallback(
      imageBytes, mimeType, claudeContext, credChain,
    );
    result = r;
    if (winner) {
      sponsorshipCtx = winner.sponsorCtx;
      poolUsed = winner.poolInfo;
      providerUsed = winner.label;
    }
  } else if (body.cascade) {
    // Cascade mode: build the runners map dynamically based on user_hint,
    // apply excluded_providers filter, then preferred_providers ordering.
    // Mirrors the client-side cascade from src/lib/identifiers/cascade.ts.
    const allRunners: Record<string, ServerRunner> = {};
    const isPlantLike = isPlantLikeHint(body.user_hint);
    if (isPlantLike) {
      allRunners.plantnet = (signal) => callPlantNet(imageBytes, byoPlantnet, signal);
    }
    // Claude runner uses the fallback chain — the signal is forwarded for
    // abort on cascade timeout, but credential fallback is still sequential.
    allRunners.claude_haiku = async (signal) => {
      const { result: r, winner } = await callClaudeWithFallback(
        imageBytes, mimeType, { ...claudeContext, signal }, credChain,
      );
      if (winner) {
        sponsorshipCtx = winner.sponsorCtx;
        poolUsed = winner.poolInfo;
        providerUsed = winner.label;
      }
      return r;
    };
    allRunners.onnx_base = (signal) => callOnnxBase(imageBytes, signal);
    // Future: add new server-side plugins here.

    // Apply excluded_providers filter.
    const excluded = new Set(body.excluded_providers ?? []);
    for (const id of excluded) {
      delete allRunners[id];
    }

    // Apply preferred_providers ordering: preferred first (in declared
    // order), then remaining runners in their default insertion order.
    const preferred = body.preferred_providers ?? [];
    const orderedRunners: Record<string, ServerRunner> = {};
    for (const id of preferred) {
      if (allRunners[id]) {
        orderedRunners[id] = allRunners[id];
      }
    }
    const preferredSet = new Set(preferred);
    for (const [id, runner] of Object.entries(allRunners)) {
      if (!preferredSet.has(id)) {
        orderedRunners[id] = runner;
      }
    }

    const cascaded = await runServerCascade(orderedRunners);
    result = cascaded.result;
    cascadeAttempts = cascaded.attempts;
  } else {
    // Default: race PlantNet, Claude Haiku (with credential fallback chain),
    // and (placeholder) ONNX-base in parallel. The first to return confidence
    // ≥ threshold wins; the rest are aborted.
    const runners: Record<string, ServerRunner> = {};
    const isPlantLike = isPlantLikeHint(body.user_hint);
    if (isPlantLike) {
      runners.plantnet = (signal) => callPlantNet(imageBytes, byoPlantnet, signal);
    }
    runners.claude_haiku = async (signal) => {
      const { result: r, winner } = await callClaudeWithFallback(
        imageBytes, mimeType, { ...claudeContext, signal }, credChain,
      );
      if (winner) {
        sponsorshipCtx = winner.sponsorCtx;
        poolUsed = winner.poolInfo;
        providerUsed = winner.label;
      }
      return r;
    };
    runners.onnx_base = (signal) => callOnnxBase(imageBytes, signal);

    const cascaded = await runServerCascade(runners);
    result = cascaded.result;
  }

  // If a sponsorship paid for the winning ID, record usage + threshold notify.
  // Gate on source !== 'plantnet' so we cover Anthropic-direct, Bedrock, Vertex,
  // OpenAI, Azure, Gemini — anything that consumed the sponsored credential.
  // PlantNet has its own quota and never pulls from sponsorship.
  if (
    result
    && result.source !== 'plantnet'
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

  // Pool call sponsor drip: award 0.5 karma to the pool's sponsor each
  // time a beneficiary successfully uses a pool-funded identification.
  if (result && poolUsed) {
    try {
      const { data: poolRow, error: poolLookupErr } = await db()
        .from('sponsor_pools')
        .select('sponsor_id')
        .eq('id', poolUsed.poolId)
        .single();
      if (poolLookupErr) {
        console.warn(`[identify] pool sponsor lookup failed: ${poolLookupErr.message}`);
      } else if (poolRow) {
        const sponsorId = (poolRow as { sponsor_id: string }).sponsor_id;
        await db().rpc('add_karma_simple', {
          p_user_id: sponsorId,
          p_delta: 0.5,
          p_reason: 'pool_call_sponsor_drip',
        });
      }
    } catch (err) {
      console.warn(`[identify] pool sponsor karma drip failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!result) {
    const errorPayload: Record<string, unknown> = {
      error: hasAnyCred ? 'identification_failed' : 'no_id_engine_available',
      hint: hasAnyCred
        ? 'PlantNet returned nothing and Claude failed to parse the response.'
        : sponsorshipSkipReason
          ? `Claude skipped (${sponsorshipSkipReason}). Supply a BYO key, accept a sponsorship, or wait for the rate-limit window to reset.`
          : 'No Claude credential available. Supply a BYO key (client_keys.anthropic) or accept a sponsorship; the operator no longer provides a fallback key.',
    };
    if (cascadeAttempts) {
      errorPayload.cascade_attempts = cascadeAttempts;
    }
    return corsResponse(JSON.stringify(errorPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body.observation_id !== 'cascade-only') {
    if (serviceRole && supabaseUrl) {
      // Upsert the taxon so observations.primary_taxon_id can be resolved.
      // The identify cascade returns enough metadata (scientific_name, kingdom,
      // family, common names) to create a minimal taxa row. On conflict we
      // update the common names in case they improved (PlantNet → Claude or
      // vice-versa). We do NOT overwrite kingdom/family since those come from
      // authoritative sources (PlantNet / GBIF) and should not be clobbered.
      let taxonId: string | null = null;
      try {
        const taxonPayload = {
          scientific_name: result.scientific_name,
          common_name_es: result.common_name_es ?? null,
          common_name_en: result.common_name_en ?? null,
          kingdom: result.kingdom !== 'Unknown' ? result.kingdom : null,
          family: result.family ?? null,
          taxon_rank: 'species',
        };
        const { data: taxonRow, error: taxonErr } = await db()
          .from('taxa')
          .upsert(taxonPayload, {
            onConflict: 'scientific_name',
            ignoreDuplicates: false,
          })
          .select('id')
          .maybeSingle();
        if (taxonErr) {
          console.warn('[identify] taxa upsert failed (non-fatal)', taxonErr.message);
        } else if (taxonRow?.id) {
          taxonId = taxonRow.id as string;
        }
      } catch (e) {
        console.warn('[identify] taxa upsert exception (non-fatal)', e);
      }

      // #589: UNIQUE-safe insert via upsert RPC.
      await db().rpc('upsert_primary_identification', {
        p_observation_id: body.observation_id,
        p_scientific_name: result.scientific_name,
        p_taxon_id: taxonId,
        p_confidence: result.confidence,
        p_source: result.source,
        p_raw_response: result.raw as object,
      });

      // Fire-and-forget GBIF lineage enrichment for the upserted taxon.
      // The identify cascade only writes kingdom + family at insert; this
      // backfills phylum/class/order/genus from GBIF so the species/tree
      // visualisations can group properly. We never block the response on
      // this — failures are logged and absorbed.
      if (taxonId) {
        const efUrl = `${supabaseUrl}/functions/v1/enrich-taxon`;
        fetch(efUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${serviceRole}`,
          },
          body: JSON.stringify({ taxon_id: taxonId }),
        }).catch((err) => {
          console.warn(`[identify] enrich-taxon dispatch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
  }

  const responsePayload: Record<string, unknown> = { ...result };
  // #591: always include cascade_attempts for trace replay. Stub a single-
  // attempt array when the runner didn't go through the cascade path
  // (force_provider, default-race that didn't track attempts).
  responsePayload.cascade_attempts = cascadeAttempts
    ?? [{ provider: result.source, confidence: result.confidence }];
  // #693: surface which credential tier ultimately succeeded so the UI can
  // render correctly (e.g. "Identified via sponsorship" after BYO key 401).
  if (providerUsed) responsePayload.credential_used = providerUsed;

  return corsResponse(JSON.stringify(responsePayload), {
    headers: { 'content-type': 'application/json' },
  });
}

serve(handler);
