/**
 * Claude Haiku 4.5 plugin (server-side via the identify Edge Function).
 *
 * Anthropic key is either:
 *  - The server's ANTHROPIC_API_KEY secret (operator pays), or
 *  - The user's BYO key (passed via byo_keys.anthropic).
 */
import { getSupabase } from '../supabase';
import type { Identifier, IDResult, IdentifyInput } from './types';

const BYO_KEY_STORAGE = 'rastrum.byoAnthropicKey';

function readByoKey(): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage.getItem(BYO_KEY_STORAGE) ?? undefined;
}

export const claudeIdentifier: Identifier = {
  id: 'claude_haiku',
  name: 'Claude Haiku 4.5 (Vision)',
  description: 'Anthropic Claude Haiku 4.5 with image input. Generalist; good for animals, fungi, indirect evidence. Uses your BYO key if set.',
  capabilities: {
    media: ['photo'],
    taxa: ['*'],
    runtime: 'server',
    license: 'byo-key',                  // operator may also configure ANTHROPIC_API_KEY
    cost_per_id_usd: 0.0028,
  },
  async isAvailable() {
    if (readByoKey()) return { ready: true };
    // We don't know about the server's env var; assume ready and let the
    // Edge Function tell us via the no_id_engine_available marker.
    return { ready: true };
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.media.kind !== 'url') {
      throw new Error('claude_haiku: requires media.kind=url');
    }
    const byo = input.byo_keys?.anthropic ?? readByoKey();
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('identify', {
      body: {
        observation_id: 'cascade-only',
        image_url: input.media.url,
        force_provider: 'claude_haiku',
        location: input.location,
        client_anthropic_key: byo,
      },
    });
    if (error) throw error;
    const r = data as Partial<IDResult> & { error?: string };
    if (r.error) throw new Error(r.error);
    return {
      scientific_name: r.scientific_name ?? '',
      common_name_en: r.common_name_en ?? null,
      common_name_es: r.common_name_es ?? null,
      family: r.family ?? null,
      kingdom: (r.kingdom as IDResult['kingdom']) ?? 'Unknown',
      confidence: r.confidence ?? 0,
      source: 'claude_haiku',
      raw: r.raw,
    };
  },
};
