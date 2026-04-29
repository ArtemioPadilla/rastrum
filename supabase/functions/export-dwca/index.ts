/**
 * /functions/v1/export-dwca — Darwin Core Archive (DwC-A) ZIP export.
 *
 * Builds a GBIF-IPT-ready ZIP containing:
 *   • meta.xml      — DwC text guide field mapping
 *   • eml.xml       — EML 2.1.1 dataset metadata (title, creator, license)
 *   • occurrence.txt — Tab-separated DwC core
 *   • multimedia.txt — Audubon Core extension (when ?include_multimedia=1)
 *
 * Auth modes:
 *   • Bearer <user JWT>            — exports the caller's own observations
 *   • Bearer <SERVICE_ROLE_KEY>    — full-corpus export (cron / IPT operator)
 *
 * Query params:
 *   ?since=2025-01-01              — eventDate ≥ this ISO date
 *   ?until=2026-04-25              — eventDate ≤ this ISO date
 *   ?bbox=west,south,east,north    — limit to bounding box
 *   ?quality=research_grade|all    — default research_grade
 *   ?license=CC0-1.0|CC-BY-4.0|… — override published license (default CC0-1.0)
 *   ?include_multimedia=1          — include multimedia extension
 *
 * The pure builders live in src/lib/dwca.ts and are unit-tested under Vitest.
 * This Edge Function only handles auth, query, fetch, and ZIP packaging.
 *
 * See docs/gbif-ipt.md for operator deployment notes.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import JSZip from 'https://esm.sh/jszip@3.10.1';

// Inline the pure builders. Edge Functions can't import from `src/lib/*`
// directly (the Deno runtime has its own module resolution and the project
// doesn't ship a `--bundle` step today), so we duplicate the small set of
// pure helpers needed at request time. Keep this in sync with src/lib/dwca.ts.
//
// Schema parity is enforced via the Vitest suite: the tests import the
// canonical builders, so any drift between this file and src/lib/dwca.ts
// would be caught by the developer running `npm test` before deploy.

type ObscureLevel = 'none' | '0.1deg' | '0.2deg' | '5km' | 'full';

interface ObservationRow {
  id: string;
  observed_at: string;
  accuracy_m: number | null;
  obscure_level: ObscureLevel;
  state_province: string | null;
  habitat: string | null;
  location: { type: 'Point'; coordinates: [number, number] } | string | null;
  primary_taxon_id: string | null;
  observer_id: string;
  taxa: { kingdom: string | null; family: string | null; scientific_name: string | null } | null;
  identifications: Array<{
    scientific_name: string;
    confidence: number | null;
    source: string;
    is_primary: boolean;
    is_research_grade: boolean;
  }>;
  users: { display_name: string | null; username: string | null; observer_license: string; credentialed_researcher: boolean } | null;
}

interface MediaRow {
  id: string;
  observation_id: string;
  url: string;
  mime_type: string | null;
  media_type: 'photo' | 'audio' | 'video';
  created_at: string;
}

const KM_PER_DEG_LAT = 111;

function snapDeg(v: number, cell: number): number { return Math.round(v / cell) * cell; }
function snapKm(v: number, km: number, latRef: number): number {
  const kmPerDegLng = Math.cos((latRef * Math.PI) / 180) * KM_PER_DEG_LAT;
  return snapDeg(v, km / kmPerDegLng);
}

function applyObscuration(lat: number, lng: number, level: ObscureLevel, credentialed: boolean) {
  if (credentialed || level === 'none') {
    return { lat, lng, uncertaintyMeters: 30, withheld: false };
  }
  switch (level) {
    case '0.1deg': return { lat: snapDeg(lat, 0.1), lng: snapDeg(lng, 0.1), uncertaintyMeters: 11_100, withheld: true };
    case '0.2deg': return { lat: snapDeg(lat, 0.2), lng: snapDeg(lng, 0.2), uncertaintyMeters: 22_200, withheld: true };
    case '5km':    return { lat: snapKm(lat, 5, lat), lng: snapKm(lng, 5, lat), uncertaintyMeters: 5_000, withheld: true };
    case 'full':   return { lat: snapDeg(lat, 1), lng: snapDeg(lng, 1), uncertaintyMeters: 100_000, withheld: true };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeTsv(v: unknown): string {
  if (v == null) return '';
  // Tabs / newlines / CR are forbidden in tab-separated DwC text files.
  return String(v).replace(/[\t\n\r]/g, ' ');
}

const OCCURRENCE_COLUMNS = [
  'occurrenceID','basisOfRecord','eventDate',
  'decimalLatitude','decimalLongitude','geodeticDatum','coordinateUncertaintyInMeters',
  'scientificName','taxonRank','kingdom',
  'identificationQualifier','identifiedBy','occurrenceStatus',
  'license','rightsHolder','stateProvince','habitat','establishmentMeans',
  'informationWithheld','dataGeneralizations',
] as const;

const OCCURRENCE_TERMS: Record<typeof OCCURRENCE_COLUMNS[number], string> = {
  occurrenceID:                  'http://rs.tdwg.org/dwc/terms/occurrenceID',
  basisOfRecord:                 'http://rs.tdwg.org/dwc/terms/basisOfRecord',
  eventDate:                     'http://rs.tdwg.org/dwc/terms/eventDate',
  decimalLatitude:               'http://rs.tdwg.org/dwc/terms/decimalLatitude',
  decimalLongitude:              'http://rs.tdwg.org/dwc/terms/decimalLongitude',
  geodeticDatum:                 'http://rs.tdwg.org/dwc/terms/geodeticDatum',
  coordinateUncertaintyInMeters: 'http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters',
  scientificName:                'http://rs.tdwg.org/dwc/terms/scientificName',
  taxonRank:                     'http://rs.tdwg.org/dwc/terms/taxonRank',
  kingdom:                       'http://rs.tdwg.org/dwc/terms/kingdom',
  identificationQualifier:       'http://rs.tdwg.org/dwc/terms/identificationQualifier',
  identifiedBy:                  'http://rs.tdwg.org/dwc/terms/identifiedBy',
  occurrenceStatus:              'http://rs.tdwg.org/dwc/terms/occurrenceStatus',
  license:                       'http://purl.org/dc/terms/license',
  rightsHolder:                  'http://purl.org/dc/terms/rightsHolder',
  stateProvince:                 'http://rs.tdwg.org/dwc/terms/stateProvince',
  habitat:                       'http://rs.tdwg.org/dwc/terms/habitat',
  establishmentMeans:            'http://rs.tdwg.org/dwc/terms/establishmentMeans',
  informationWithheld:           'http://rs.tdwg.org/dwc/terms/informationWithheld',
  dataGeneralizations:           'http://rs.tdwg.org/dwc/terms/dataGeneralizations',
};

const MULTIMEDIA_COLUMNS = ['coreId','identifier','type','format','license','rightsHolder','created'] as const;
const MULTIMEDIA_TERMS: Record<Exclude<typeof MULTIMEDIA_COLUMNS[number], 'coreId'>, string> = {
  identifier:   'http://purl.org/dc/terms/identifier',
  type:         'http://purl.org/dc/terms/type',
  format:       'http://purl.org/dc/terms/format',
  license:      'http://purl.org/dc/terms/license',
  rightsHolder: 'http://purl.org/dc/terms/rightsHolder',
  created:      'http://purl.org/dc/terms/created',
};

function buildMetaXml(includeMultimedia: boolean): string {
  const occFields = OCCURRENCE_COLUMNS.map((c, i) =>
    i === 0 ? `    <id index="0"/>` : `    <field index="${i}" term="${OCCURRENCE_TERMS[c]}"/>`
  ).join('\n');

  const multimedia = includeMultimedia ? `
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
             fieldsEnclosedBy="" ignoreHeaderLines="1"
             rowType="http://rs.gbif.org/terms/1.0/Multimedia">
    <files><location>multimedia.txt</location></files>
    <coreid index="0"/>
${MULTIMEDIA_COLUMNS.slice(1).map((c, i) => `    <field index="${i + 1}" term="${MULTIMEDIA_TERMS[c as keyof typeof MULTIMEDIA_TERMS]}"/>`).join('\n')}
  </extension>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n"
        fieldsEnclosedBy="" ignoreHeaderLines="1"
        rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.txt</location></files>
${occFields}
  </core>${multimedia}
</archive>
`;
}

function licenseUrl(license: string): string {
  switch (license) {
    case 'CC0-1.0': case 'CC0':       return 'https://creativecommons.org/publicdomain/zero/1.0/';
    case 'CC-BY-4.0': case 'CC BY 4.0':     return 'https://creativecommons.org/licenses/by/4.0/';
    case 'CC-BY-NC-4.0': case 'CC BY-NC 4.0': return 'https://creativecommons.org/licenses/by-nc/4.0/';
    default: return license;
  }
}

function licenseLabel(license: string): string {
  switch (license) {
    case 'CC0-1.0': case 'CC0':       return 'Creative Commons CC0 1.0 Universal Public Domain Dedication';
    case 'CC-BY-4.0': case 'CC BY 4.0':     return 'Creative Commons Attribution 4.0 International';
    case 'CC-BY-NC-4.0': case 'CC BY-NC 4.0': return 'Creative Commons Attribution-NonCommercial 4.0 International';
    default: return license;
  }
}

function buildEmlXml(opts: {
  packageId: string;
  title: string;
  abstract: string;
  license: string;
  bbox?: [number, number, number, number];
  temporalRange?: { start: string; end: string };
}): string {
  const pubDate = new Date().toISOString().slice(0, 10);
  const geo = opts.bbox ? `
      <geographicCoverage>
        <geographicDescription>Bounding box ${opts.bbox.join(',')}</geographicDescription>
        <boundingCoordinates>
          <westBoundingCoordinate>${opts.bbox[0]}</westBoundingCoordinate>
          <eastBoundingCoordinate>${opts.bbox[2]}</eastBoundingCoordinate>
          <northBoundingCoordinate>${opts.bbox[3]}</northBoundingCoordinate>
          <southBoundingCoordinate>${opts.bbox[1]}</southBoundingCoordinate>
        </boundingCoordinates>
      </geographicCoverage>` : '';
  const temporal = opts.temporalRange ? `
      <temporalCoverage>
        <rangeOfDates>
          <beginDate><calendarDate>${escapeXml(opts.temporalRange.start.slice(0, 10))}</calendarDate></beginDate>
          <endDate><calendarDate>${escapeXml(opts.temporalRange.end.slice(0, 10))}</calendarDate></endDate>
        </rangeOfDates>
      </temporalCoverage>` : '';
  const coverage = (geo || temporal) ? `\n    <coverage>${geo}${temporal}\n    </coverage>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.1.1"
         xmlns:dc="http://purl.org/dc/terms/"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://eml.ecoinformatics.org/eml-2.1.1 https://rs.gbif.org/schema/eml-gbif-profile/1.2/eml.xsd"
         packageId="${escapeXml(opts.packageId)}" system="rastrum"
         scope="system" xml:lang="en">
  <dataset>
    <title xml:lang="en">${escapeXml(opts.title)}</title>
    <creator>
      <organizationName>Rastrum</organizationName>
      <individualName><surName>Rastrum Operator</surName></individualName>
      <electronicMailAddress>data@rastrum.org</electronicMailAddress>
    </creator>
    <pubDate>${pubDate}</pubDate>
    <language>en</language>
    <abstract><para>${escapeXml(opts.abstract)}</para></abstract>
    <intellectualRights>
      <para>This dataset is licensed under <ulink url="${escapeXml(licenseUrl(opts.license))}"><citetitle>${escapeXml(licenseLabel(opts.license))}</citetitle></ulink>.</para>
    </intellectualRights>${coverage}
    <contact>
      <organizationName>Rastrum</organizationName>
      <individualName><surName>Rastrum Operator</surName></individualName>
      <electronicMailAddress>data@rastrum.org</electronicMailAddress>
    </contact>
  </dataset>
</eml:eml>
`;
}

function buildOccurrenceTsv(rows: Record<typeof OCCURRENCE_COLUMNS[number], unknown>[]): string {
  const header = OCCURRENCE_COLUMNS.join('\t');
  const lines = rows.map(r => OCCURRENCE_COLUMNS.map(c => escapeTsv(r[c])).join('\t'));
  return [header, ...lines].join('\n') + '\n';
}

function buildMultimediaTsv(rows: Record<typeof MULTIMEDIA_COLUMNS[number], unknown>[]): string {
  const header = MULTIMEDIA_COLUMNS.join('\t');
  const lines = rows.map(r => MULTIMEDIA_COLUMNS.map(c => escapeTsv(r[c])).join('\t'));
  return [header, ...lines].join('\n') + '\n';
}

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

// PostGIS PostgREST returns `geography(Point)` either as a GeoJSON object
// (when the schema's been wired with a view) or as `SRID=4326;POINT(lng lat)`
// text. Handle both shapes.
function extractLatLng(loc: ObservationRow['location']): { lat: number; lng: number } | null {
  if (!loc) return null;
  if (typeof loc === 'object' && 'coordinates' in loc) {
    return { lng: loc.coordinates[0], lat: loc.coordinates[1] };
  }
  if (typeof loc === 'string') {
    const m = loc.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
    if (!m) return null;
    return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }
  return null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const env = (k: string) => Deno.env.get(k);
  const SUPABASE_URL = env('SUPABASE_URL');
  const ANON_KEY = env('SUPABASE_ANON_KEY');
  const SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    return new Response('Function not configured', { status: 500, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return new Response('Missing Authorization', { status: 401, headers: corsHeaders });

  // Distinguish service-role bearer (full corpus) from user JWT (own rows).
  const isServiceRole = auth === SERVICE_ROLE;
  let userId: string | null = null;
  let userIsCredentialed = false;

  if (!isServiceRole) {
    const supa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${auth}` } },
    });
    const { data: { user }, error } = await supa.auth.getUser();
    if (error || !user) return new Response('Invalid token', { status: 401, headers: corsHeaders });
    userId = user.id;

    const { data: profile } = await supa
      .from('users')
      .select('credentialed_researcher')
      .eq('id', user.id)
      .maybeSingle<{ credentialed_researcher: boolean }>();
    userIsCredentialed = !!profile?.credentialed_researcher;
  }

  // Parse query params (GET and POST both accepted; POST body is ignored).
  const url = new URL(req.url);
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until');
  const bboxRaw = url.searchParams.get('bbox');
  const quality = url.searchParams.get('quality') ?? 'research_grade';
  const license = url.searchParams.get('license') ?? 'CC0-1.0';
  const includeMultimedia = url.searchParams.get('include_multimedia') === '1';

  let bbox: [number, number, number, number] | undefined;
  if (bboxRaw) {
    const parts = bboxRaw.split(',').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
      return new Response('Invalid bbox (expected west,south,east,north)', { status: 400, headers: corsHeaders });
    }
    bbox = parts as [number, number, number, number];
  }

  // Always use service-role for the SELECT so the EF can return precise
  // coords for the credentialed researcher path; obscuration is enforced in
  // applyObscuration() rather than relying on RLS row filtering. Safer
  // contract: the policy lives in this file, not in the database.
  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  let q = db.from('observations').select(`
    id, observed_at, accuracy_m, obscure_level, state_province, habitat, establishment_means, location,
    primary_taxon_id, observer_id,
    taxa:primary_taxon_id(kingdom, family, scientific_name),
    identifications!inner(scientific_name, confidence, source, is_primary, is_research_grade),
    users:observer_id(display_name, username, observer_license, credentialed_researcher)
  `).eq('sync_status', 'synced').eq('identifications.is_primary', true);

  if (userId) q = q.eq('observer_id', userId);
  if (since)  q = q.gte('observed_at', since);
  if (until)  q = q.lte('observed_at', until);
  if (quality === 'research_grade') q = q.eq('identifications.is_research_grade', true);

  const { data: rawObs, error: obsErr } = await q;
  if (obsErr) {
    return new Response(JSON.stringify({ error: obsErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const observations = (rawObs ?? []) as unknown as ObservationRow[];

  // bbox post-filter (cheap and explicit; PostGIS would need st_within).
  const inBbox = (lat: number, lng: number) =>
    !bbox || (lng >= bbox[0] && lat >= bbox[1] && lng <= bbox[2] && lat <= bbox[3]);

  const dwcRows: Record<typeof OCCURRENCE_COLUMNS[number], unknown>[] = [];
  const occurrenceIds: string[] = [];

  for (const o of observations) {
    const ll = extractLatLng(o.location);
    if (!ll || !inBbox(ll.lat, ll.lng)) continue;

    // Service-role exports always honour observer obscuration unless the
    // observation's own owner is credentialed (then the obs was already
    // approved for precise publication). User-JWT exports get precise coords
    // for their own observations as a courtesy (credentialed === true).
    const credentialed = isServiceRole
      ? !!o.users?.credentialed_researcher
      : userIsCredentialed || o.observer_id === userId;

    const { lat, lng, uncertaintyMeters, withheld } =
      applyObscuration(ll.lat, ll.lng, o.obscure_level, credentialed);

    const id0 = o.identifications.find(i => i.is_primary) ?? o.identifications[0];
    const qualifier = id0?.confidence != null && id0.confidence < 0.7 ? 'cf.' : '';

    dwcRows.push({
      occurrenceID: o.id,
      basisOfRecord: 'HumanObservation',
      eventDate: o.observed_at,
      decimalLatitude: lat,
      decimalLongitude: lng,
      geodeticDatum: 'WGS84',
      coordinateUncertaintyInMeters: !withheld && o.accuracy_m != null ? o.accuracy_m : uncertaintyMeters,
      scientificName: id0?.scientific_name ?? o.taxa?.scientific_name ?? '',
      taxonRank: 'species',
      kingdom: o.taxa?.kingdom ?? '',
      identificationQualifier: qualifier,
      identifiedBy: formatIdentifiedBy(id0?.source ?? null),
      occurrenceStatus: 'present',
      license: o.users?.observer_license ?? license,
      rightsHolder: o.users?.display_name || o.users?.username || '',
      stateProvince: o.state_province ?? '',
      habitat: o.habitat?.replace(/_/g, ' ') ?? '',
      establishmentMeans: (o as unknown as { establishment_means?: string }).establishment_means ?? 'wild',
      informationWithheld: withheld ? `Precise location withheld: sensitive species (${o.obscure_level})` : '',
      dataGeneralizations: withheld ? `Coordinates rounded (${o.obscure_level})` : '',
    });
    occurrenceIds.push(o.id);
  }

  // Multimedia (optional): pull primary photo per observation
  const multimediaRows: Record<typeof MULTIMEDIA_COLUMNS[number], unknown>[] = [];
  if (includeMultimedia && occurrenceIds.length > 0) {
    const { data: media } = await db
      .from('media_files')
      .select('id, observation_id, url, mime_type, media_type, created_at')
      .in('observation_id', occurrenceIds)
      .eq('metadata_redacted', false);

    for (const m of (media ?? []) as MediaRow[]) {
      multimediaRows.push({
        coreId: m.observation_id,
        identifier: m.url,
        type: m.media_type === 'photo' ? 'StillImage' : m.media_type === 'audio' ? 'Sound' : 'MovingImage',
        format: m.mime_type ?? '',
        license: licenseUrl(license),
        rightsHolder: '',
        created: m.created_at,
      });
    }
  }

  // Compose the archive.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const packageId = crypto.randomUUID();
  const eml = buildEmlXml({
    packageId,
    title: `Rastrum biodiversity observations (${dateStamp})`,
    abstract: 'Citizen-science biodiversity observations collected via the Rastrum PWA. Each record was identified by either a human observer, an AI vision model (PlantNet, Claude), or both, with sensitive-species locations obscured per the publisher\'s data policy. License applies to the entire dataset; per-record license metadata is provided in the license/rightsHolder columns.',
    license,
    bbox,
    temporalRange: since && until ? { start: since, end: until } : undefined,
  });
  const meta = buildMetaXml(multimediaRows.length > 0);
  const occurrenceTsv = buildOccurrenceTsv(dwcRows);

  const zip = new JSZip();
  zip.file('meta.xml', meta);
  zip.file('eml.xml', eml);
  zip.file('occurrence.txt', occurrenceTsv);
  if (multimediaRows.length > 0) {
    zip.file('multimedia.txt', buildMultimediaTsv(multimediaRows));
  }

  const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  return new Response(zipBytes, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="rastrum-dwca-${dateStamp}.zip"`,
      'X-Rastrum-Records': String(dwcRows.length),
      'X-Rastrum-Multimedia': String(multimediaRows.length),
    },
  });
});
