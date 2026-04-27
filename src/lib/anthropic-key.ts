/**
 * Resolve an Anthropic API key from the project's three-tier chain:
 *   1. runtime injection (`window.__RASTRUM_ANTHROPIC_KEY__`)
 *   2. build-time env (`import.meta.env.PUBLIC_ANTHROPIC_KEY`)
 *   3. localStorage BYO key (`claude_haiku.anthropic`)
 *
 * The project-wide key is **optional** and unset by default for the
 * zero-cost target. When configured, it lets first-time visitors get an
 * instant Claude vision identification without setting up a BYO key.
 *
 * Privacy: a project key is operator-scoped (operator pays). A BYO key
 * never leaves the user's device except in the `Authorization` header
 * of a single Anthropic API call.
 */
export interface AnthropicKeyResolution {
  key: string;
  source: 'runtime' | 'project' | 'byo' | 'none';
}

interface RuntimeWindow {
  __RASTRUM_ANTHROPIC_KEY__?: string;
}

export async function resolveAnthropicKey(): Promise<AnthropicKeyResolution> {
  // 1. Runtime injection — set by an inline <script> for testing/preview deploys.
  if (typeof window !== 'undefined') {
    const w = window as unknown as RuntimeWindow;
    const injected = w.__RASTRUM_ANTHROPIC_KEY__;
    if (typeof injected === 'string' && injected.trim() !== '') {
      return { key: injected, source: 'runtime' };
    }
  }

  // 2. Build-time env — operator-set in deploy.yml.
  const envKey = (import.meta.env.PUBLIC_ANTHROPIC_KEY as string | undefined) ?? '';
  if (envKey.trim() !== '') {
    return { key: envKey, source: 'project' };
  }

  // 3. localStorage BYO — user-set in Profile → Edit.
  try {
    const { getKey } = await import('./byo-keys');
    const byo = getKey('claude_haiku', 'anthropic');
    if (byo && byo.trim() !== '') return { key: byo, source: 'byo' };
  } catch {
    /* localStorage unavailable */
  }

  return { key: '', source: 'none' };
}

/** True when at least one Anthropic key is resolvable. */
export async function hasAnthropicKey(): Promise<boolean> {
  const r = await resolveAnthropicKey();
  return r.key !== '';
}

export type KeyValidationResult =
  | { valid: true; status: number }
  | { valid: false; status: number; reason: 'auth' | 'network' | 'shape' | 'other'; message: string };

/**
 * Live-test an Anthropic key with a 1-token `messages` call. Used by
 * the onboarding flow to give users an immediate "your key works"
 * signal. Costs effectively nothing per call (max_tokens=1).
 *
 * Returns `{valid:false, reason:'shape'}` without hitting the network
 * if the key obviously isn't an Anthropic key. Returns `reason:'auth'`
 * for 401/403, `reason:'network'` if the request couldn't complete.
 */
export async function validateAnthropicKey(
  key: string,
  opts?: { signal?: AbortSignal },
): Promise<KeyValidationResult> {
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) {
    return { valid: false, status: 0, reason: 'shape', message: 'Invalid key format' };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: opts?.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.ok) return { valid: true, status: res.status };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, status: res.status, reason: 'auth', message: `HTTP ${res.status}` };
    }
    return { valid: false, status: res.status, reason: 'other', message: `HTTP ${res.status}` };
  } catch (err) {
    return {
      valid: false,
      status: 0,
      reason: 'network',
      message: err instanceof Error ? err.message : 'network error',
    };
  }
}
