export type SpeciesPillInput = {
  rarity_bucket: number | null;
  endemic_mx: boolean | null;
  nom059_status: string | null;
};

export type PillTone = 'amber' | 'amber-light' | 'lime' | 'orange';
export type PillKind = 'rarity-rare' | 'rarity-notable' | 'endemic' | 'nom059';

export type Pill = {
  kind: PillKind;
  label: string;
  tone: PillTone;
};

const NOM059_THREATENED = new Set([
  'sujeta_proteccion',
  'amenazada',
  'peligro_extincion',
]);

export function pillForSpecies(input: SpeciesPillInput): Pill | null {
  const bucket = input.rarity_bucket ?? 1;
  if (bucket >= 4) {
    return { kind: 'rarity-rare', label: `rarity_${bucket}`, tone: 'amber' };
  }
  if (input.endemic_mx === true) {
    return { kind: 'endemic', label: 'endemic_mx', tone: 'lime' };
  }
  if (input.nom059_status && NOM059_THREATENED.has(input.nom059_status)) {
    return { kind: 'nom059', label: 'nom059', tone: 'orange' };
  }
  if (bucket === 3) {
    return { kind: 'rarity-notable', label: `rarity_${bucket}`, tone: 'amber-light' };
  }
  return null;
}
