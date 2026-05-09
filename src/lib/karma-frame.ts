export type KarmaTierId =
  | 'seedling'
  | 'observer'
  | 'naturalist'
  | 'expert'
  | 'master'
  | 'legend';

export interface KarmaTier {
  id: KarmaTierId;
  min: number;
  ringClass: string;
  glow?: boolean;
}

const TIERS: readonly KarmaTier[] = [
  {
    id: 'seedling',
    min: 0,
    ringClass: 'ring-2 ring-emerald-500',
  },
  {
    id: 'observer',
    min: 100,
    ringClass: 'ring-2 ring-teal-500',
  },
  {
    id: 'naturalist',
    min: 500,
    ringClass: 'ring-2 ring-amber-500',
  },
  {
    id: 'expert',
    min: 1000,
    ringClass: 'ring-2 ring-sky-500 motion-safe:animate-pulse',
    glow: true,
  },
  {
    id: 'master',
    min: 5000,
    ringClass: 'ring-4 ring-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)] motion-safe:animate-pulse',
    glow: true,
  },
  {
    id: 'legend',
    min: 10000,
    ringClass: 'ring-4 ring-fuchsia-500 shadow-[0_0_16px_rgba(217,70,239,0.7)] motion-safe:animate-rastrum-legend-spin',
    glow: true,
  },
];

export function tierForKarma(total: number): KarmaTier {
  const safe = Number.isFinite(total) && total >= 0 ? total : 0;
  let match = TIERS[0];
  for (const tier of TIERS) {
    if (safe >= tier.min) match = tier;
  }
  return match;
}

export function allKarmaTiers(): readonly KarmaTier[] {
  return TIERS;
}
