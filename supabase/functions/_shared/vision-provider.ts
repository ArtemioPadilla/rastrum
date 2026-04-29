/**
 * Multi-provider vision abstraction (#116, #118).
 *
 * The cascade in `identify/index.ts` used to call `api.anthropic.com`
 * directly with a hard-coded model string. This module replaces that
 * with a `VisionProvider` interface so the same call site can speak
 * Anthropic-direct, AWS Bedrock, OpenAI / Azure OpenAI, Google Gemini
 * (direct), or Vertex AI — picked at runtime from the credential row.
 *
 * Each provider is responsible for:
 *   - building its own auth header / signing
 *   - encoding the image (base64 + mime type) into the provider's request format
 *   - normalising the JSON response into the shared `VisionResult` shape
 *
 * The biodiversity system prompt is shared across all providers so the
 * downstream parser sees the same shape regardless of vendor.
 */

export type CredentialKind =
  | 'api_key'              // Anthropic direct
  | 'oauth_token'          // Anthropic direct (OAT)
  | 'bedrock'              // AWS Bedrock IAM
  | 'openai_api_key'       // OpenAI direct
  | 'azure_openai'         // Azure OpenAI deployment
  | 'gemini_api_key'       // Google Gemini direct
  | 'vertex_ai';           // Google Vertex AI (service account)

export interface ResolvedCredential {
  kind: CredentialKind;
  /** The raw secret string. Format depends on `kind`. For Bedrock /
   *  Vertex AI this is a JSON document encoded as text. */
  secret: string;
  /** Provider-specific endpoint URL. Required for `azure_openai` and
   *  optional for `bedrock` (defaults to `bedrock-runtime.us-east-1`). */
  endpoint?: string | null;
  /** Model identifier as the provider expects it. */
  model: string;
}

export interface VisionResult {
  scientific_name: string;
  common_name_es: string | null;
  common_name_en: string | null;
  family: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Unknown';
  confidence: number;
  source: string;
  raw: unknown;
}

export interface VisionInput {
  imageBase64: string;
  mimeType: string;
  systemPrompt: string;
  userText: string;
  signal?: AbortSignal;
}

export interface VisionProvider {
  identify(input: VisionInput): Promise<VisionResult | null>;
}

/**
 * Build a provider for a given credential. Pure dispatcher — does
 * NOT touch network. Throws on unknown kinds so the cascade fails
 * fast instead of silently dropping a sponsorship credential.
 */
export function buildProvider(credential: ResolvedCredential): VisionProvider {
  switch (credential.kind) {
    case 'api_key':
    case 'oauth_token':     return new AnthropicProvider(credential);
    case 'bedrock':         return new BedrockProvider(credential);
    case 'openai_api_key':  return new OpenAIProvider(credential);
    case 'azure_openai':    return new AzureOpenAIProvider(credential);
    case 'gemini_api_key':  return new GeminiProvider(credential);
    case 'vertex_ai':       return new VertexAIProvider(credential);
    default: {
      const _exhaustive: never = credential.kind;
      throw new Error(`unknown credential kind: ${String(_exhaustive)}`);
    }
  }
}

/** Default biodiversity system prompt used by all providers. */
export const DEFAULT_SYSTEM_PROMPT = [
  'You are a field biologist assistant specializing in Mexican biodiversity.',
  'Identify the species in the photo. Respond ONLY with valid JSON matching the schema.',
  'If you cannot identify, set confidence to 0 and explain in notes.',
  'Focus on species found in Mexico, Central America, and the Caribbean.',
].join('\n');

export const RESPONSE_SCHEMA_HINT =
  '\n\nRespond with JSON only: {"scientific_name": "", "common_name_es": "", "common_name_en": "", "family": "", "kingdom": "Plantae|Animalia|Fungi|Unknown", "confidence": 0.0, "nom_059_status": null, "notes": null, "alternative_species": []}';

// ── Helpers ──────────────────────────────────────────────────────────

interface ParsedJson {
  scientific_name?: string;
  common_name_es?: string | null;
  common_name_en?: string | null;
  family?: string | null;
  kingdom?: VisionResult['kingdom'];
  confidence?: number;
}

/** Strip markdown code fences and parse the JSON body. Returns null
 *  if the response can't be parsed — never throws. */
export function parseModelJson(text: string): ParsedJson | null {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned) as ParsedJson;
  } catch {
    return null;
  }
}

/** Normalize a parsed JSON envelope into a VisionResult. Returns null
 *  if required fields are missing. */
export function toVisionResult(
  parsed: ParsedJson | null,
  source: string,
  raw: unknown,
): VisionResult | null {
  if (!parsed?.scientific_name) return null;
  return {
    scientific_name: parsed.scientific_name,
    common_name_es:  parsed.common_name_es ?? null,
    common_name_en:  parsed.common_name_en ?? null,
    family:          parsed.family ?? null,
    kingdom:         parsed.kingdom ?? 'Unknown',
    confidence:      typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    source,
    raw,
  };
}

// ── Anthropic direct ────────────────────────────────────────────────
class AnthropicProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  async identify(input: VisionInput): Promise<VisionResult | null> {
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    };
    if (this.cred.kind === 'oauth_token') headers['Authorization'] = `Bearer ${this.cred.secret}`;
    else                                  headers['x-api-key']     = this.cred.secret;

    const body = {
      model: this.cred.model,
      max_tokens: 512,
      system: [{ type: 'text', text: input.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.imageBase64 } },
          { type: 'text', text: input.userText + RESPONSE_SCHEMA_HINT },
        ],
      }],
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body), signal: input.signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as { content: Array<{ type: string; text?: string }> };
    const text = json.content?.find(c => c.type === 'text')?.text;
    if (!text) return null;
    return toVisionResult(parseModelJson(text), 'claude_haiku', json);
  }
}

// ── AWS Bedrock ─────────────────────────────────────────────────────
// Bedrock secret shape: JSON `{ region, accessKeyId, secretAccessKey, sessionToken? }`.
class BedrockProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  async identify(input: VisionInput): Promise<VisionResult | null> {
    const creds = parseBedrockSecret(this.cred.secret);
    if (!creds) return null;
    const region = this.cred.endpoint || creds.region || 'us-east-1';
    // Auto-translate Anthropic-direct shorthand → Bedrock model ID.
    // The shared `preferred_model` column defaults to
    // `claude-haiku-4-5`; a Bedrock credential created without an
    // explicit Bedrock model still routes correctly.
    const modelId = bedrockModelId(this.cred.model);
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 512,
      system: input.systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.imageBase64 } },
          { type: 'text',  text: input.userText + RESPONSE_SCHEMA_HINT },
        ],
      }],
    };
    const headers = await signAwsV4({
      method: 'POST',
      service: 'bedrock',
      region,
      url,
      body: JSON.stringify(body),
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    });
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: input.signal });
    if (!res.ok) return null;
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find(c => c.type === 'text')?.text;
    if (!text) return null;
    return toVisionResult(parseModelJson(text), 'bedrock', json);
  }
}

interface BedrockSecret {
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Translate the Anthropic-direct model shorthand into a Bedrock
 * model identifier. Pass-through for any string that already looks
 * like a Bedrock ID (contains `:` or starts with `us.`/`eu.`/`apac.`).
 *
 * Pure helper — exported for unit testing.
 */
export function bedrockModelId(model: string): string {
  if (!model) return 'us.anthropic.claude-haiku-4-5-v1:0';
  if (model.includes(':')) return model;                   // already a Bedrock ID
  if (/^(us|eu|apac)\./.test(model)) return model;         // already prefixed
  // Map a small set of known Anthropic shorthands → Bedrock equivalents.
  const map: Record<string, string> = {
    'claude-haiku-4-5':  'us.anthropic.claude-haiku-4-5-v1:0',
    'claude-sonnet-4-5': 'us.anthropic.claude-sonnet-4-5-v1:0',
    'claude-opus-4':     'us.anthropic.claude-opus-4-v1:0',
  };
  return map[model] ?? model;
}

export function parseBedrockSecret(secret: string): BedrockSecret | null {
  try {
    const o = JSON.parse(secret) as Partial<BedrockSecret>;
    if (typeof o.accessKeyId !== 'string' || typeof o.secretAccessKey !== 'string') return null;
    return {
      region: o.region,
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      sessionToken: o.sessionToken,
    };
  } catch {
    return null;
  }
}

/** Minimal AWS Sig V4 signer for the Bedrock InvokeModel POST. We
 *  hand-roll this to avoid pulling the full AWS SDK into the Edge
 *  Function bundle. The request shape (single POST with JSON body) is
 *  narrow enough that we don't need full SDK generality. */
async function signAwsV4(args: {
  method: string; service: string; region: string; url: string; body: string;
  accessKeyId: string; secretAccessKey: string; sessionToken?: string;
}): Promise<Record<string, string>> {
  const u = new URL(args.url);
  const now = new Date();
  const amzDate    = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp  = amzDate.slice(0, 8);
  const host       = u.host;
  const payloadHash = await sha256Hex(args.body);
  const canonicalUri = u.pathname.replace(/%2F/g, '/');  // bedrock keeps slashes
  const canonicalRequest = [
    args.method,
    canonicalUri,
    '',                              // query string is empty
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    args.sessionToken ? `x-amz-security-token:${args.sessionToken}` : '',
    '',
    args.sessionToken
      ? 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
      : 'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].filter((line, i, arr) => !(line === '' && arr[i + 1] === '')).join('\n');

  const credentialScope = `${dateStamp}/${args.region}/${args.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate    = await hmacRaw(`AWS4${args.secretAccessKey}`, dateStamp);
  const kRegion  = await hmacRaw(kDate,    args.region);
  const kService = await hmacRaw(kRegion,  args.service);
  const kSigning = await hmacRaw(kService, 'aws4_request');
  const signature = bytesToHex(await hmacRaw(kSigning, stringToSign));
  const signedHeaders = args.sessionToken
    ? 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    : 'host;x-amz-content-sha256;x-amz-date';
  const auth = `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const out: Record<string, string> = {
    Authorization: auth,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (args.sessionToken) out['X-Amz-Security-Token'] = args.sessionToken;
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(buf));
}
async function hmacRaw(key: string | Uint8Array, msg: string): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const k = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── OpenAI direct ───────────────────────────────────────────────────
class OpenAIProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  async identify(input: VisionInput): Promise<VisionResult | null> {
    const url = (this.cred.endpoint && this.cred.endpoint.length > 0)
      ? this.cred.endpoint
      : 'https://api.openai.com/v1/chat/completions';
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.cred.secret}`,
      'Content-Type':  'application/json',
    };
    return await callOpenAICompatible(url, headers, this.cred.model, input, 'openai');
  }
}

// ── Azure OpenAI ─────────────────────────────────────────────────────
// `endpoint` is the full deployment URL, e.g.
//   https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-01
// `model` is unused for the request body (Azure routes by deployment name in the URL).
class AzureOpenAIProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  async identify(input: VisionInput): Promise<VisionResult | null> {
    const url = this.cred.endpoint ?? '';
    if (!url) return null;
    const headers: Record<string, string> = {
      'api-key':      this.cred.secret,
      'Content-Type': 'application/json',
    };
    return await callOpenAICompatible(url, headers, this.cred.model || 'azure', input, 'azure_openai');
  }
}

async function callOpenAICompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  input: VisionInput,
  source: string,
): Promise<VisionResult | null> {
  const body = {
    model,
    max_tokens: 512,
    messages: [
      { role: 'system', content: input.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text',      text: input.userText + RESPONSE_SCHEMA_HINT },
          { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` } },
        ],
      },
    ],
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: input.signal });
  if (!res.ok) return null;
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) return null;
  return toVisionResult(parseModelJson(text), source, json);
}

// ── Google Gemini direct ────────────────────────────────────────────
class GeminiProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  async identify(input: VisionInput): Promise<VisionResult | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.cred.model)}:generateContent?key=${encodeURIComponent(this.cred.secret)}`;
    return await callGeminiCompatible(url, {}, input, 'gemini');
  }
}

class VertexAIProvider implements VisionProvider {
  constructor(private readonly cred: ResolvedCredential) {}

  // Vertex AI requires an OAuth2 access token derived from a service-
  // account JSON. Deriving the JWT inside an Edge Function is non-
  // trivial; v1 expects the operator to mint the access token offline
  // and store it as `secret`. We bump validity in the validator (see
  // vision-validate.ts).
  async identify(input: VisionInput): Promise<VisionResult | null> {
    const region = this.cred.endpoint || 'us-central1';
    const url = `https://${region}-aiplatform.googleapis.com/v1/${this.cred.model}:streamGenerateContent`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.cred.secret}`,
      'Content-Type':  'application/json',
    };
    return await callGeminiCompatible(url, headers, input, 'vertex_ai');
  }
}

async function callGeminiCompatible(
  url: string,
  headers: Record<string, string>,
  input: VisionInput,
  source: string,
): Promise<VisionResult | null> {
  const body = {
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { text: input.userText + RESPONSE_SCHEMA_HINT },
        { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } },
      ],
    }],
    generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!res.ok) return null;
  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
  if (!text) return null;
  return toVisionResult(parseModelJson(text), source, json);
}
