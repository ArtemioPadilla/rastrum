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
