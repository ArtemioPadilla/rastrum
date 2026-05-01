/**
 * Lightweight synonym map for known outdated species names returned by
 * upstream identification APIs. Maps obsolete scientific names to their
 * current valid equivalents per authoritative checklists.
 *
 * This is NOT a full taxonomy database — it's a targeted correction layer
 * for names we've confirmed are outdated in the Mexican context. Add entries
 * as they're reported (see issue #347 for the long-term plan).
 *
 * Sources:
 *  - Birds: AOU/NACC Checklist (2024), eBird/Clements v2024
 *  - Plants: CONABIO Catálogo de Autoridades Taxonómicas
 *  - General: GBIF Backbone Taxonomy
 */

export interface TaxonSynonym {
  /** The outdated name returned by an identifier */
  obsolete: string;
  /** The current valid name */
  valid: string;
  /** Common name in English (optional) */
  commonNameEn?: string;
  /** Common name in Spanish (optional) */
  commonNameEs?: string;
  /** Which checklist/authority confirms this change */
  authority: string;
  /** Year the name change was published */
  year: number;
}

/**
 * Known synonyms. Keyed by lowercase obsolete name for fast lookup.
 * Add new entries as they're reported — see docs/runbooks/taxonomy-references.md.
 */
const SYNONYMS: TaxonSynonym[] = [
  {
    obsolete: 'Aratinga canicularis',
    valid: 'Psittacara canicularis',
    commonNameEn: 'Orange-fronted Parakeet',
    commonNameEs: 'Perico frente naranja',
    authority: 'AOU/NACC Checklist 2014 (55th supplement)',
    year: 2014,
  },
  {
    obsolete: 'Amazilia beryllina',
    valid: 'Saucerottia beryllina',
    commonNameEn: 'Berylline Hummingbird',
    commonNameEs: 'Colibrí berilo',
    authority: 'AOU/NACC Checklist 2014',
    year: 2014,
  },
  {
    obsolete: 'Amazilia violiceps',
    valid: 'Leucolia violiceps',
    commonNameEn: 'Violet-crowned Hummingbird',
    commonNameEs: 'Colibrí corona violeta',
    authority: 'AOU/NACC Checklist 2014',
    year: 2014,
  },
];

const synonymMap = new Map<string, TaxonSynonym>(
  SYNONYMS.map(s => [s.obsolete.toLowerCase(), s])
);

/**
 * Look up a scientific name and return the current valid name if the input
 * is a known obsolete synonym. Returns null if the name is already valid
 * (or unknown to our synonym list).
 */
export function resolveCurrentName(scientificName: string): TaxonSynonym | null {
  return synonymMap.get(scientificName.toLowerCase()) ?? null;
}

/**
 * Apply synonym resolution to an identification result, returning the
 * corrected name if a synonym was found. Non-destructive: returns the
 * original name if no synonym exists.
 */
export function correctIdentificationName(scientificName: string): string {
  const syn = resolveCurrentName(scientificName);
  return syn ? syn.valid : scientificName;
}