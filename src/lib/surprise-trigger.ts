/**
 * Post-sync hook: maybe show a sorpresa de campo.
 *
 * Called from `syncOutboxInner` (sync.ts) after each successful row.
 * This module is the bridge between the pure picker (`./surprises.ts`)
 * and the side-effecting world (Supabase reads, the DOM event that
 * mounts the overlay, the daily-cap localStorage).
 *
 * Closes #727. Side effects are kept paranoid: any failure (RPC down,
 * RLS denial, malformed taxon row) is swallowed silently — a missed
 * surprise is invisible by definition. We never block sync.
 */

import {getCachedUser, getSupabase} from './supabase';
import {
  pickSurprise,
  dailyCapReached,
  recordShown,
  type PickInputs,
  type SurpriseCandidate,
} from './surprises';
import { resolveFact } from './surprise-facts';

const SURPRISE_SHOW_EVENT = 'rastrum:surprise-show';

interface UserPrefs {
  surprises_opt_in: boolean;
  region_primary: string | null;
  country_code: string | null;
  preferred_lang: 'en' | 'es';
}

/**
 * Resolve current locale. We honour the URL prefix when present,
 * otherwise fall back to `users.preferred_lang`. Pure UI thing —
 * the picker itself is locale-agnostic except for the body text.
 */
function currentLang(prefs: UserPrefs | null): 'en' | 'es' {
  if (typeof window !== 'undefined') {
    const seg = window.location.pathname.split('/')[1];
    if (seg === 'es') return 'es';
    if (seg === 'en') return 'en';
  }
  return prefs?.preferred_lang === 'es' ? 'es' : 'en';
}

async function fetchUserPrefs(): Promise<UserPrefs | null> {
  const supabase = getSupabase();
  try {
    const user = await getCachedUser();
    if (!user) return null;
    const { data } = await supabase
      .from('users')
      .select('surprises_opt_in, region_primary, country_code, preferred_lang')
      .eq('id', user.id)
      .maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      surprises_opt_in: row.surprises_opt_in === true,
      region_primary:   typeof row.region_primary === 'string' ? row.region_primary : null,
      country_code:     typeof row.country_code === 'string' ? row.country_code : null,
      preferred_lang:   row.preferred_lang === 'es' ? 'es' : 'en',
    };
  } catch {
    return null;
  }
}

interface ObsContext {
  observation_id: string;
  primary_taxon_id: string | null;
  scientific_name: string | null;
  common_name_es: string | null;
  common_name_en: string | null;
  rarity_bucket: 'common' | 'uncommon' | 'rare' | null;
}

async function fetchObsContext(observationId: string): Promise<ObsContext | null> {
  const supabase = getSupabase();
  try {
    const { data: obs } = await supabase
      .from('observations')
      .select('id, primary_taxon_id')
      .eq('id', observationId)
      .maybeSingle();
    if (!obs) return null;
    const obsRow = obs as { id: string; primary_taxon_id: string | null };

    let scientificName: string | null = null;
    let commonNameEs: string | null = null;
    let commonNameEn: string | null = null;
    let rarityBucket: 'common' | 'uncommon' | 'rare' | null = null;

    if (obsRow.primary_taxon_id) {
      const { data: taxa } = await supabase
        .from('taxa')
        .select('scientific_name, common_name_es, common_name_en')
        .eq('id', obsRow.primary_taxon_id)
        .maybeSingle();
      if (taxa) {
        const taxaRow = taxa as Record<string, unknown>;
        scientificName = typeof taxaRow.scientific_name === 'string' ? taxaRow.scientific_name : null;
        commonNameEs   = typeof taxaRow.common_name_es   === 'string' ? taxaRow.common_name_es   : null;
        commonNameEn   = typeof taxaRow.common_name_en   === 'string' ? taxaRow.common_name_en   : null;
      }
      const { data: rarity } = await supabase
        .from('taxon_rarity')
        .select('bucket')
        .eq('taxon_id', obsRow.primary_taxon_id)
        .maybeSingle();
      if (rarity) {
        const rarityRow = rarity as Record<string, unknown>;
        const b = rarityRow.bucket;
        if (b === 'common' || b === 'uncommon' || b === 'rare') rarityBucket = b;
      }
    }

    return {
      observation_id: observationId,
      primary_taxon_id: obsRow.primary_taxon_id,
      scientific_name: scientificName,
      common_name_es: commonNameEs,
      common_name_en: commonNameEn,
      rarity_bucket: rarityBucket,
    };
  } catch {
    return null;
  }
}

async function fetchActiveObserversToday(country: string | null): Promise<number> {
  if (!country) return 0;
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('community_active_observers_today', {
      p_country: country,
    });
    if (error) return 0;
    const n = typeof data === 'number' ? data : Number(data ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function regionLabel(prefs: UserPrefs): string | null {
  if (prefs.region_primary && prefs.region_primary.trim().length > 0) {
    return prefs.region_primary.trim();
  }
  if (prefs.country_code) return prefs.country_code;
  return null;
}

async function recordRemote(
  observationId: string,
  candidate: SurpriseCandidate,
): Promise<boolean> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('record_surprise_event', {
      p_observation_id: observationId,
      p_kind: candidate.kind,
      p_payload: candidate.payload,
    });
    if (error) return false;
    // RPC returns NULL when capped or opt-in off; treat that as a no-show
    return data !== null && data !== undefined;
  } catch {
    return false;
  }
}

function emitShow(candidate: SurpriseCandidate): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SURPRISE_SHOW_EVENT, {
    detail: {
      kind: candidate.kind,
      title: candidate.title,
      body:  candidate.body,
    },
  }));
}

/**
 * Public entry. Called once per successfully synced observation.
 * Best-effort: returns silently on any error. Never throws.
 */
export async function maybeShowSurpriseAfterSync(observationId: string): Promise<void> {
  if (typeof window === 'undefined') return;

  // Cheapest gate first: client-side daily cap.
  if (dailyCapReached()) return;

  const prefs = await fetchUserPrefs();
  if (!prefs || !prefs.surprises_opt_in) return;

  const lang = currentLang(prefs);
  const ctx = await fetchObsContext(observationId);
  if (!ctx) return;

  const fact = resolveFact(ctx.scientific_name);
  const activeCount = await fetchActiveObserversToday(prefs.country_code);

  const inputs: PickInputs = {
    seed: observationId,
    rarityBucket: ctx.rarity_bucket,
    factEs: fact?.es ?? null,
    factEn: fact?.en ?? null,
    scientificName: ctx.scientific_name,
    commonNameEs:   ctx.common_name_es,
    commonNameEn:   ctx.common_name_en,
    activeObserversToday: activeCount,
    regionLabel: regionLabel(prefs),
  };

  const candidate = pickSurprise(inputs, lang);
  if (!candidate) return;

  // Server-side cap check (atomic, race-free across tabs). Only show
  // when the row was actually inserted.
  const stored = await recordRemote(observationId, candidate);
  if (!stored) return;

  recordShown(candidate.kind);
  emitShow(candidate);
}

export { SURPRISE_SHOW_EVENT };
