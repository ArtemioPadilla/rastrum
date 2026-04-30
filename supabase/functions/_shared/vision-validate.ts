/**
 * Multi-provider credential validation. Each provider does a minimal
 * "1-token completion" probe to verify auth + endpoint reachability
 * before a credential is committed to Vault.
 *
 * Validators are pure thin wrappers over `vision-provider.ts`'s
 * `identify()` against a tiny fixture image — keeps the matrix of
 * auth shapes / response shapes in one place.
 */

import {
  buildProvider,
  type CredentialKind,
  type ResolvedCredential,
} from './vision-provider.ts';

export interface ValidationResult {
  valid: boolean;
  /** Provider/kind detected from the secret prefix (Anthropic legacy
   *  contract — other providers always pass `kind` in explicitly). */
  kind?: CredentialKind;
  error?: string;
}

const PREFIX_API_KEY     = 'sk-ant-api03-';
const PREFIX_OAT         = 'sk-ant-oat01-';
const PREFIX_OPENAI      = 'sk-';
const PREFIX_GEMINI      = 'AIza';

/** Best-effort prefix detection. Returns null when ambiguous (the
 *  caller should pass `kind` explicitly in that case). */
export function detectKind(secret: string): CredentialKind | null {
  if (secret.startsWith(PREFIX_API_KEY)) return 'api_key';
  if (secret.startsWith(PREFIX_OAT))     return 'oauth_token';
  // OpenAI keys also start with sk- (sk-proj-, sk-svcacct-, sk-…). Place after
  // the Anthropic prefixes so sk-ant-* is captured first.
  if (secret.startsWith(PREFIX_OPENAI))  return 'openai_api_key';
  if (secret.startsWith(PREFIX_GEMINI))  return 'gemini_api_key';
  // Bedrock + Vertex are JSON envelopes; we don't sniff them by prefix.
  if (secret.trimStart().startsWith('{')) return null;
  return null;
}

const PROBE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORk5CYII=';

/**
 * Validate a credential. Returns `{ valid: true }` if the provider's
 * endpoint accepted our auth + minimal request. The probe doesn't
 * care about the response — anything below 401/403 is a pass for our
 * purposes.
 */
export async function validateCredential(
  kind: CredentialKind,
  secret: string,
  opts: { model?: string; endpoint?: string | null } = {},
): Promise<ValidationResult> {
  // Compose the resolved credential. Pick a safe default model per
  // kind so the operator doesn't have to.
  const model = opts.model ?? defaultModelFor(kind);
  if (!model) return { valid: false, error: 'missing_model' };

  const cred: ResolvedCredential = {
    kind,
    secret,
    model,
    endpoint: opts.endpoint ?? null,
  };

  let provider;
  try {
    provider = buildProvider(cred);
  } catch (e) {
    return { valid: false, error: `unsupported_kind: ${(e as Error).message}` };
  }

  try {
    // For Bedrock / Vertex, parsing-failure is auth-failure equivalent.
    const result = await provider.identify({
      imageBase64: PROBE_IMAGE_BASE64,
      mimeType: 'image/png',
      systemPrompt: 'Reply with the single word OK and nothing else.',
      userText: 'OK?',
    });
    // We ignore the returned VisionResult — the success criterion is
    // that no exception was thrown and the provider didn't return
    // null due to a 401/403. A null result on a good auth path is
    // also acceptable (some providers refuse to identify a 1×1 PNG).
    void result;
    return { valid: true, kind };
  } catch (e) {
    return { valid: false, error: `network: ${(e as Error).message}` };
  }
}

/** Sensible default models so callers don't need to hard-code per kind. */
export function defaultModelFor(kind: CredentialKind): string | null {
  switch (kind) {
    case 'api_key':
    case 'oauth_token':     return 'claude-haiku-4-5-20251001';
    case 'bedrock':         return 'us.anthropic.claude-haiku-4-5-v1:0';
    case 'openai_api_key':  return 'gpt-4o-mini';
    case 'azure_openai':    return 'gpt-4o-mini';   // Azure deployment name; real value supplied by operator
    case 'gemini_api_key':  return 'gemini-2.0-flash-exp';
    case 'vertex_ai':       return 'projects/-/locations/us-central1/publishers/google/models/gemini-2.0-flash';
  }
}

/**
 * Backwards-compat: the existing `anthropic-validate.ts` exports
 * `validateAnthropicCredential(secret)` which sponsorships endpoint
 * still uses. Re-export the same name from here so an incremental
 * caller migration can happen without breaking the world.
 */
export async function validateAnthropicCredential(secret: string): Promise<ValidationResult> {
  const kind = detectKind(secret);
  if (kind !== 'api_key' && kind !== 'oauth_token') {
    return { valid: false, error: 'invalid_prefix' };
  }
  return validateCredential(kind, secret);
}
