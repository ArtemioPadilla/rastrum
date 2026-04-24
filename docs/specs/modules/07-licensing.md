# Module 07 — Licensing, ML Training Gates & Data Governance

**Version target:** v0.1 (policy) → v0.5 (enforcement in export pipeline) → v2.0 (ML training gates)
**Status:** Policy draft — requires legal review before v0.1 launch

---

## Overview

Rastrum collects biodiversity data from three kinds of contributors with very
different rights:

1. **Individual observers** — pick a license per-observation (CC BY 4.0, CC BY-NC 4.0, CC0).
2. **Indigenous communities** — contribute data under Local Contexts BC/TK
   Notices; community consent governs use, not a Creative Commons license.
3. **Third-party AI services** — PlantNet, BirdNET, Anthropic. Their terms
   govern whether AI-derived identifications can be republished, mirrored,
   or used as training data.

The platform as a whole is MIT-licensed code. Data carries its own terms per
observation. This module documents how these layers interact — especially when
we ship a regional ML training pipeline (v2.0) that consumes observations.

---

## Observer License Options

At observation creation, the observer selects one of:

| Code | Name | Commercial use | Derivatives | Attribution |
|---|---|---|---|---|
| `CC BY 4.0`   | Creative Commons Attribution         | ✅ | ✅ | Required |
| `CC BY-NC 4.0`| Creative Commons Attribution-NonCommercial | ❌ | ✅ | Required |
| `CC0`         | Public Domain Dedication             | ✅ | ✅ | Not required |

**Default:** `CC BY 4.0`. Stored per-observation on `public.users.observer_license`
as a profile default, overridable per-observation via `media_files.license`.

The license applies to:
- Uploaded media (photos, audio, video).
- Observer-authored text fields (notes).
- The observation record itself (coordinates, timestamps, habitat tags).

The license does **not** extend to:
- AI-generated identifications (governed by the AI provider's terms).
- Taxonomic backbone data (GBIF / POWO / IOC — carry their own licenses).
- Environmental enrichment (OpenMeteo, NDVI — carry their own terms).

---

## ML Training Gates (v2.0 regional pipeline)

When the v2.0 regional model training pipeline ingests observations, it applies
this filter:

```sql
-- Observations eligible for training a public/commercial regional model
SELECT o.id, m.url, i.scientific_name
FROM observations o
JOIN media_files m ON m.observation_id = o.id
JOIN identifications i ON i.observation_id = o.id AND i.is_primary
JOIN users u ON u.id = o.observer_id
WHERE o.sync_status = 'synced'
  AND i.is_research_grade = true          -- community consensus achieved
  AND m.license IN ('CC BY 4.0', 'CC0')   -- NC-licensed data excluded
  AND NOT EXISTS (                         -- no Local Contexts BC/TK restrictions
    SELECT 1 FROM observation_bc_notices bc
    WHERE bc.observation_id = o.id
      AND bc.restricts_training = true
  );
```

**Rationale:** CC BY-NC 4.0 observations cannot be used to train models
shipped under MIT or commercial licenses. Attempting to do so would launder
non-commercial data into commercial output. A CC BY-NC observation is still
visible on the public map and exportable to GBIF (GBIF accepts NC) — it just
cannot enter the training set.

**UI disclosure:** when the observer picks CC BY-NC, a one-line note is shown:
"This license lets others share your work with attribution, but excludes your
observation from Rastrum's training pipeline. Pick CC BY or CC0 if you want
to help improve the AI."

---

## Indigenous Data Sovereignty (CARE Principles)

Observations contributed through a community partnership (e.g. the Zapoteco
pilot in Sierra Norte de Oaxaca) are governed by Free, Prior, and Informed
Consent (FPIC) at the community level — not by a Creative Commons license
selected by an individual.

These observations carry a **Local Contexts BC/TK Notice** reference:

- `BC Notice` — Biocultural label defined by the community.
- `TK Notice` — Traditional Knowledge label defined by the community.

Notices can restrict:
- Commercial use.
- Use in ML training datasets.
- Redistribution to specific third parties.
- Public-map visibility of precise coordinates.

Implementation: a `observation_bc_notices` table links observations to Local
Contexts notice IDs and carries boolean flags (`restricts_commercial`,
`restricts_training`, `restricts_precise_location`). Enforcement happens in
three places: the ML training query above, the Darwin Core export pipeline,
and the public map RLS policy.

**Hard rule:** no BC/TK-flagged observation enters any pipeline until the
Local Contexts integration ships (v0.5) and community consent is on file.
Until then, any such observations remain visible only to the observer.

---

## AI Provider Terms — Implications for Republishing

| Service | Our usage | Restriction relevant to us |
|---|---|---|
| PlantNet API | First-pass plant ID | Free tier is research-only; commercial requires upgrade. Can republish results. |
| BirdNET | Audio ID (v0.5+) | **Commercial license required** from Cornell Lab before v0.5 ships. Affects audio identifications only. |
| Anthropic Claude (Haiku 4.5 / Sonnet) | Vision + Scout RAG | Outputs are ours to use and republish; cannot be used to train competing models. |
| OpenMeteo | Weather enrichment | CC BY 4.0 — attribution required in Darwin Core export's `dataGeneralizations`. |

**Risk:** shipping v0.5 audio ID without the BirdNET commercial license in hand
would breach Cornell's terms. The BirdNET item in the v0.5 roadmap is
blocked-by "BirdNET commercial license signed" — track as a governance task,
not a code task.

---

## Darwin Core Export — License Propagation

Every exported record carries its observer's license in the `license` DwC term,
plus BC/TK notice IDs in `dataGeneralizations` when present:

```typescript
{
  license: 'https://creativecommons.org/licenses/by/4.0/',
  rightsHolder: 'M. Hernández',
  dataGeneralizations: 'Coordinates rounded to 0.2° grid (NOM-059 P); Local Contexts BC notice: BC-001-RASTRUM'
}
```

GBIF and SNIB ingest these fields and respect downstream re-use restrictions.

---

## Open Questions (decide before v0.1 launch)

1. **CC BY-NC default?** Safer for protecting observers, worse for AI training
   data volume. Recommend: keep CC BY as default, show license as a deliberate
   first-run choice.
2. **CC0 incentive?** Offer a badge or a small reputational boost to CC0
   contributors? Mirrors iNaturalist pattern. Risk: gameable.
3. **Retroactive license changes.** If an observer switches from CC BY to CC
   BY-NC, do we remove them from the training set retroactively? CC allows
   this for not-yet-distributed copies; established training runs are sunk
   cost. Needs a decision documented in the privacy/terms doc.
