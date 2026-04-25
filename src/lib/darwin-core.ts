/**
 * Darwin Core CSV export — see docs/specs/modules/06-darwin-core.md.
 *
 * v0.1 ships the minimum DwC field set sufficient for GBIF ingestion:
 * occurrenceID, basisOfRecord, eventDate, decimalLatitude/Longitude,
 * coordinateUncertaintyInMeters, scientificName, taxonRank, kingdom,
 * license, rightsHolder, identifiedBy, informationWithheld.
 *
 * DwC-A (ZIP with meta.xml / eml.xml + extensions) lands in v0.5.
 */
import { unparse } from 'papaparse';

export interface DwCInput {
  id: string;
  observed_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  obscure_level: string;
  scientific_name: string | null;
  confidence: number | null;
  id_source: string | null;
  kingdom: string | null;
  state_province: string | null;
  habitat: string | null;
  observer_display_name: string | null;
  observer_license: string;
}

export interface DwCRecord {
  occurrenceID: string;
  basisOfRecord: 'HumanObservation' | 'MachineObservation';
  eventDate: string;
  decimalLatitude: number;
  decimalLongitude: number;
  geodeticDatum: 'WGS84';
  coordinateUncertaintyInMeters: number;
  scientificName: string;
  taxonRank: string;
  kingdom: string;
  identificationQualifier: string;
  identifiedBy: string;
  occurrenceStatus: 'present';
  license: string;
  rightsHolder: string;
  stateProvince: string;
  habitat: string;
  informationWithheld: string;
  dataGeneralizations: string;
}

// Stable column order. GBIF tolerates reordering but consumers prefer consistency.
export const DWC_COLUMNS: (keyof DwCRecord)[] = [
  'occurrenceID','basisOfRecord','eventDate',
  'decimalLatitude','decimalLongitude','geodeticDatum','coordinateUncertaintyInMeters',
  'scientificName','taxonRank','kingdom',
  'identificationQualifier','identifiedBy','occurrenceStatus',
  'license','rightsHolder','stateProvince','habitat',
  'informationWithheld','dataGeneralizations',
];

function formatIdentifiedBy(source: string | null): string {
  switch (source) {
    case 'plantnet':     return 'PlantNet AI v2';
    case 'claude_haiku': return 'Rastrum AI (Claude Haiku 4.5)';
    case 'claude_sonnet':return 'Rastrum AI (Claude Sonnet)';
    case 'onnx_offline': return 'Rastrum AI (on-device)';
    case 'human':        return 'Observer';
    default:             return 'Unknown';
  }
}

export function toDwCRecord(input: DwCInput): DwCRecord {
  const isObscured = input.obscure_level && input.obscure_level !== 'none';
  const uncertainty =
    input.obscure_level === '0.2deg' ? 22_200 :
    input.obscure_level === '0.1deg' ? 11_100 :
    input.obscure_level === '5km'    ?  5_000 :
    input.obscure_level === 'full'   ? 100_000 :
    (input.accuracy_m ?? 30);

  const qualifier =
    input.confidence != null && input.confidence < 0.7 ? 'cf.' : '';

  return {
    occurrenceID: input.id,
    basisOfRecord: 'HumanObservation',
    eventDate: input.observed_at,
    decimalLatitude: input.lat,
    decimalLongitude: input.lng,
    geodeticDatum: 'WGS84',
    coordinateUncertaintyInMeters: uncertainty,
    scientificName: input.scientific_name ?? '',
    taxonRank: 'species',
    kingdom: input.kingdom ?? '',
    identificationQualifier: qualifier,
    identifiedBy: formatIdentifiedBy(input.id_source),
    occurrenceStatus: 'present',
    license: input.observer_license,
    rightsHolder: input.observer_display_name ?? '',
    stateProvince: input.state_province ?? '',
    habitat: input.habitat?.replace(/_/g, ' ') ?? '',
    informationWithheld: isObscured ? `Precise location withheld: sensitive species (${input.obscure_level})` : '',
    dataGeneralizations: isObscured ? `Coordinates rounded to grid cell (${input.obscure_level})` : '',
  };
}

export function toCSV(rows: DwCRecord[]): string {
  return unparse(rows, { header: true, columns: DWC_COLUMNS as string[] });
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ───────────────────── Institutional export presets ─────────────────────
//
// CONABIO SNIB and CONANP both ingest Darwin Core but use a tighter column
// subset and Spanish header aliases. We export the same data with the column
// list reshaped — observers and researchers don't need to remap manually.

export const SNIB_COLUMNS: (keyof DwCRecord)[] = [
  'occurrenceID','eventDate','decimalLatitude','decimalLongitude',
  'coordinateUncertaintyInMeters','scientificName','kingdom',
  'identificationQualifier','identifiedBy','occurrenceStatus',
  'license','rightsHolder','stateProvince','habitat',
];

export const CONANP_COLUMNS: (keyof DwCRecord)[] = [
  'occurrenceID','eventDate','decimalLatitude','decimalLongitude',
  'coordinateUncertaintyInMeters','scientificName','kingdom','habitat',
  'informationWithheld',
];

/** SNIB preset: subset columns + ASCII filename. */
export function toCsvSnib(rows: DwCRecord[]): string {
  return unparse(rows, { header: true, columns: SNIB_COLUMNS as string[] });
}

/** CONANP ANP report preset. */
export function toCsvConanp(rows: DwCRecord[]): string {
  return unparse(rows, { header: true, columns: CONANP_COLUMNS as string[] });
}
