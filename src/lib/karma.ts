export type Bucket = 1 | 2 | 3 | 4 | 5;

export interface RarityBucket {
  bucket: Bucket;
  multiplier: number;
  label_en: string;
  label_es: string;
}

export const RARITY_BUCKETS: readonly RarityBucket[] = [
  { bucket: 1, multiplier: 1.0, label_en: 'common',     label_es: 'común' },
  { bucket: 2, multiplier: 1.5, label_en: 'frequent',   label_es: 'frecuente' },
  { bucket: 3, multiplier: 2.5, label_en: 'uncommon',   label_es: 'poco común' },
  { bucket: 4, multiplier: 4.0, label_en: 'rare',       label_es: 'raro' },
  { bucket: 5, multiplier: 5.0, label_en: 'ultra-rare', label_es: 'rarísimo' },
] as const;

export function rarityTier(bucket: Bucket): string {
  return '★'.repeat(bucket);
}

export function formatDelta(n: number): string {
  const r = Math.round(n);
  return r >= 0 ? `+${r}` : String(r);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

export interface VoteMicrocopyInput {
  lang: 'en' | 'es';
  bucket: Bucket;
  multiplier: number;
  expertiseLevel: string | null;
  expertiseWeight: number;
  streakMultiplier: number;
  confidence: 0.5 | 0.7 | 0.9;
  inGrace: boolean;
  graceDaysLeft?: number;
}

export function microcopyForVote(i: VoteMicrocopyInput): string {
  const stars = rarityTier(i.bucket);
  const confFactor = i.confidence >= 0.85 ? 1.0 : i.confidence >= 0.65 ? 0.7 : 0.4;
  const win = 5 * i.multiplier * i.streakMultiplier * confFactor;
  const lossRarity = Math.min(i.multiplier, 2.0);
  const loss = -2 * lossRarity * confFactor;

  if (i.inGrace) {
    if (i.lang === 'es') {
      return `🎓 Estás en periodo de aprendizaje (${i.graceDaysLeft ?? '?'} días restantes) — votar no resta karma.`;
    }
    return `🎓 You're in your learning period (${i.graceDaysLeft ?? '?'} days left) — losses do not subtract karma.`;
  }

  const level = i.expertiseLevel ?? (i.lang === 'es' ? 'sin especialidad' : 'no expertise');

  if (i.lang === 'es') {
    return `Rareza ${stars} — tu voto pesa ${i.expertiseWeight.toFixed(1)}× en ${level} · acertar: ${formatDelta(win)} / fallar: ${formatDelta(loss)}.`;
  }
  return `Rarity ${stars} — your vote weighs ${i.expertiseWeight.toFixed(1)}× in ${level} · win: ${formatDelta(win)} / lose: ${formatDelta(loss)}.`;
}
