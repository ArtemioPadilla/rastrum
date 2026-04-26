/**
 * Darwin Core Archive (DwC-A) builders for GBIF IPT publishing.
 *
 * Pure functions (no I/O) so they can be exercised under Vitest. The Edge
 * Function `supabase/functions/export-dwca/index.ts` composes these into a
 * ZIP at request time. The CSV-only path (single-file Darwin Core export)
 * still lives in `darwin-core.ts` and is reused here for the row mapping.
 *
 * Spec: docs/specs/modules/06-darwin-core.md
 *       docs/gbif-ipt.md (operator notes)
 */
import { unparse } from 'papaparse';
import { toDwCRecord, type DwCInput, type DwCRecord } from './darwin-core';

// ─────────────────────────── meta.xml ────────────────────────────
//
// Per the TDWG Text Guide, columns are addressed by a 0-based `index`.
// The `id` index points at occurrenceID; subsequent fields each have an
// index matching their column position in `occurrence.txt`. We emit tab-
// separated files because tabs never need quoting and survive every
// downstream IPT importer cleanly.

export const OCCURRENCE_FIELDS: ReadonlyArray<{ term: string; column: keyof DwCRecord }> = [
  { term: 'http://rs.tdwg.org/dwc/terms/occurrenceID',                  column: 'occurrenceID' },
  { term: 'http://rs.tdwg.org/dwc/terms/basisOfRecord',                 column: 'basisOfRecord' },
  { term: 'http://rs.tdwg.org/dwc/terms/eventDate',                     column: 'eventDate' },
  { term: 'http://rs.tdwg.org/dwc/terms/decimalLatitude',               column: 'decimalLatitude' },
  { term: 'http://rs.tdwg.org/dwc/terms/decimalLongitude',              column: 'decimalLongitude' },
  { term: 'http://rs.tdwg.org/dwc/terms/geodeticDatum',                 column: 'geodeticDatum' },
  { term: 'http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters', column: 'coordinateUncertaintyInMeters' },
  { term: 'http://rs.tdwg.org/dwc/terms/scientificName',                column: 'scientificName' },
  { term: 'http://rs.tdwg.org/dwc/terms/taxonRank',                     column: 'taxonRank' },
  { term: 'http://rs.tdwg.org/dwc/terms/kingdom',                       column: 'kingdom' },
  { term: 'http://rs.tdwg.org/dwc/terms/identificationQualifier',       column: 'identificationQualifier' },
  { term: 'http://rs.tdwg.org/dwc/terms/identifiedBy',                  column: 'identifiedBy' },
  { term: 'http://rs.tdwg.org/dwc/terms/occurrenceStatus',              column: 'occurrenceStatus' },
  { term: 'http://purl.org/dc/terms/license',                           column: 'license' },
  { term: 'http://purl.org/dc/terms/rightsHolder',                      column: 'rightsHolder' },
  { term: 'http://rs.tdwg.org/dwc/terms/stateProvince',                 column: 'stateProvince' },
  { term: 'http://rs.tdwg.org/dwc/terms/habitat',                       column: 'habitat' },
  { term: 'http://rs.tdwg.org/dwc/terms/informationWithheld',           column: 'informationWithheld' },
  { term: 'http://rs.tdwg.org/dwc/terms/dataGeneralizations',           column: 'dataGeneralizations' },
];

export const MULTIMEDIA_FIELDS: ReadonlyArray<{ term: string; key: keyof DwCMultimediaRecord }> = [
  { term: 'http://purl.org/dc/terms/identifier', key: 'identifier' },
  { term: 'http://purl.org/dc/terms/type',       key: 'type' },
  { term: 'http://purl.org/dc/terms/format',     key: 'format' },
  { term: 'http://purl.org/dc/terms/license',    key: 'license' },
  { term: 'http://purl.org/dc/terms/rightsHolder', key: 'rightsHolder' },
  { term: 'http://purl.org/dc/terms/created',    key: 'created' },
];

export interface DwCMultimediaRecord {
  /** Core ID of the parent occurrence (occurrenceID). */
  coreId: string;
  identifier: string;
  type: 'StillImage' | 'Sound' | 'MovingImage';
  format: string;
  license: string;
  rightsHolder: string;
  created: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface MetaXmlOptions {
  occurrenceFile?: string;       // default 'occurrence.txt'
  multimediaFile?: string;       // default 'multimedia.txt' if includeMultimedia
  includeMultimedia: boolean;
}

export function buildMetaXml(opts: MetaXmlOptions): string {
  const occFile = opts.occurrenceFile ?? 'occurrence.txt';
  const mmFile = opts.multimediaFile ?? 'multimedia.txt';

  const occFields = OCCURRENCE_FIELDS
    .map((f, i) => i === 0
      ? `    <id index="0"/>`
      : `    <field index="${i}" term="${f.term}"/>`)
    .join('\n');

  const multimedia = opts.includeMultimedia
    ? `
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
             fieldsEnclosedBy="" ignoreHeaderLines="1"
             rowType="http://rs.gbif.org/terms/1.0/Multimedia">
    <files><location>${escapeXml(mmFile)}</location></files>
    <coreid index="0"/>
${MULTIMEDIA_FIELDS.map((f, i) => `    <field index="${i + 1}" term="${f.term}"/>`).join('\n')}
  </extension>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
        fieldsEnclosedBy="" ignoreHeaderLines="1"
        rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>${escapeXml(occFile)}</location></files>
${occFields}
  </core>${multimedia}
</archive>
`;
}

// ─────────────────────────── eml.xml ─────────────────────────────
//
// EML 2.1.1 minimum dataset metadata. GBIF IPT will validate this on
// upload — missing required nodes (`title`, `creator`, `contact`) will
// reject the archive. Optional but strongly recommended: abstract,
// intellectualRights, geographicCoverage, taxonomicCoverage.

export interface EmlXmlOptions {
  packageId: string;             // unique id of the archive (UUID is fine)
  title: string;
  abstract: string;
  language?: string;             // 'en' | 'es' — default 'en'
  pubDate?: string;              // ISO date (YYYY-MM-DD)
  creator: {
    organizationName: string;
    surName: string;
    givenName?: string;
    email?: string;
  };
  contact?: {
    organizationName: string;
    surName: string;
    givenName?: string;
    email?: string;
  };
  /** SPDX-style identifier or display name. */
  license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-NC-4.0' | string;
  /** Optional bbox: [westLng, southLat, eastLng, northLat]. */
  bbox?: [number, number, number, number];
  /** Optional date range covered by the dataset (ISO). */
  temporalRange?: { start: string; end: string };
}

function licenseUrl(license: string): string {
  switch (license) {
    case 'CC0-1.0':       return 'https://creativecommons.org/publicdomain/zero/1.0/';
    case 'CC-BY-4.0':     return 'https://creativecommons.org/licenses/by/4.0/';
    case 'CC-BY-NC-4.0':  return 'https://creativecommons.org/licenses/by-nc/4.0/';
    case 'CC BY 4.0':     return 'https://creativecommons.org/licenses/by/4.0/';
    case 'CC BY-NC 4.0':  return 'https://creativecommons.org/licenses/by-nc/4.0/';
    case 'CC0':           return 'https://creativecommons.org/publicdomain/zero/1.0/';
    default:              return license;
  }
}

function licenseLabel(license: string): string {
  switch (license) {
    case 'CC0-1.0':       return 'Creative Commons CC0 1.0 Universal Public Domain Dedication';
    case 'CC-BY-4.0':     return 'Creative Commons Attribution 4.0 International';
    case 'CC-BY-NC-4.0':  return 'Creative Commons Attribution-NonCommercial 4.0 International';
    default:              return license;
  }
}

export function buildEmlXml(opts: EmlXmlOptions): string {
  const lang = opts.language ?? 'en';
  const pubDate = opts.pubDate ?? new Date().toISOString().slice(0, 10);
  const c = opts.creator;
  const contact = opts.contact ?? c;

  const personFragment = (p: EmlXmlOptions['creator']) => `
      <organizationName>${escapeXml(p.organizationName)}</organizationName>
      <individualName>${p.givenName ? `<givenName>${escapeXml(p.givenName)}</givenName>` : ''}
        <surName>${escapeXml(p.surName)}</surName>
      </individualName>${p.email ? `\n      <electronicMailAddress>${escapeXml(p.email)}</electronicMailAddress>` : ''}`;

  const geo = opts.bbox
    ? `
      <geographicCoverage>
        <geographicDescription>Bounding box ${opts.bbox.join(',')}</geographicDescription>
        <boundingCoordinates>
          <westBoundingCoordinate>${opts.bbox[0]}</westBoundingCoordinate>
          <eastBoundingCoordinate>${opts.bbox[2]}</eastBoundingCoordinate>
          <northBoundingCoordinate>${opts.bbox[3]}</northBoundingCoordinate>
          <southBoundingCoordinate>${opts.bbox[1]}</southBoundingCoordinate>
        </boundingCoordinates>
      </geographicCoverage>`
    : '';

  const temporal = opts.temporalRange
    ? `
      <temporalCoverage>
        <rangeOfDates>
          <beginDate><calendarDate>${escapeXml(opts.temporalRange.start.slice(0, 10))}</calendarDate></beginDate>
          <endDate><calendarDate>${escapeXml(opts.temporalRange.end.slice(0, 10))}</calendarDate></endDate>
        </rangeOfDates>
      </temporalCoverage>`
    : '';

  const coverage = (geo || temporal)
    ? `
    <coverage>${geo}${temporal}
    </coverage>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.1.1"
         xmlns:dc="http://purl.org/dc/terms/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://eml.ecoinformatics.org/eml-2.1.1 https://rs.gbif.org/schema/eml-gbif-profile/1.2/eml.xsd"
         packageId="${escapeXml(opts.packageId)}" system="rastrum"
         scope="system" xml:lang="${escapeXml(lang)}">
  <dataset>
    <title xml:lang="${escapeXml(lang)}">${escapeXml(opts.title)}</title>
    <creator>${personFragment(c)}
    </creator>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <language>${escapeXml(lang)}</language>
    <abstract><para>${escapeXml(opts.abstract)}</para></abstract>
    <intellectualRights>
      <para>This dataset is licensed under <ulink url="${escapeXml(licenseUrl(opts.license))}"><citetitle>${escapeXml(licenseLabel(opts.license))}</citetitle></ulink>.</para>
    </intellectualRights>${coverage}
    <contact>${personFragment(contact)}
    </contact>
  </dataset>
</eml:eml>
`;
}

// ─────────────────────────── obscuration ─────────────────────────
//
// Mirrors the SQL trigger that maintains observations.location_obscured,
// applied here for export consumers that pull raw `location` (precise) on
// behalf of the observer themself. Credentialed researchers see precise
// coords; anonymous public consumers always see the obscured cell centroid.

export type ObscureLevel = 'none' | '0.1deg' | '0.2deg' | '5km' | 'full';

export interface ObservationCoord {
  lat: number;
  lng: number;
  obscure_level: ObscureLevel;
  /**
   * True only when the consumer of this row holds the credentialed-
   * researcher flag. The observer is implicitly credentialed for their
   * own data, so callers normally pass `true` when exporting rows the
   * caller authored themselves.
   */
  consumer_credentialed: boolean;
}

const KM_PER_DEG_LAT = 111;

/** Round to the nearest grid cell centroid. */
function snapToGridDeg(value: number, cellDeg: number): number {
  return Math.round(value / cellDeg) * cellDeg;
}

/** Round to the nearest km-cell centroid (grid-aligned). */
function snapToGridKm(value: number, cellKm: number, latRefDeg: number): number {
  const kmPerDegLng = Math.cos((latRefDeg * Math.PI) / 180) * KM_PER_DEG_LAT;
  const cellDegLng = cellKm / kmPerDegLng;
  return snapToGridDeg(value, cellDegLng);
}

/**
 * Apply Rastrum's obscuration rules to a coordinate pair. Returns the
 * coordinates the consumer is allowed to see plus the implied
 * coordinateUncertaintyInMeters value to publish.
 */
export function applyObscuration(input: ObservationCoord): {
  lat: number;
  lng: number;
  uncertaintyMeters: number;
  withheld: boolean;
} {
  const { lat, lng, obscure_level, consumer_credentialed } = input;

  // Credentialed researchers always get the raw coordinate. Same
  // contract as the SQL `obs_credentialed_read` policy.
  if (consumer_credentialed || obscure_level === 'none') {
    return { lat, lng, uncertaintyMeters: 30, withheld: false };
  }

  switch (obscure_level) {
    case '0.1deg':
      return { lat: snapToGridDeg(lat, 0.1), lng: snapToGridDeg(lng, 0.1),
               uncertaintyMeters: 11_100, withheld: true };
    case '0.2deg':
      return { lat: snapToGridDeg(lat, 0.2), lng: snapToGridDeg(lng, 0.2),
               uncertaintyMeters: 22_200, withheld: true };
    case '5km':
      return { lat: snapToGridKm(lat, 5, lat), lng: snapToGridKm(lng, 5, lat),
               uncertaintyMeters: 5_000, withheld: true };
    case 'full':
      // No public coordinate at all — emit centroid of state grid (~100km)
      // so GBIF still indexes the record at country-level resolution.
      return { lat: snapToGridDeg(lat, 1), lng: snapToGridDeg(lng, 1),
               uncertaintyMeters: 100_000, withheld: true };
  }
}

// ─────────────────────────── tab-separated builders ──────────────

/** Tab-separated DwC core file. */
export function buildOccurrenceTsv(rows: DwCRecord[]): string {
  const columns = OCCURRENCE_FIELDS.map(f => f.column) as string[];
  return unparse(rows, { delimiter: '\t', header: true, columns });
}

export function buildMultimediaTsv(rows: DwCMultimediaRecord[]): string {
  const columns = ['coreId', ...MULTIMEDIA_FIELDS.map(f => f.key)] as string[];
  return unparse(rows, { delimiter: '\t', header: true, columns });
}

// ─────────────────────────── archive composition ────────────────
//
// We separate the in-memory plain-object representation (DwCAManifest)
// from the actual ZIP serialization so tests can assert on file contents
// without pulling jszip in. The Edge Function imports jszip directly.

export interface DwCABundleInput {
  observations: DwCInput[];
  multimedia?: DwCMultimediaRecord[];
  eml: EmlXmlOptions;
}

export interface DwCAManifest {
  files: { name: string; content: string }[];
}

export function buildDwcaManifest(input: DwCABundleInput): DwCAManifest {
  const dwcRows = input.observations.map(toDwCRecord);
  const includeMultimedia = !!(input.multimedia && input.multimedia.length > 0);

  const files = [
    { name: 'meta.xml', content: buildMetaXml({ includeMultimedia }) },
    { name: 'eml.xml',  content: buildEmlXml(input.eml) },
    { name: 'occurrence.txt', content: buildOccurrenceTsv(dwcRows) },
  ];
  if (includeMultimedia && input.multimedia) {
    files.push({ name: 'multimedia.txt', content: buildMultimediaTsv(input.multimedia) });
  }
  return { files };
}
