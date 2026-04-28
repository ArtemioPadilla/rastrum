/**
 * expertise-legends.ts — helpers for regional expertise rankings.
 *
 * Wraps the `user_expertise_regional` view and `top_expertise_legend()`
 * SQL function introduced in Module 27.
 */
import { getSupabase } from './supabase';

export type ExpertiseTier = 'legend' | 'expert' | 'reference' | 'active';

export interface ExpertiseLegend {
  taxon_name:   string;
  taxon_family: string;
  taxon_rank:   string;
  region:       string;
  score:        number;
  region_rank:  number;
  tier:         ExpertiseTier;
}

export interface ExpertiseCoverageRow {
  taxon_name:   string;
  taxon_family: string;
  taxon_rank:   string;
  region:       string;
  score:        number;
  region_rank:  number;
  national_rank: number;
  tier:         ExpertiseTier;
}

/** Human-readable rank label. EN/ES. */
export function tierLabel(tier: ExpertiseTier, lang: 'en' | 'es'): string {
  const labels: Record<ExpertiseTier, Record<'en' | 'es', string>> = {
    legend:    { en: '🥇 Regional legend', es: '🥇 Leyenda regional' },
    expert:    { en: '🥈 Regional expert',  es: '🥈 Experto regional' },
    reference: { en: '🥉 Reference',        es: '🥉 Referente' },
    active:    { en: '⭐ Active identifier', es: '⭐ Identificador activo' },
  };
  return labels[tier][lang];
}

/** Badge title shown on profile, e.g. "Top identificador de Fabaceae en Oaxaca" */
export function legendTitle(leg: ExpertiseLegend, lang: 'en' | 'es'): string {
  if (lang === 'es') {
    if (leg.region_rank === 1)   return `Top identificador de ${leg.taxon_family} en ${leg.region}`;
    if (leg.region_rank <= 3)    return `Experto en ${leg.taxon_family} — ${leg.region}`;
    if (leg.region_rank <= 10)   return `Referente en ${leg.taxon_family} — ${leg.region}`;
    return `Identificador activo en ${leg.taxon_family}`;
  }
  if (leg.region_rank === 1)   return `Top identifier for ${leg.taxon_family} in ${leg.region}`;
  if (leg.region_rank <= 3)    return `Expert in ${leg.taxon_family} — ${leg.region}`;
  if (leg.region_rank <= 10)   return `Reference for ${leg.taxon_family} — ${leg.region}`;
  return `Active identifier for ${leg.taxon_family}`;
}

/** Tier color classes for Tailwind. */
export function tierColors(tier: ExpertiseTier): { bg: string; text: string; border: string } {
  const map: Record<ExpertiseTier, { bg: string; text: string; border: string }> = {
    legend:    { bg: 'bg-yellow-50 dark:bg-yellow-900/20',  text: 'text-yellow-800 dark:text-yellow-300',  border: 'border-yellow-400' },
    expert:    { bg: 'bg-zinc-100 dark:bg-zinc-800',        text: 'text-zinc-700 dark:text-zinc-200',       border: 'border-zinc-400' },
    reference: { bg: 'bg-amber-50 dark:bg-amber-900/20',    text: 'text-amber-800 dark:text-amber-300',     border: 'border-amber-400' },
    active:    { bg: 'bg-emerald-50 dark:bg-emerald-900/20',text: 'text-emerald-800 dark:text-emerald-300', border: 'border-emerald-400' },
  };
  return map[tier];
}

/** Fetch the single top legend for a user (for the profile badge). */
export async function getTopLegend(userId: string): Promise<ExpertiseLegend | null> {
  const { data, error } = await getSupabase()
    .rpc('top_expertise_legend', { p_user_id: userId });
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    taxon_name:   row.taxon_name,
    taxon_family: row.taxon_family,
    taxon_rank:   row.taxon_rank,
    region:       row.region,
    score:        Number(row.score),
    region_rank:  Number(row.region_rank),
    tier:         row.tier as ExpertiseTier,
  };
}

/** Fetch all expertise rows for a user (for the coverage grid). */
export async function getExpertiseCoverage(userId: string): Promise<ExpertiseCoverageRow[]> {
  const { data, error } = await getSupabase()
    .from('user_expertise_regional')
    .select('taxon_name,taxon_family,taxon_rank,region,score,region_rank,national_rank')
    .eq('user_id', userId)
    .order('score', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map(r => ({
    taxon_name:    r.taxon_name,
    taxon_family:  r.taxon_family,
    taxon_rank:    r.taxon_rank,
    region:        r.region,
    score:         Number(r.score),
    region_rank:   Number(r.region_rank),
    national_rank: Number(r.national_rank),
    tier: (
      Number(r.region_rank) === 1  ? 'legend' :
      Number(r.region_rank) <= 3   ? 'expert' :
      Number(r.region_rank) <= 10  ? 'reference' : 'active'
    ) as ExpertiseTier,
  }));
}
