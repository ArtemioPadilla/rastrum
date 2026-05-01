# Taxonomy References for Rastrum (Mexico)

> Established per issue #347. This document defines which authoritative
> checklists Rastrum follows for species names in the Mexican context.

## Primary references by taxon group

| Group | Authority | URL | Update cycle |
|---|---|---|---|
| Birds | AOU/NACC Checklist (via eBird/Clements) | https://www.birds.cornell.edu/clementschecklist/ | Annual (Aug) |
| Plants | CONABIO Catálogo de Autoridades Taxonómicas | https://www.conabio.gob.mx/ | Irregular |
| Mammals | Ramírez-Pulido et al. (2014) + ASM Mammal Diversity Database | https://www.mammaldiversity.org/ | Continuous |
| Reptiles & Amphibians | AmphibiaWeb + Reptile Database | https://amphibiaweb.org/ | Continuous |
| Fungi | Index Fungorum / Species Fungorum | https://www.indexfungorum.org/ | Continuous |
| Insects | Catalogue of Life | https://www.catalogueoflife.org/ | Monthly |
| General fallback | GBIF Backbone Taxonomy | https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c | Quarterly |

## How synonym corrections work

Rastrum maintains a lightweight synonym map at `src/lib/taxonomy-synonyms.ts`.
When an upstream identifier (PlantNet, Claude, BirdNET) returns a name that
appears in the synonym map, the sync engine automatically corrects it to the
current valid name before persisting the identification.

### Adding a new synonym

1. Confirm the name change in the relevant authority (see table above)
2. Add an entry to the `SYNONYMS` array in `src/lib/taxonomy-synonyms.ts`
3. Include: obsolete name, valid name, common names (EN/ES), authority, year
4. Run `npm run test` to verify no regressions
5. The correction applies automatically to all future identifications

### Reporting outdated names

Open a GitHub issue with:
- The outdated name returned by the identifier
- The current valid name per the relevant authority
- A link to the authority's record confirming the change
- Label: `bug`, `data(taxonomy)`

## Long-term plan

Phase 1 (current): Lightweight synonym map for confirmed outdated names.
Phase 2: Integration with GBIF Backbone Taxonomy API for real-time validation.
Phase 3: Local taxa table with periodic sync from CONABIO/GBIF.