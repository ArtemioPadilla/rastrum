/**
 * PlantNet plugin (server-side via the identify Edge Function).
 *
 * The plugin doesn't call PlantNet directly — it calls the identify
 * Edge Function with `force_provider: 'plantnet'` so the server can
 * use the PLANTNET_API_KEY secret without ever exposing it to the client.
 */
import { getSupabase } from '../supabase';
import type { Identifier, IDResult, IdentifyInput } from './types';

export const plantNetIdentifier: Identifier = {
  id: 'plantnet',
  name: 'PlantNet',
  description: 'Plant identification by Pl@ntNet (free quota, plants only).',
  capabilities: {
    media: ['photo'],
    taxa: ['Plantae'],
    runtime: 'server',
    license: 'free-quota',
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    // We can't probe the server secret from the client; assume ready.
    // The Edge Function will return no_id_engine_available if PLANTNET_API_KEY is missing.
    return { ready: true };
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.media.kind !== 'url') {
      throw new Error('plantnet: requires media.kind=url (server-fetched)');
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('identify', {
      body: {
        observation_id: 'cascade-only',                  // ignored by the function when force_provider is set
        image_url: input.media.url,
        force_provider: 'plantnet',
        location: input.location,
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
