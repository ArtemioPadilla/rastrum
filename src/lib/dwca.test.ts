import { describe, it, expect } from 'vitest';
import {
  buildMetaXml,
  buildEmlXml,
  buildOccurrenceTsv,
  buildMultimediaTsv,
  buildDwcaManifest,
  applyObscuration,
  OCCURRENCE_FIELDS,
  type DwCMultimediaRecord,
} from './dwca';
import { toDwCRecord, type DwCInput } from './darwin-core';

const baseInput: DwCInput = {
  id: 'aaaa-bbbb-cccc-dddd-eeee',
  observed_at: '2026-04-24T17:30:00Z',
  lat: 17.06,
  lng: -96.72,
  accuracy_m: 8,
  obscure_level: 'none',
  scientific_name: 'Quercus rugosa',
  confidence: 0.92,
  id_source: 'plantnet',
  kingdom: 'Plantae',
  state_province: 'Oaxaca',
  habitat: 'forest_pine_oak',
  observer_display_name: 'M. Hernández',
  observer_license: 'CC BY 4.0',
};

describe('buildMetaXml', () => {
  it('includes the DwC archive root + Occurrence rowType', () => {
    const xml = buildMetaXml({ includeMultimedia: false });
    expect(xml).toContain('<archive xmlns="http://rs.tdwg.org/dwc/text/"');
    expect(xml).toContain('rowType="http://rs.tdwg.org/dwc/terms/Occurrence"');
    expect(xml).toContain('<location>occurrence.txt</location>');
  });

  it('declares an <id index="0"/> for occurrenceID', () => {
    const xml = buildMetaXml({ includeMultimedia: false });
    expect(xml).toContain('<id index="0"/>');
  });

  it('orders fields in occurrence file column order', () => {
    const xml = buildMetaXml({ includeMultimedia: false });
    // basisOfRecord at index 1, eventDate at index 2 (matches OCCURRENCE_FIELDS order)
    expect(xml).toContain('<field index="1" term="http://rs.tdwg.org/dwc/terms/basisOfRecord"/>');
    expect(xml).toContain('<field index="2" term="http://rs.tdwg.org/dwc/terms/eventDate"/>');
  });

  it('omits multimedia extension when not requested', () => {
    const xml = buildMetaXml({ includeMultimedia: false });
    expect(xml).not.toContain('Multimedia');
  });

  it('includes multimedia extension when requested', () => {
    const xml = buildMetaXml({ includeMultimedia: true });
    expect(xml).toContain('rowType="http://rs.gbif.org/terms/1.0/Multimedia"');
    expect(xml).toContain('<location>multimedia.txt</location>');
    expect(xml).toContain('<coreid index="0"/>');
  });
});

describe('buildEmlXml', () => {
  it('emits a packageId, title, abstract, contact, and license', () => {
    const xml = buildEmlXml({
      packageId: 'pkg-1',
      title: 'Rastrum sample dataset',
      abstract: 'Sample observations from Mexico.',
      creator: { organizationName: 'Rastrum', surName: 'Padilla', givenName: 'Artemio', email: 'a@example.com' },
      license: 'CC0-1.0',
    });
    expect(xml).toContain('packageId="pkg-1"');
    expect(xml).toContain('<title xml:lang="en">Rastrum sample dataset</title>');
    expect(xml).toContain('<para>Sample observations from Mexico.</para>');
    expect(xml).toContain('<surName>Padilla</surName>');
    expect(xml).toContain('<electronicMailAddress>a@example.com</electronicMailAddress>');
    expect(xml).toContain('publicdomain/zero/1.0');
  });

  it('escapes XML special characters in user-supplied strings', () => {
    const xml = buildEmlXml({
      packageId: 'pkg-2',
      title: 'A & B <quot>',
      abstract: 'Bell\'s "test"',
      creator: { organizationName: 'Org', surName: 'Padilla' },
      license: 'CC-BY-4.0',
    });
    expect(xml).toContain('A &amp; B &lt;quot&gt;');
    expect(xml).toContain('Bell&apos;s &quot;test&quot;');
  });

  it('includes geographic coverage when bbox supplied', () => {
    const xml = buildEmlXml({
      packageId: 'pkg-3',
      title: 't', abstract: 'a',
      creator: { organizationName: 'O', surName: 'S' },
      license: 'CC0-1.0',
      bbox: [-100, 15, -85, 22],
    });
    expect(xml).toContain('<westBoundingCoordinate>-100</westBoundingCoordinate>');
    expect(xml).toContain('<eastBoundingCoordinate>-85</eastBoundingCoordinate>');
    expect(xml).toContain('<northBoundingCoordinate>22</northBoundingCoordinate>');
    expect(xml).toContain('<southBoundingCoordinate>15</southBoundingCoordinate>');
  });

  it('includes temporal coverage when range supplied', () => {
    const xml = buildEmlXml({
      packageId: 'pkg-4',
      title: 't', abstract: 'a',
      creator: { organizationName: 'O', surName: 'S' },
      license: 'CC0-1.0',
      temporalRange: { start: '2025-01-01', end: '2025-12-31' },
    });
    expect(xml).toContain('<calendarDate>2025-01-01</calendarDate>');
    expect(xml).toContain('<calendarDate>2025-12-31</calendarDate>');
  });
});

describe('buildOccurrenceTsv', () => {
  it('uses tab-separated columns in DwC field order', () => {
    const rows = [toDwCRecord(baseInput)];
    const tsv = buildOccurrenceTsv(rows);
    const [header, body] = tsv.split('\n');
    const headerCols = header.split('\t');
    expect(headerCols[0]).toBe('occurrenceID');
    expect(headerCols).toContain('decimalLatitude');
    // occurrenceID first, basisOfRecord second
    expect(headerCols[1]).toBe('basisOfRecord');
    expect(body.split('\t')[0]).toBe(baseInput.id);
  });

  it('matches the meta.xml column count', () => {
    const rows = [toDwCRecord(baseInput)];
    const tsv = buildOccurrenceTsv(rows);
    const headerCols = tsv.split('\n')[0].split('\t');
    expect(headerCols.length).toBe(OCCURRENCE_FIELDS.length);
  });
});

describe('buildMultimediaTsv', () => {
  it('emits coreId + Audubon-Core terms', () => {
    const mm: DwCMultimediaRecord[] = [{
      coreId: 'aaaa-bbbb-cccc-dddd-eeee',
      identifier: 'https://media.example.com/x.jpg',
      type: 'StillImage',
      format: 'image/jpeg',
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      rightsHolder: 'M. Hernández',
      created: '2026-04-24T17:30:00Z',
    }];
    const tsv = buildMultimediaTsv(mm);
    const [header, body] = tsv.split('\n');
    expect(header.split('\t')[0]).toBe('coreId');
    expect(header).toContain('identifier');
    expect(body).toContain('https://media.example.com/x.jpg');
  });
});

describe('applyObscuration', () => {
  // Reference point — Oaxaca City. Choose values intentionally NOT on a
  // grid boundary so the snap is observable.
  const point = { lat: 17.0654, lng: -96.7236 };

  it('returns precise coords for credentialed consumer regardless of obscure_level', () => {
    const r = applyObscuration({
      ...point, obscure_level: 'full', consumer_credentialed: true,
    });
    expect(r.lat).toBe(point.lat);
    expect(r.lng).toBe(point.lng);
    expect(r.withheld).toBe(false);
  });

  it('returns precise coords for non-sensitive observation', () => {
    const r = applyObscuration({
      ...point, obscure_level: 'none', consumer_credentialed: false,
    });
    expect(r.lat).toBe(point.lat);
    expect(r.lng).toBe(point.lng);
    expect(r.withheld).toBe(false);
  });

  it('snaps to 0.1° grid for 0.1deg level', () => {
    const r = applyObscuration({
      ...point, obscure_level: '0.1deg', consumer_credentialed: false,
    });
    expect(r.withheld).toBe(true);
    expect(r.uncertaintyMeters).toBe(11_100);
    // 17.0654 → 17.1, -96.7236 → -96.7
    expect(r.lat).toBeCloseTo(17.1, 6);
    expect(r.lng).toBeCloseTo(-96.7, 6);
  });

  it('snaps to 0.2° grid for 0.2deg level (~22km)', () => {
    const r = applyObscuration({
      ...point, obscure_level: '0.2deg', consumer_credentialed: false,
    });
    expect(r.withheld).toBe(true);
    expect(r.uncertaintyMeters).toBe(22_200);
    expect(r.lat).toBeCloseTo(17.0, 6);
    expect(r.lng).toBeCloseTo(-96.8, 6);
  });

  it('reports 5km uncertainty for 5km level', () => {
    const r = applyObscuration({
      ...point, obscure_level: '5km', consumer_credentialed: false,
    });
    expect(r.withheld).toBe(true);
    expect(r.uncertaintyMeters).toBe(5_000);
    // The snap is to a ~5km cell so the difference must be < 5km.
    expect(Math.abs(r.lat - point.lat)).toBeLessThan(0.05);
    expect(Math.abs(r.lng - point.lng)).toBeLessThan(0.05);
  });

  it('rounds to whole-degree cell with 100km uncertainty for full level', () => {
    const r = applyObscuration({
      ...point, obscure_level: 'full', consumer_credentialed: false,
    });
    expect(r.withheld).toBe(true);
    expect(r.uncertaintyMeters).toBe(100_000);
    expect(r.lat).toBe(17);
    expect(r.lng).toBe(-97);
  });

  it('credentialed flag wins over full-level obscuration', () => {
    const r = applyObscuration({
      ...point, obscure_level: 'full', consumer_credentialed: true,
    });
    expect(r.withheld).toBe(false);
    expect(r.lat).toBe(point.lat);
    expect(r.lng).toBe(point.lng);
  });
});

describe('buildDwcaManifest', () => {
  it('produces meta.xml + eml.xml + occurrence.txt at minimum', () => {
    const manifest = buildDwcaManifest({
      observations: [baseInput],
      eml: {
        packageId: 'pkg-x',
        title: 'X',
        abstract: 'A',
        creator: { organizationName: 'O', surName: 'S' },
        license: 'CC0-1.0',
      },
    });
    const names = manifest.files.map(f => f.name).sort();
    expect(names).toEqual(['eml.xml', 'meta.xml', 'occurrence.txt']);
    const occ = manifest.files.find(f => f.name === 'occurrence.txt')!;
    expect(occ.content.split('\n')[0]).toContain('occurrenceID');
  });

  it('adds multimedia.txt when media records supplied', () => {
    const manifest = buildDwcaManifest({
      observations: [baseInput],
      multimedia: [{
        coreId: baseInput.id,
        identifier: 'https://media.example.com/x.jpg',
        type: 'StillImage',
        format: 'image/jpeg',
        license: 'https://creativecommons.org/publicdomain/zero/1.0/',
        rightsHolder: 'M. Hernández',
        created: baseInput.observed_at,
      }],
      eml: {
        packageId: 'pkg-y',
        title: 'Y',
        abstract: 'B',
        creator: { organizationName: 'O', surName: 'S' },
        license: 'CC0-1.0',
      },
    });
    const names = manifest.files.map(f => f.name).sort();
    expect(names).toContain('multimedia.txt');
    const meta = manifest.files.find(f => f.name === 'meta.xml')!;
    expect(meta.content).toContain('Multimedia');
  });
});
