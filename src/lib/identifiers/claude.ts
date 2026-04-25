/**
 * Claude Haiku 4.5 plugin (server-side via the identify Edge Function).
 *
 * Anthropic key is either:
 *  - The server's ANTHROPIC_API_KEY secret (operator pays), or
 *  - The user's BYO key (passed via byo_keys.anthropic).
 */
import { getSupabase } from '../supabase';
import { getKey } from '../byo-keys';
import type { Identifier, IDResult, IdentifyInput } from './types';

const PLUGIN_ID = 'claude_haiku';

export const claudeIdentifier: Identifier = {
  id: PLUGIN_ID,
  name: 'Claude Haiku 4.5 (Vision)',
  brand: '✨',
  description: 'Anthropic Claude Haiku 4.5 with vision input. Generalist — strong on animals, fungi, indirect evidence (tracks/scat/burrows). Bring your own API key to bill the cost to your account.',
  capabilities: {
    media: ['photo'],
    taxa: ['*'],
    runtime: 'server',
    license: 'byo-key',
    cost_per_id_usd: 0.0028,
  },
  keySpec: [{
    name: 'anthropic',
    label: 'Anthropic API key',
    placeholder: 'sk-ant-…',
    hint: 'Used per-call; never stored on our server. Each call costs ≈ $0.003.',
    pattern: /^sk-ant-[A-Za-z0-9_-]+$/,
    optional: true,
  }],
  setupSteps: [
    { text: 'Sign in to console.anthropic.com', link: 'https://console.anthropic.com' },
    { text: 'Click API Keys (left sidebar) → Create Key', link: 'https://console.anthropic.com/settings/keys' },
    { text: 'Name the key something like "rastrum-personal", scope it to "Default", click Create.' },
    { text: 'Copy the key (starts with sk-ant-…) — you can\'t see it again.', details: 'Free $5 credit at signup. After that, ~3,500 identifications per dollar.' },
    { text: 'Paste the key below and click Save.' },
  ],
  async isAvailable() {
    if (getKey(PLUGIN_ID, 'anthropic')) return { ready: true };
    return { ready: true };  // server fallback may exist
  },
  async testConnection() {
    const key = getKey(PLUGIN_ID, 'anthropic');
    if (!key) return { ok: false, message: 'No key set.' };
    // Cheapest possible probe: list models endpoint, 1-token response
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (res.ok) return { ok: true, message: 'Key reaches Anthropic.' };
      if (res.status === 401) return { ok: false, message: 'Key rejected (401).' };
      if (res.status === 429) return { ok: true, message: 'Key valid but rate-limited.' };
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Network error.' };
    }
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.media.kind !== 'url') {
      throw new Error('claude_haiku: requires media.kind=url');
    }
    const userKey = input.byo_keys?.anthropic ?? getKey(PLUGIN_ID, 'anthropic');
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('identify', {
      body: {
        observation_id: 'cascade-only',
        image_url: input.media.url,
        force_provider: 'claude_haiku',
        location: input.location,
        client_keys: userKey ? { anthropic: userKey } : undefined,
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
