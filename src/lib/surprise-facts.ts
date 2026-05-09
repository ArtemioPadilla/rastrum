/**
 * Curated facts for `dato_curioso`. Bilingual EN/ES. Indexed by
 * scientific name (case-insensitive) with a generic locale fallback
 * so any species can fire a "did you know" — but only when we have
 * something honest to say.
 *
 * Wikidata-style summaries are a v1.1 follow-up (issue #727 carries
 * the broader catalog). For v1 we ship a hand-picked seed of LATAM-
 * relevant species + a grab-bag of generic "biodiversity" facts.
 *
 * Editing rules:
 *   - Keep facts factually true. No embellishment. Cite a source if
 *     it might be questioned.
 *   - Keep each ≤ 220 chars to fit the overlay without scrolling on
 *     a 360 px wide screen.
 *   - EN + ES required for every entry.
 */

export interface Fact {
  es: string;
  en: string;
}

const SPECIES_FACTS: Readonly<Record<string, Fact>> = {
  // LATAM seeds — easily expanded as observations roll in.
  'panthera onca': {
    es: 'El jaguar es el felino más grande de América y el tercero del mundo. Su mordida puede atravesar el caparazón de una tortuga.',
    en: 'The jaguar is the largest cat in the Americas and the third-largest in the world. Its bite can pierce a turtle shell.',
  },
  'pharomachrus mocinno': {
    es: 'El quetzal pierde y regenera las plumas largas de su cola cada temporada reproductiva — único entre las aves trogoniformes.',
    en: 'The resplendent quetzal sheds and regrows its long tail-coverts every breeding season — unique among trogons.',
  },
  'ambystoma mexicanum': {
    es: 'El ajolote retiene rasgos larvarios toda su vida (neotenia) y puede regenerar extremidades, branquias y partes de su corazón.',
    en: 'The axolotl keeps larval traits its whole life (neoteny) and can regenerate limbs, gills, and parts of its heart.',
  },
  'phocoena sinus': {
    es: 'La vaquita marina solo vive en el norte del Golfo de California. Es el cetáceo más amenazado del planeta.',
    en: 'The vaquita lives only in the northern Gulf of California. It is the most endangered cetacean on Earth.',
  },
  'ara macao': {
    es: 'La guacamaya roja puede vivir más de 60 años en estado silvestre y forma parejas que duran toda la vida.',
    en: 'The scarlet macaw can live more than 60 years in the wild and forms lifelong pair bonds.',
  },
  'tapirus bairdii': {
    es: 'El tapir centroamericano es el mamífero terrestre más grande de Mesoamérica y un dispersor clave de semillas grandes.',
    en: 'The Baird tapir is Mesoamerica largest land mammal and a key disperser of large seeds.',
  },
  'mimus polyglottos': {
    es: 'El cenzontle puede aprender e imitar más de 200 sonidos distintos a lo largo de su vida.',
    en: 'The northern mockingbird can learn and imitate more than 200 distinct sounds over its lifetime.',
  },
};

const GENERIC_FACTS: ReadonlyArray<Fact> = [
  {
    es: 'Cada observación con foto y GPS aporta a la red GBIF y se vuelve evidencia citable en publicaciones científicas.',
    en: 'Every observation with a photo and GPS feeds the GBIF network and becomes citable evidence in scientific publications.',
  },
  {
    es: 'América Latina concentra cerca del 60 % de la biodiversidad terrestre del planeta.',
    en: 'Latin America holds about 60 % of the planet terrestrial biodiversity.',
  },
  {
    es: 'Las observaciones casuales — incluso una sola foto — han descrito especies que las expediciones formales no registraron.',
    en: 'Casual observations — even a single photo — have documented species that formal expeditions had missed.',
  },
  {
    es: 'México alberga más de 200 000 especies, lo que lo coloca entre los cinco países megadiversos del mundo.',
    en: 'Mexico harbors more than 200,000 species, ranking among the five megadiverse countries in the world.',
  },
];

/**
 * Resolve a fact for a scientific name, falling back to a generic
 * pool. Returns `null` when nothing fits — caller treats null as
 * "skip dato_curioso for this observation".
 */
export function resolveFact(scientificName: string | null): Fact | null {
  if (scientificName) {
    const key = scientificName.trim().toLowerCase();
    const direct = SPECIES_FACTS[key];
    if (direct) return direct;
    // Genus-level fallback: try the first word.
    const genus = key.split(/\s+/)[0];
    if (genus) {
      for (const [k, v] of Object.entries(SPECIES_FACTS)) {
        if (k.startsWith(genus + ' ')) return v;
      }
    }
  }
  // Cheap pseudo-random pick keyed on the scientific name (or a
  // constant when missing). The picker uses the seed for the
  // probability roll; here we only need a reproducible pool draw.
  if (GENERIC_FACTS.length === 0) return null;
  const seed = scientificName ?? 'rastrum-default';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % GENERIC_FACTS.length;
  return GENERIC_FACTS[idx];
}

export const __TESTING = { SPECIES_FACTS, GENERIC_FACTS };
