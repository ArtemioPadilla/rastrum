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
