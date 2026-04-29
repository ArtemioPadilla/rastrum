/**
 * Karma config seed data. The canonical runtime source of truth is the
 * `public.karma_config` and `public.karma_rarity_multipliers` DB tables
 * (added in PR8). This module is the seed manifest — values here are
 * inserted on first db-apply and preserved on replay. The admin console
 * reads from the DB tables, not from this module.
 *
 * The award_karma() SQL function remains the runtime write source for actual
 * karma deltas. A future PR can migrate it to read from `karma_config`.
 */
export interface KarmaReason {
  id: string;
  label_en: string;
  label_es: string;
  delta: number | null;
  description_en: string;
  description_es: string;
}

export const KARMA_REASONS: KarmaReason[] = [
  {
    id: 'observation_synced',
    label_en: 'Observation synced',
    label_es: 'Observación sincronizada',
    delta: 1,
    description_en: 'Awarded when a user syncs a new observation to the platform.',
    description_es: 'Otorgado cuando el usuario sincroniza una observación nueva.',
  },
  {
    id: 'consensus_win',
    label_en: 'Consensus win',
    label_es: 'Consenso ganador',
    // SQL: v_delta := 5 * rarity_mult * streak_mult * expertise_mult * conf_factor
    delta: 5,
    description_en: 'Base delta before rarity/streak/expertise/confidence multipliers. Awarded when the user\'s identification becomes the consensus pick.',
    description_es: 'Delta base antes de multiplicadores. Otorgado cuando la identificación del usuario llega al consenso.',
  },
  {
    id: 'consensus_loss',
    label_en: 'Consensus loss',
    label_es: 'Consenso perdido',
    // SQL: v_delta := -2 * LEAST(rarity_mult, 2.0) * conf_factor
    delta: -2,
    description_en: 'Base penalty before rarity/confidence multipliers (capped at 2×). Subtracted when another identification overrides the user\'s.',
    description_es: 'Penalización base antes de multiplicadores (máx 2×). Restado cuando otra identificación sobreescribe la del usuario.',
  },
  {
    id: 'first_in_rastrum',
    label_en: 'First in Rastrum',
    label_es: 'Primero en Rastrum',
    delta: 10,
    description_en: 'Awarded for the first observation of a taxon ever recorded on the platform.',
    description_es: 'Otorgado por la primera observación de un taxón registrada en la plataforma.',
  },
  {
    id: 'comment_reaction',
    label_en: 'Comment reaction',
    label_es: 'Reacción en comentario',
    delta: 0.5,
    description_en: 'Awarded when another user reacts positively to a comment.',
    description_es: 'Otorgado cuando otro usuario reacciona positivamente a un comentario.',
  },
  {
    id: 'manual_adjust',
    label_en: 'Manual adjustment',
    label_es: 'Ajuste manual',
    // Variable by design — admin sets the delta directly via add_karma_simple()
    delta: null,
    description_en: 'Admin-issued karma adjustment. Delta varies per case.',
    description_es: 'Ajuste de karma emitido por un administrador. El delta varía por caso.',
  },
];

export interface RarityMultiplier {
  bucket: 1 | 2 | 3 | 4 | 5;
  label_en: string;
  label_es: string;
  multiplier: number;
  description_en: string;
  description_es: string;
}

// Multipliers sourced from refresh_taxon_rarity() in supabase-schema.sql.
// Bucket 1 = top 10% most common; Bucket 5 = obs_count < 5 (ultra-rare).
export const RARITY_MULTIPLIERS: RarityMultiplier[] = [
  {
    bucket: 1,
    label_en: 'Very common (top 10%)',
    label_es: 'Muy común (top 10%)',
    multiplier: 1.0,
    description_en: 'Taxon in the top 10% most observed on the platform.',
    description_es: 'Taxón en el top 10% más observado en la plataforma.',
  },
  {
    bucket: 2,
    label_en: 'Common (50–90th pctile)',
    label_es: 'Común (percentil 50–90)',
    multiplier: 1.5,
    description_en: 'Taxon between the 50th and 90th percentile of observation frequency.',
    description_es: 'Taxón entre el percentil 50 y 90 de frecuencia de observación.',
  },
  {
    bucket: 3,
    label_en: 'Uncommon (10–50th pctile)',
    label_es: 'Poco común (percentil 10–50)',
    multiplier: 2.5,
    description_en: 'Taxon between the 10th and 50th percentile of observation frequency.',
    description_es: 'Taxón entre el percentil 10 y 50 de frecuencia de observación.',
  },
  {
    bucket: 4,
    label_en: 'Rare (bottom 10%)',
    label_es: 'Raro (10% inferior)',
    multiplier: 4.0,
    description_en: 'Taxon in the bottom 10% — rarely observed on the platform.',
    description_es: 'Taxón en el 10% inferior — raramente observado en la plataforma.',
  },
  {
    bucket: 5,
    label_en: 'Very rare (<5 obs)',
    label_es: 'Muy raro (<5 obs)',
    multiplier: 5.0,
    description_en: 'Taxon with fewer than 5 total observations on the platform.',
    description_es: 'Taxón con menos de 5 observaciones totales en la plataforma.',
  },
];
