# Module 06 — Darwin Core Export

**Version target:** v0.1
**Status:** Not started

---

## Overview

Export observations as Darwin Core Archive (DwC-A) for submission to GBIF, CONABIO SNIB, and iNaturalist. Minimum viable DwC fields populated from v0.1. CSV export always available; DwC-A ZIP for GBIF IPT from v0.5.

---

## Minimum DwC Field Mapping

```typescript
interface DarwinCoreRecord {
  // Required for GBIF
  occurrenceID: string;              // UUID of observation
  basisOfRecord: 'HumanObservation' | 'MachineObservation';
  eventDate: string;                 // ISO 8601: "2026-04-24T17:30:00Z"
  decimalLatitude: number;           // WGS84
  decimalLongitude: number;          // WGS84
  geodeticDatum: 'WGS84';
  coordinateUncertaintyInMeters: number;
  scientificName: string;            // e.g. "Quercus rugosa Née"
  taxonRank: 'species' | 'genus' | 'family';
  occurrenceStatus: 'present' | 'absent';
  license: string;                   // 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0'
  rightsHolder: string;              // observer display name

  // Strongly recommended
  identificationQualifier: string;  // 'cf.' | 'aff.' | '' (empty = certain)
  identifiedBy: string;             // observer name | 'Rastrum AI' | 'PlantNet AI'
  kingdom: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  specificEpithet?: string;
  infraspecificEpithet?: string;
  taxonID?: string;                  // GBIF taxon key if matched

  // Recommended for location
  stateProvince?: string;            // 'Oaxaca'
  municipality?: string;
  locality?: string;
  habitat?: string;
  footprintWKT?: string;

  // Recommended for record quality
  recordedBy?: string;
  recordNumber?: string;
  informationWithheld?: string;      // 'Location obscured: NOM-059 P species'
  dataGeneralizations?: string;      // 'Coordinates rounded to 0.2° grid'

  // Sensitive species obscuration
  verbatimCoordinates?: string;      // stored privately
  verbatimLatitude?: string;
  verbatimLongitude?: string;
}
```

---

## Mapping from Observation to DwC

```typescript
function observationToDwC(obs: Observation, taxon: Taxon): DarwinCoreRecord {
  const isObscured = !!obs.location_obscured;

  return {
    occurrenceID: obs.id,
    basisOfRecord: obs.identification.source === 'human' ? 'HumanObservation' : 'HumanObservation',
    eventDate: obs.created_at,
    decimalLatitude: isObscured ? obs.location_obscured!.lat : obs.location.lat,
    decimalLongitude: isObscured ? obs.location_obscured!.lng : obs.location.lng,
    geodeticDatum: 'WGS84',
    coordinateUncertaintyInMeters: isObscured ? 22_200 : obs.location.accuracy_m, // 0.2° ≈ 22.2km

    scientificName: taxon.scientific_name_with_author,
    taxonRank: taxon.taxon_rank,
    kingdom: taxon.kingdom,
    family: taxon.family,
    genus: taxon.genus,
    specificEpithet: taxon.specific_epithet,

    identificationQualifier: obs.identification.confidence < 0.7 ? 'cf.' : '',
    identifiedBy: formatIdentifiedBy(obs.identification.source),
    occurrenceStatus: 'present',

    license: obs.observer_license || 'CC BY 4.0',
    rightsHolder: obs.observer_display_name || obs.observer_id,

    informationWithheld: isObscured
      ? `Precise location withheld: ${taxon.nom059_status ? `NOM-059 ${taxon.nom059_status}` : 'sensitive species'}`
      : undefined,
    dataGeneralizations: isObscured
      ? 'Coordinates rounded to 0.2° grid cell (approx. 22km)'
      : undefined,

    habitat: obs.habitat?.replace('_', ' '),
    stateProvince: reverseGeocodeState(obs.location.lat, obs.location.lng),
  };
}

function formatIdentifiedBy(source: IDSource): string {
  const map: Record<IDSource, string> = {
    plantnet: 'PlantNet AI v2',
    claude_haiku: 'Rastrum AI (Claude Haiku 4.5)',
    claude_sonnet: 'Rastrum AI (Claude Sonnet)',
    onnx_offline: 'Rastrum AI (on-device model)',
    human: 'Observer',
  };
  return map[source];
}
```

---

## CSV Export (v0.1)

```typescript
import { unparse } from 'papaparse';

export function exportToCSV(observations: Observation[], taxa: Map<string, Taxon>): string {
  const records = observations.map(obs => {
    const taxon = taxa.get(obs.identification.taxon_id || '');
    return observationToDwC(obs, taxon!);
  });

  return unparse(records, {
    header: true,
    columns: DWC_COLUMN_ORDER, // standard DwC field order
  });
}

// Trigger download
function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## Darwin Core Archive (v0.5+)

Full DwC-A ZIP for GBIF IPT upload:

```
dwca.zip
├── meta.xml          ← field mapping descriptor
├── eml.xml           ← dataset metadata (EML)
├── occurrence.csv    ← core occurrences
└── multimedia.csv    ← Audubon Core media records (extension)
```

**meta.xml template:**
```xml
<?xml version="1.0" encoding="utf-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/">
  <core encoding="UTF-8" fieldsTerminatedBy="," linesTerminatedBy="\n"
        fieldsEnclosedBy='"' ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.csv</location></files>
    <id index="0"/>
    <field index="1" term="http://rs.tdwg.org/dwc/terms/basisOfRecord"/>
    <field index="2" term="http://rs.tdwg.org/dwc/terms/eventDate"/>
    <!-- ... all fields ... -->
  </core>
  <extension rowType="http://rs.tdwg.org/ac/terms/Multimedia">
    <files><location>multimedia.csv</location></files>
    <coreid index="0"/>
    <field index="1" term="http://purl.org/dc/terms/identifier"/>
    <field index="2" term="http://purl.org/dc/terms/format"/>
    <field index="3" term="http://ns.adobe.com/xap/1.0/rights/UsageTerms"/>
  </extension>
</archive>
```

---

## Audubon Core Media Fields

```typescript
interface AudubonCoreMedia {
  'dcterms:identifier': string;      // URL to image
  'dcterms:type': 'StillImage' | 'Sound' | 'MovingImage';
  'dcterms:format': string;          // 'image/jpeg'
  'ac:accessURI': string;
  'ac:hashFunction': 'SHA256';
  'ac:hashValue': string;
  'dcterms:license': string;         // 'https://creativecommons.org/licenses/by/4.0/'
  'ac:tag': string;                  // comma-sep: 'plant, leaf, flower'
  'ac:subjectOrientation': string;   // 'dorsal' | 'lateral' | 'frontal'
  'dcterms:created': string;         // ISO 8601
  'Iptc4xmpExt:CVterm': string;      // 'http://cv.iptc.org/newscodes/digitalnewscode/picture'
}
```

---

## Taxon Backbone

```typescript
// Primary: GBIF Backbone (adopted Catalogue of Life xrelease, late 2024)
// Plants: cross-ref POWO/WCVP (MEXU is largest herbarium)
// Birds: IOC World Bird List

// Never rewrite historical usage:
interface TaxonUsageHistory {
  observation_id: string;
  original_name: string;           // name at time of identification
  original_taxon_id: string;
  current_accepted_id: string;     // updated when backbone changes
  synonym_since?: string;          // date backbone marked as synonym
}
```
