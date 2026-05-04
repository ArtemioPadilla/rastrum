/**
 * Placeholder label map for the distilled SpeciesNet ONNX classifier.
 *
 * ~20 representative Neotropical species from the iWildCam / camera-trap
 * domain. The real label map ships with the trained model — the training
 * pipeline emits a JSON file that replaces this array verbatim.
 *
 * Each entry maps a class index (output neuron) to taxonomy metadata.
 * The `index` field must be unique and contiguous starting from 0.
 */

export interface SpeciesNetLabel {
  index: number;
  scientific_name: string;
  common_name_en: string;
  common_name_es: string;
  family: string;
  kingdom: 'Animalia';
}

export const SPECIESNET_LABELS: readonly SpeciesNetLabel[] = [
  { index: 0,  scientific_name: 'Odocoileus virginianus',       common_name_en: 'White-tailed deer',              common_name_es: 'Venado cola blanca',       family: 'Cervidae',        kingdom: 'Animalia' },
  { index: 1,  scientific_name: 'Pecari tajacu',                common_name_en: 'Collared peccary',               common_name_es: 'Pecarí de collar',         family: 'Tayassuidae',     kingdom: 'Animalia' },
  { index: 2,  scientific_name: 'Nasua narica',                 common_name_en: 'White-nosed coati',              common_name_es: 'Coatí',                    family: 'Procyonidae',     kingdom: 'Animalia' },
  { index: 3,  scientific_name: 'Leopardus pardalis',           common_name_en: 'Ocelot',                         common_name_es: 'Ocelote',                  family: 'Felidae',         kingdom: 'Animalia' },
  { index: 4,  scientific_name: 'Herpailurus yagouaroundi',     common_name_en: 'Jaguarundi',                     common_name_es: 'Jaguarundi',               family: 'Felidae',         kingdom: 'Animalia' },
  { index: 5,  scientific_name: 'Panthera onca',                common_name_en: 'Jaguar',                         common_name_es: 'Jaguar',                   family: 'Felidae',         kingdom: 'Animalia' },
  { index: 6,  scientific_name: 'Dasypus novemcinctus',         common_name_en: 'Nine-banded armadillo',          common_name_es: 'Armadillo',                family: 'Dasypodidae',     kingdom: 'Animalia' },
  { index: 7,  scientific_name: 'Cuniculus paca',               common_name_en: 'Lowland paca',                   common_name_es: 'Tepezcuintle',             family: 'Cuniculidae',     kingdom: 'Animalia' },
  { index: 8,  scientific_name: 'Didelphis virginiana',         common_name_en: 'Virginia opossum',               common_name_es: 'Tlacuache',                family: 'Didelphidae',     kingdom: 'Animalia' },
  { index: 9,  scientific_name: 'Urocyon cinereoargenteus',     common_name_en: 'Gray fox',                       common_name_es: 'Zorra gris',               family: 'Canidae',         kingdom: 'Animalia' },
  { index: 10, scientific_name: 'Procyon lotor',                common_name_en: 'Raccoon',                        common_name_es: 'Mapache',                  family: 'Procyonidae',     kingdom: 'Animalia' },
  { index: 11, scientific_name: 'Sciurus aureogaster',          common_name_en: 'Red-bellied squirrel',           common_name_es: 'Ardilla',                  family: 'Sciuridae',       kingdom: 'Animalia' },
  { index: 12, scientific_name: 'Sylvilagus floridanus',        common_name_en: 'Eastern cottontail',             common_name_es: 'Conejo',                   family: 'Leporidae',       kingdom: 'Animalia' },
  { index: 13, scientific_name: 'Mephitis macroura',            common_name_en: 'Hooded skunk',                   common_name_es: 'Zorrillo',                 family: 'Mephitidae',      kingdom: 'Animalia' },
  { index: 14, scientific_name: 'Canis latrans',                common_name_en: 'Coyote',                         common_name_es: 'Coyote',                   family: 'Canidae',         kingdom: 'Animalia' },
  { index: 15, scientific_name: 'Puma concolor',                common_name_en: 'Puma',                           common_name_es: 'Puma',                     family: 'Felidae',         kingdom: 'Animalia' },
  { index: 16, scientific_name: 'Tapirus bairdii',              common_name_en: "Baird's tapir",                  common_name_es: 'Tapir',                    family: 'Tapiridae',       kingdom: 'Animalia' },
  { index: 17, scientific_name: 'Mazama temama',                common_name_en: 'Central American red brocket',   common_name_es: 'Temazate',                 family: 'Cervidae',        kingdom: 'Animalia' },
  { index: 18, scientific_name: 'Crax rubra',                   common_name_en: 'Great curassow',                 common_name_es: 'Hocofaisán',               family: 'Cracidae',        kingdom: 'Animalia' },
  { index: 19, scientific_name: 'Penelope purpurascens',        common_name_en: 'Crested guan',                   common_name_es: 'Pava cojolita',            family: 'Cracidae',        kingdom: 'Animalia' },
] as const;

/**
 * Look up a label by class index. Returns `undefined` for out-of-range
 * indices — callers should treat that as "unknown species".
 */
export function lookupSpeciesNetLabel(classIdx: number): SpeciesNetLabel | undefined {
  return SPECIESNET_LABELS.find(l => l.index === classIdx);
}
