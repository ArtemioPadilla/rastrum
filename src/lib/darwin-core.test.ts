import { describe, it, expect } from 'vitest';
import { toDwCRecord, toCSV, SNIB_COLUMNS, CONANP_COLUMNS, type DwCInput } from './darwin-core';

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

describe('toDwCRecord', () => {
  it('maps a high-confidence non-obscured observation faithfully', () => {
    const r = toDwCRecord(baseInput);
    expect(r.occurrenceID).toBe(baseInput.id);
    expect(r.scientificName).toBe('Quercus rugosa');
    expect(r.identificationQualifier).toBe('');                     // confidence ≥ 0.7
    expect(r.coordinateUncertaintyInMeters).toBe(8);                // raw GPS accuracy
    expect(r.informationWithheld).toBe('');
    expect(r.dataGeneralizations).toBe('');
    expect(r.habitat).toBe('forest pine oak');                       // underscore → space
    expect(r.identifiedBy).toBe('PlantNet AI v2');
    expect(r.geodeticDatum).toBe('WGS84');
  });

  it('flags low-confidence IDs with cf. qualifier', () => {
    const r = toDwCRecord({ ...baseInput, confidence: 0.55 });
    expect(r.identificationQualifier).toBe('cf.');
  });

  it('rounds coordinate uncertainty up for obscured rows', () => {
    const r = toDwCRecord({ ...baseInput, obscure_level: '0.2deg' });
    expect(r.coordinateUncertaintyInMeters).toBe(22_200);
    expect(r.informationWithheld).toContain('Precise location withheld');
    expect(r.dataGeneralizations).toContain('grid cell');
  });

  it('handles 5km obscuration', () => {
    const r = toDwCRecord({ ...baseInput, obscure_level: '5km' });
    expect(r.coordinateUncertaintyInMeters).toBe(5_000);
  });

  it('falls back gracefully when fields are null', () => {
    const r = toDwCRecord({
      ...baseInput,
      scientific_name: null,
      kingdom: null,
      state_province: null,
      habitat: null,
      observer_display_name: null,
      confidence: null,
      id_source: null,
    });
    expect(r.scientificName).toBe('');
    expect(r.kingdom).toBe('');
    expect(r.identificationQualifier).toBe('');                     // null confidence ≠ low
    expect(r.identifiedBy).toBe('Unknown');
    expect(r.rightsHolder).toBe('');
  });
});

describe('toCSV', () => {
  it('emits the standard Darwin Core column order', () => {
    const csv = toCSV([toDwCRecord(baseInput)]);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toContain('occurrenceID');
    expect(headerLine).toContain('decimalLatitude');
    expect(headerLine).toContain('coordinateUncertaintyInMeters');
    expect(headerLine).toContain('license');
    // First column is occurrenceID, not eventDate
    expect(headerLine.split(',')[0]).toBe('occurrenceID');
  });

  it('produces one row per record', () => {
    const csv = toCSV([toDwCRecord(baseInput), toDwCRecord({ ...baseInput, id: 'second' })]);
    expect(csv.split('\n').filter(l => l.trim().length > 0).length).toBe(3); // header + 2 rows
  });
});

describe('institutional presets', () => {
  it('SNIB drops fields outside its subset', () => {
    expect(SNIB_COLUMNS).not.toContain('basisOfRecord');
    expect(SNIB_COLUMNS).toContain('scientificName');
    expect(SNIB_COLUMNS).toContain('coordinateUncertaintyInMeters');
  });

  it('CONANP focuses on protected-area fields', () => {
    expect(CONANP_COLUMNS).toContain('habitat');
    expect(CONANP_COLUMNS).toContain('informationWithheld');
    expect(CONANP_COLUMNS).not.toContain('rightsHolder');
  });
});
