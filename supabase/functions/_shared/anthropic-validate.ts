export interface ValidationResult {
  valid: boolean;
  kind?: 'api_key' | 'oauth_token';
  error?: string;
}

const PREFIX_API_KEY = 'sk-ant-api03-';
const PREFIX_OAT     = 'sk-ant-oat01-';

export function detectKind(secret: string): 'api_key' | 'oauth_token' | null {
  if (secret.startsWith(PREFIX_API_KEY)) return 'api_key';
  if (secret.startsWith(PREFIX_OAT))     return 'oauth_token';
  return null;
}

export type AnyCredentialKind =
  | 'api_key' | 'oauth_token'
  | 'bedrock' | 'openai_api_key' | 'azure_openai'
  | 'gemini_api_key' | 'vertex_ai';

/**
 * Detect credential kind for any supported provider (M32 multi-provider).
 * Returns null only when the prefix is truly unrecognized.
 */
export function detectAnyKind(secret: string): AnyCredentialKind | null {
  // Anthropic
  if (secret.startsWith(PREFIX_API_KEY)) return 'api_key';
  if (secret.startsWith(PREFIX_OAT))     return 'oauth_token';
  // OpenAI
  if (secret.startsWith('sk-'))          return 'openai_api_key';
  // Google AI (Gemini)
  if (secret.startsWith('AIza'))         return 'gemini_api_key';
  // AWS Bedrock — access key format AKIA… or ASIA…
  if (/^AKIA[0-9A-Z]{16}$/.test(secret) || /^ASIA[0-9A-Z]{16}$/.test(secret)) return 'bedrock';
  // Azure OpenAI — 32-char hex key
  if (/^[0-9a-f]{32}$/.test(secret))     return 'azure_openai';
  // Vertex AI — service account JSON or access token (longer, starts with 'ya29.')
  if (secret.startsWith('ya29.'))        return 'vertex_ai';
  // Allow manual kind override via prefix hint 'bedrock:', 'vertex:', etc.
  if (secret.startsWith('bedrock:'))     return 'bedrock';
  if (secret.startsWith('vertex:'))      return 'vertex_ai';
  if (secret.startsWith('azure:'))       return 'azure_openai';
  return null;
}

export async function validateAnthropicCredential(secret: string): Promise<ValidationResult> {
  const kind = detectKind(secret);
  if (!kind) return { valid: false, error: 'invalid_prefix' };

  const headers: HeadersInit = {
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
  if (kind === 'api_key') (headers as Record<string, string>)['x-api-key'] = secret;
  else                    (headers as Record<string, string>)['Authorization'] = `Bearer ${secret}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'auth_failed' };
    return { valid: true, kind };
  } catch (e) {
    return { valid: false, error: `network: ${(e as Error).message}` };
  }
}
