/**
 * "Why this species?" panel — pure helpers (issue #736).
 *
 * The panel itself lives in `src/components/WhyThisSpecies.astro`. This
 * module hosts the bits that benefit from being testable without a DOM
 * (provider-note picker, taxon resolver, reference-photo query).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Lang = 'en' | 'es';

export interface ProviderNote {
  /** Display name as shown in the chip. */
  name: string;
  /** Short, honest "what this model is good at" line. */
  note: string;
}

/**
 * Map a cascade plugin id to a one-liner about what the model is good at.
 * Intentionally short and honest — no marketing puffery, no hard claims.
 *
 * Pure: takes the plugin id and a language, returns display name + note.
 * Falls back to the raw id when unknown so the UI never silently drops.
 */
export function pickProviderNote(source: string, lang: Lang): ProviderNote {
  const isEs = lang === 'es';
  switch (source) {
    case 'plantnet':
      return {
        name: 'PlantNet',
        note: isEs
          ? 'Especializado en plantas. Bueno con morfología foliar y patrones de inflorescencia.'
          : 'Plant-specialised. Good at leaf morphology and flower-cluster patterns.',
      };
    case 'claude_haiku':
      return {
        name: 'Claude Haiku 4.5',
        note: isEs
          ? 'Modelo de lenguaje generalista. Bueno con forma, color y contexto cuando los modelos especializados no se deciden.'
          : 'Generalist language model. Good at shape, colour, and context when specialist models can\'t commit.',
      };
    case 'webllm_phi35_vision':
      return {
        name: 'Phi-3.5-vision',
        note: isEs
          ? 'IA en tu dispositivo. Sin entrenamiento taxonómico — trátalo como una pista, no como una sentencia.'
          : 'On-device AI. No taxonomic training — treat the answer as a hint, not a verdict.',
      };
    case 'onnx_gemma4_vision':
      return {
        name: 'Gemma 4 E2B',
        note: isEs
          ? 'IA en tu dispositivo (alterna a Phi). Sin entrenamiento taxonómico — pista, no sentencia.'
          : 'On-device AI (alternate to Phi). No taxonomic training — hint, not verdict.',
      };
    case 'birdnet':
      return {
        name: 'BirdNET',
        note: isEs
          ? 'Especializado en cantos de aves. Confiable cuando hay audio limpio.'
          : 'Bird-call specialist. Reliable when the audio is clean.',
      };
    case 'onnx_base':
      return {
        name: 'EfficientNet-Lite0',
        note: isEs
          ? 'Clasificador genérico de respaldo. Baja precisión, siempre disponible offline.'
          : 'Generic offline fallback. Low accuracy, always available.',
      };
    default:
      return {
        name: source,
        note: isEs
          ? 'Identificador no reconocido. Trátalo como una pista.'
          : 'Unknown identifier. Treat the answer as a hint.',
      };
  }
}

export interface TaxonTrait {
  taxon_id: string;
  lang: Lang;
  trait_marks: string[];
  source_url: string | null;
}

/**
 * Resolve a taxon_id from a scientific_name. The cascade returns the
 * name (not the id), but we need the id to query traits + reference
 * photos. Returns null when no taxa row matches yet (the row is
 * created lazily by the identifications trigger after observation save).
 */
export async function resolveTaxonId(
  supabase: SupabaseClient,
  scientificName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('taxa')
    .select('id')
    .eq('scientific_name', scientificName)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** Fetch the curated trait marks for one taxon × language. */
export async function fetchTaxonTraits(
  supabase: SupabaseClient,
  taxonId: string,
  lang: Lang,
): Promise<TaxonTrait | null> {
  const { data, error } = await supabase
    .from('taxon_traits')
    .select('taxon_id, lang, trait_marks, source_url')
    .eq('taxon_id', taxonId)
    .eq('lang', lang)
    .maybeSingle();
  if (error || !data) return null;
  return data as TaxonTrait;
}

export interface ReferencePhoto {
  observation_id: string;
  url: string;
}

/**
 * Fetch up to N research-grade reference photos for a taxon. Used to
 * paint the 4-thumb verification strip in the "Why this species?" panel.
 * Filters out video/audio media so we never render a black box.
 */
export async function fetchReferencePhotos(
  supabase: SupabaseClient,
  taxonId: string,
  limit = 4,
): Promise<ReferencePhoto[]> {
  const { data, error } = await supabase
    .from('observations')
    .select('id, media_files!inner(url, is_primary, media_type)')
    .eq('sync_status', 'synced')
    .eq('primary_taxon_id', taxonId)
    .order('observed_at', { ascending: false })
    .limit(limit * 4);
  if (error || !data) return [];
  type MediaRow = { url: string | null; is_primary: boolean | null; media_type: string | null };
  type ObsRow = { id: string; media_files: MediaRow[] | null };
  const rows = data as unknown as ObsRow[];
  const out: ReferencePhoto[] = [];
  for (const row of rows) {
    const media = (row.media_files ?? []).filter(
      (m) => m?.url && (!m.media_type || m.media_type === 'photo'),
    );
    if (media.length === 0) continue;
    const pick = media.find((m) => m.is_primary && m.url) ?? media.find((m) => m.url);
    if (!pick?.url) continue;
    out.push({ observation_id: row.id, url: pick.url });
    if (out.length >= limit) break;
  }
  return out;
}
