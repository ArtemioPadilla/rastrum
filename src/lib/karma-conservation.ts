/**
 * Conservation status multipliers for karma rewards.
 * Observations of threatened species earn bonus karma.
 */

export type IUCNCategory = 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX' | 'DD' | 'NE';
export type NOM059Category = 'Pr' | 'A' | 'P' | 'E' | null;

export interface ConservationMultiplier {
  category: string;
  source: 'iucn' | 'nom059';
  multiplier: number;
  label_en: string;
  label_es: string;
}

export const IUCN_MULTIPLIERS: ConservationMultiplier[] = [
  { category: 'LC', source: 'iucn', multiplier: 1.0, label_en: 'Least Concern', label_es: 'Preocupación menor' },
  { category: 'NT', source: 'iucn', multiplier: 1.2, label_en: 'Near Threatened', label_es: 'Casi amenazada' },
  { category: 'VU', source: 'iucn', multiplier: 1.5, label_en: 'Vulnerable', label_es: 'Vulnerable' },
  { category: 'EN', source: 'iucn', multiplier: 2.0, label_en: 'Endangered', label_es: 'En peligro' },
  { category: 'CR', source: 'iucn', multiplier: 3.0, label_en: 'Critically Endangered', label_es: 'En peligro crítico' },
  { category: 'EW', source: 'iucn', multiplier: 5.0, label_en: 'Extinct in the Wild', label_es: 'Extinta en estado silvestre' },
  { category: 'DD', source: 'iucn', multiplier: 1.5, label_en: 'Data Deficient', label_es: 'Datos insuficientes' },
  { category: 'NE', source: 'iucn', multiplier: 1.0, label_en: 'Not Evaluated', label_es: 'No evaluada' },
];

export const NOM059_MULTIPLIERS: ConservationMultiplier[] = [
  { category: 'Pr', source: 'nom059', multiplier: 1.3, label_en: 'Subject to special protection', label_es: 'Sujeta a protección especial' },
  { category: 'A', source: 'nom059', multiplier: 1.8, label_en: 'Threatened', label_es: 'Amenazada' },
  { category: 'P', source: 'nom059', multiplier: 2.5, label_en: 'Endangered', label_es: 'En peligro de extinción' },
  { category: 'E', source: 'nom059', multiplier: 4.0, label_en: 'Probably extinct in the wild', label_es: 'Probablemente extinta en el medio silvestre' },
];

export function getConservationMultiplier(
  iucn: IUCNCategory | null,
  nom059: NOM059Category,
): { multiplier: number; source: string; label_en: string; label_es: string } {
  const iucnMult = iucn ? IUCN_MULTIPLIERS.find(m => m.category === iucn) : null;
  const nomMult = nom059 ? NOM059_MULTIPLIERS.find(m => m.category === nom059) : null;

  const iucnVal = iucnMult?.multiplier ?? 1.0;
  const nomVal = nomMult?.multiplier ?? 1.0;

  if (nomVal > iucnVal && nomMult) {
    return { multiplier: nomVal, source: `NOM-059 ${nom059}`, label_en: nomMult.label_en, label_es: nomMult.label_es };
  }
  if (iucnMult) {
    return { multiplier: iucnVal, source: `IUCN ${iucn}`, label_en: iucnMult.label_en, label_es: iucnMult.label_es };
  }
  return { multiplier: 1.0, source: 'none', label_en: 'Not assessed', label_es: 'No evaluada' };
}

/** Format the conservation bonus for the karma microcopy. */
export function conservationBonusText(
  multiplier: number,
  source: string,
  lang: 'en' | 'es',
): string | null {
  if (multiplier <= 1.0) return null;
  return lang === 'es'
    ? `×${multiplier} bono conservación (${source})`
    : `×${multiplier} conservation bonus (${source})`;
}
