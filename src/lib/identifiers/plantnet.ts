/**
 * PlantNet plugin (server-side via the identify Edge Function).
 *
 * The plugin doesn't call PlantNet directly — it calls the identify
 * Edge Function with `force_provider: 'plantnet'`. Users can supply
 * their own PlantNet API key (separate quota from the operator's),
 * and the function uses it for that single call.
 */
import { getSupabase } from '../supabase';
import { getKey } from '../byo-keys';
import type { Identifier, IDResult, IdentifyInput } from './types';

const PLUGIN_ID = 'plantnet';

export const plantNetIdentifier: Identifier = {
  id: PLUGIN_ID,
  name: 'PlantNet',
  brand: '🌿',
  description: 'Plant identification by Pl@ntNet — specialised on plants and fungi. Free quota; bring your own key for higher daily limits.',
  capabilities: {
    media: ['photo'],
    taxa: ['Plantae'],
    runtime: 'server',
    license: 'free-quota',
    cost_per_id_usd: 0,
  },
  keySpec: [{
    name: 'plantnet',
    label: 'PlantNet API key',
    placeholder: '2b10…',
    hint: 'Optional. Your own key gets your own 500/day free quota.',
    pattern: /^[A-Za-z0-9]{16,}$/,
    optional: true,
  }],
  setupSteps: [
    { text: 'Create a free PlantNet account', link: 'https://my.plantnet.org/signup' },
    { text: 'Open My Pl@ntNet → API → My API keys', link: 'https://my.plantnet.org/account/projects' },
    { text: 'Click "Create new project", give it a name like "rastrum-personal", copy the API key.' },
    { text: 'Paste the key below and click Save.', details: '500 identifications per day on the free tier — separate from any other user’s quota.' },
  ],
  async isAvailable() {
    return { ready: true };   // server may have its own key; assume usable
  },
  async testConnection() {
    const key = getKey(PLUGIN_ID, 'plantnet');
    if (!key) return { ok: false, message: 'No key set.' };
    // Cheap probe: hit the project list endpoint (free, no observation cost).
    try {
      const res = await fetch(`https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&nb-results=1`, {
        method: 'OPTIONS',
      });
      if (res.status === 200 || res.status === 204) return { ok: true, message: 'Key reaches PlantNet.' };
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Key rejected.' };
      return { ok: true, message: `HTTP ${res.status} — assume usable.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Network error.' };
    }
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.media.kind !== 'url') {
      throw new Error('plantnet: requires media.kind=url');
    }
    const supabase = getSupabase();
    const userKey = input.byo_keys?.plantnet ?? getKey(PLUGIN_ID, 'plantnet');
    const { data, error } = await supabase.functions.invoke('identify', {
      body: {
        observation_id: 'cascade-only',
        image_url: input.media.url,
        force_provider: 'plantnet',
        location: input.location,
        client_keys: userKey ? { plantnet: userKey } : undefined,
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
      kingdom: (r.kingdom as IDResult['kingdom']) ?? 'Plantae',
      confidence: r.confidence ?? 0,
      source: 'plantnet',
      raw: r.raw,
    };
  },
};
