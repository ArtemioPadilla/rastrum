# Module 22 — Community Validation (Expert ID Queue)

**Status:** Spec v1.1 — 2026-04-27 (rev. after #26 review)
**Author:** Nyx (via Rastrum group), revised by code-reviewer pass
**Milestone:** v1.1
**Routes:**
- `/{en,es}/{explore,explorar}/{validate,validar}/` — public queue (read-only for all; suggest action requires sign-in)
- `/{en,es}/{profile,perfil}/{validate,validar}/` — personal validation dashboard

---

## Problem

Observations uploaded without a successful identification (or with
`identifications.confidence < 0.5`) have no path to receive a species
name after the fact. The only workaround today is re-uploading the
photo with a manual name, which loses the original timestamp, GPS,
EXIF, and the prior cascade attempts.

Expert users (field botanists, ornithologists, etc.) hold domain
knowledge that exceeds the current pipeline's accuracy. Nothing in
the product captures it.

---

## Solution

A **community validation queue**: observations with no primary
identification or a primary identification below confidence threshold
become visible on a public queue. Any signed-in user may suggest a
taxon. When validators agree (weighted by expert status), the
identification is promoted to **research grade** automatically by the
DB. This is the iNaturalist model adapted to Rastrum's offline-first,
privacy-respecting architecture.

**Critical design decision:** community votes are NOT a new table.
They are additional rows in the existing `identifications` table with
`validated_by` set to the suggesting user's id. The schema already
has consensus + research-grade promotion; we plug into it instead of
duplicating it.

---

## Coexistence with the existing consensus engine

The schema already implements community consensus end-to-end:

| Existing piece | Lives at | What it does |
|---|---|---|
| `identifications` table with `validated_by uuid` | `supabase-schema.sql:259` | Multiple ID rows per observation, each tagged with the user who suggested it |
| `tg_check_validator_not_observer` trigger | `:615` | Refuses inserts/updates where `validated_by = observer_id` (anti-self-vote) |
| `recompute_consensus(observation_id)` function | `:893` | Weighted aggregation: `is_expert AND kingdom = ANY(expert_taxa)` votes count 3×, everyone else 1×. Flips `is_research_grade = true` when winning score ≥ 2.0 AND distinct validators ≥ 2 |
| `tg_research_grade_min_confidence` trigger | `:633` | Refuses `is_research_grade = true` when confidence < 0.4 |
| `tg_research_grade_activity_event` trigger | `:1017` | Fires `activity_events` row on the research-grade transition (already wired to push notifications) |

**This module's job is to expose that machinery through a UI**, not to
replace it. We add zero tables. We add one read-only SQL view (queue
eligibility) and ship the components.

---

## Data model — additive only

### New view: `public.validation_queue`

A read-only view the queue UI selects from. Centralises the
"observations needing community help" definition so the rule lives in
SQL, not a frontend filter that can drift from server policy.

```sql
CREATE OR REPLACE VIEW public.validation_queue AS
SELECT
  o.id                               AS observation_id,
  o.observer_id,
  o.observed_at,
  o.state_province,
  o.habitat,
  o.obscure_level,
  -- Best current identification (primary), if any
  i.id                               AS primary_id_id,
  i.scientific_name                  AS current_scientific_name,
  i.confidence                       AS current_confidence,
  i.is_research_grade,
  -- Vote/agreement counters from the existing identifications table
  (SELECT count(*)
     FROM public.identifications x
    WHERE x.observation_id = o.id
      AND x.validated_by IS NOT NULL)         AS suggestion_count,
  (SELECT count(DISTINCT x.validated_by)
     FROM public.identifications x
    WHERE x.observation_id = o.id
      AND x.validated_by IS NOT NULL)         AS distinct_voter_count
FROM public.observations o
LEFT JOIN public.identifications i
       ON i.observation_id = o.id AND i.is_primary = true
WHERE o.sync_status = 'synced'
  AND o.obscure_level IN ('none','0.1deg','0.2deg','5km')   -- exclude 'full' redaction
  AND (
       i.id IS NULL                                          -- no primary ID at all
    OR COALESCE(i.confidence, 0) < 0.5                       -- low confidence
    OR i.is_research_grade = false                           -- not yet research grade
  );

GRANT SELECT ON public.validation_queue TO authenticated, anon;
```

The view inherits RLS from the underlying tables — observations stay
gated by `obs_public_read`, so private observations never leak into
the queue.

### Suggestion path

To suggest an identification, the UI inserts an `identifications` row:

```sql
INSERT INTO public.identifications (
  observation_id, taxon_id, scientific_name, confidence, source,
  is_primary, validated_by, validated_at
) VALUES (
  $obs_id, $taxon_id, $sci_name, $confidence, 'human',
  false,     -- never primary on insert; existing primary stays put
  auth.uid(),
  now()
);

-- Recompute consensus right after; the existing function flips
-- is_research_grade on the winning row when the rule fires.
SELECT public.recompute_consensus($obs_id);
```

`recompute_consensus()` already exists and already enforces the
expert-weighted ≥ 2-distinct-voter rule. We add nothing.

### Anti-self-vote

`tg_check_validator_not_observer` already refuses
`validated_by = observer_id` at the DB layer. The UI repeats the
check before showing the "Sugerir" button. Same defence twice; no
new trigger needed.

### RLS

The existing `identifications` policies cover community votes by
construction:
- `id_select_public`: SELECT permitted on rows whose observation passes `obs_public_read`
- `id_insert_self`: INSERT permitted when `auth.uid() = validated_by` (i.e. you can only insert *your own* suggestion)
- `id_update_validators_only`: UPDATE refused for everyone except the original suggester

**No new RLS needed.** Verify the three policies exist in current
schema before merging this module's PR; if any are missing, add them
via the same migration as the view.

### Eligibility — voting is open, expert weight matters

Anyone signed-in can suggest. The existing weighted
`recompute_consensus()` gives experts (in their kingdoms) 3× weight,
so two non-experts disagreeing with one expert in their field don't
trigger a false research-grade promotion. This is honest about the
social model (everyone contributes) and resilient (experts dominate
signal). The UI surfaces the breakdown transparently:

> "Esta observación tiene 1 sugerencia de un experto en Plantae y 0 sin verificar."

---

## UI components

### 1. `ValidationQueueView.astro`

Route: `/{lang}/{explore,explorar}/{validate,validar}/`. Open to all.
The "Sugerir" CTA is hidden for unsigned users with a "Inicia sesión
para sugerir" inline replacement.

```
┌─────────────────────────────────────┐
│ 🔬 Cola de validación     [Filtrar ▾]│
│ 42 observaciones necesitan ayuda     │
├─────────────────────────────────────┤
│ [Foto] Especie desconocida           │
│ Por @marimar · Oaxaca · hace 3h      │
│ 📍 Sin identificación               │
│ [Sugerir identificación]            │
├─────────────────────────────────────┤
│ [Foto] Confianza baja (38%)          │
│ Posible: Quercus rugosa             │
│ Por @eugenio · Oaxaca · hace 1d     │
│ 1 sugerencia (no verificada)        │
│ [Confirmar Q. rugosa] [Sugerir otra]│
└─────────────────────────────────────┘
```

**Filters:** taxón (kingdom), estado (sin ID / baja confianza /
esperando segundo voto), región.

**Cards show:** photo thumbnail, current best ID + confidence,
observer username + location + relative time, vote summary
("1 sugerencia · 0 expertos"), action CTAs.

### 2. `SuggestIdModal.astro`

Inline modal triggered from a card. On submit:

1. Look up `taxon_id` by autocomplete-selected scientific name in the
   `taxa` table. **Required** — no taxon_id, no submission. (Stricter
   than the v1.0 spec; required for the existing weighted consensus
   to count expert kingdom-match correctly.)
2. INSERT `identifications` row with `validated_by = auth.uid()`,
   `is_primary = false`.
3. Call `select public.recompute_consensus($obs_id);` via PostgREST RPC.
4. Re-fetch the queue card; if `is_research_grade` flipped, replace
   the card with a "✅ Promovida a grado investigación" toast and
   remove from queue.

### 3. Research-grade badge

`MyObservationsView`, `ExploreRecentView`, and the share-card all
read `identifications.is_research_grade` (already in the schema).
Add a `🔬 Grado investigación` chip when true. No new query — the
field is already in the joined select today.

### 4. Expert dashboard `/{lang}/{profile,perfil}/{validate,validar}/`

Stats sourced from existing `identifications` rows where
`validated_by = auth.uid()`:
- Sugerencias hechas (week / month / total)
- Cuántas alcanzaron grado investigación (count where the
  user-suggested row is now `is_primary = true AND is_research_grade = true`)
- Top kingdoms validated

---

## Eligibility for the queue (single source of truth: the SQL view)

The view above defines it. To recap:

| Signal | SQL clause |
|---|---|
| Synced server-side | `o.sync_status = 'synced'` |
| Not fully redacted | `o.obscure_level IN ('none','0.1deg','0.2deg','5km')` |
| Needs help | `i.id IS NULL OR COALESCE(i.confidence,0) < 0.5 OR i.is_research_grade = false` |

(The PR's earlier `is_sensitive` and `needs_review` references were
schema-incorrect — those columns don't exist. The above uses
`obscure_level`, which does, and replaces `needs_review` with the
explicit confidence/research-grade test.)

---

## Consensus rules (already enforced by `recompute_consensus`)

| Suggestions agreeing | Outcome |
|---|---|
| 1 vote | "1 sugerencia, esperando segundo voto" |
| 2 distinct voters, same taxon, weighted score ≥ 2.0 | `is_research_grade = true` automatically |
| 2 voters disagreeing | Stays in queue. UI shows both proposals; next voter casts the deciding suggestion |
| 1 expert (kingdom-matched) + 0 others | `is_research_grade = false` (need ≥ 2 distinct voters); UI shows "1 experto, esperando segundo" |
| Observer manually edits primary ID | Existing identification update path. The `recompute_consensus` re-fires; community votes are not destroyed but the manual edit becomes the new primary |

---

## Notifications

`tg_research_grade_activity_event` already inserts a row in
`activity_events`. No additional code. The push-notification fanout
in module 11 picks it up automatically.

---

## i18n keys

Add to both `en.json` and `es.json`:

```json
{
  "validation_queue_title": "Cola de validación",
  "validation_queue_subtitle": "{n} observaciones necesitan ayuda",
  "suggest_id": "Sugerir identificación",
  "confirm_id": "Confirmar {name}",
  "suggest_different": "Sugerir otra",
  "votes_count_one": "1 sugerencia",
  "votes_count_other": "{n} sugerencias",
  "experts_count": "{n} expertos en {kingdom}",
  "research_grade": "Grado de investigación",
  "research_grade_promoted": "¡Identificación promovida a grado investigación!",
  "pending_validation": "Esperando validación de la comunidad",
  "cannot_vote_own": "No puedes validar tus propias observaciones",
  "expert_note_placeholder": "Notas (opcional)",
  "confidence_high": "Alta",
  "confidence_medium": "Media",
  "confidence_low": "Baja",
  "validate_signin_prompt": "Inicia sesión para sugerir una identificación"
}
```

---

## Edge cases

1. **Observer manually edits the primary ID** — the existing
   `sync_primary_id_trigger` already coordinates `is_primary` flips.
   Community suggestions remain as non-primary `identifications`
   rows. If they later reach consensus on a different taxon, the
   normal trigger flow picks the new primary; no special handling.

2. **Tie between two taxa** — `recompute_consensus` picks the one
   with higher *score* (expert-weighted). On exact tie, the function
   currently keeps the existing `is_primary` row. UI should warn:
   "Dos sugerencias empatadas — se necesita un voto desempate."

3. **Vote retraction** — DELETE on the user's own
   `identifications` row is permitted by `id_delete_validators_only`
   (verify in schema RLS). After delete, the UI calls
   `recompute_consensus` again; can demote a `is_research_grade` flag.

4. **Anti-vote-stacking** — one `identifications` row per
   `(observation_id, validated_by)` is the convention; consider
   adding a partial UNIQUE index in this module's migration:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uniq_id_obs_validator
     ON public.identifications(observation_id, validated_by)
     WHERE validated_by IS NOT NULL;
   ```
   To change their suggestion, the user UPDATEs the existing row.

5. **Offline expert** — the queue page reads from Supabase via REST.
   No offline support; documented as a known limitation. The Dexie
   outbox is observation-only, not validation-only.

6. **Sensitive species** — `obscure_level = 'full'` rows are
   excluded from the queue by the view's WHERE. Coarsened-but-shown
   rows (`'0.1deg'`, `'5km'`, etc.) appear with their public
   coordinates only.

7. **Expert outside their kingdom** — the UI does not block, but the
   3× weight only applies when `taxa.kingdom = ANY(users.expert_taxa)`,
   so an Aves expert validating a Plantae photo counts 1× like
   anyone else. Honest signal.

---

## Out of scope (revisit later)

- v1.2: weighted votes by reputation score (cumulative validation history).
- v1.3: per-observation chat thread for experts to debate.
- v1.3: GBIF / iNaturalist cross-validation API.
- v2.0: automated re-identification when a new model is deployed.

---

## Files to create

```
docs/specs/infra/community-validation.sql       # the view above + GRANT + UNIQUE index
src/components/ValidationQueueView.astro        # main queue UI
src/components/SuggestIdModal.astro             # suggestion modal
src/pages/es/explorar/validar/index.astro       # ES route
src/pages/en/explore/validate/index.astro       # EN route
src/pages/es/perfil/validar/index.astro         # expert dashboard ES
src/pages/en/profile/validate/index.astro       # expert dashboard EN
```

## Files to modify

```
docs/specs/modules/00-index.md                  # register module 22
docs/specs/infra/supabase-schema.sql            # apply community-validation.sql contents inline (idempotent)
src/components/MyObservationsView.astro         # research-grade chip on synced rows
src/components/ExploreRecentView.astro          # research-grade chip + suggestion-count chip
src/i18n/{en,es}.json                           # new keys above
src/lib/types.ts                                # ValidationQueueRow type matching the view
```

---

## What changed from v1.0 of this spec (PR #26 review notes)

- **Dropped the proposed `community_votes` table.** The existing
  `identifications` table with `validated_by` is the single source
  of truth; reusing it eliminates write-path duplication and gets us
  expert-weight scoring for free via `recompute_consensus()`.
- **Replaced the proposed `check_consensus()` trigger.** The
  existing `recompute_consensus(uuid)` function already implements
  the same rule with stricter weighting. The UI calls it via
  PostgREST RPC after each insert.
- **Replaced the proposed `prevent_self_vote_trigger`.** The
  existing `tg_check_validator_not_observer` enforces it for the
  `identifications.validated_by` path we now use.
- **Replaced `needs_review` and `is_sensitive` references** with the
  schema's actual `obscure_level` enum and explicit `confidence` /
  `is_research_grade` predicates — those phantom columns don't exist
  on `observations`.
- **Centralised eligibility in a SQL view** (`validation_queue`) so
  the rule lives server-side and the frontend can't drift.
- **Made voting open to any signed-in user** (the social/UX intent),
  with expert dominance enforced naturally by the 3× weight in
  `recompute_consensus`. Documented this transparently in the UI.
- **Required `taxon_id` on submission** (was implicit). Without it
  `recompute_consensus` can't apply the kingdom-match expert weight.
- **Added a partial UNIQUE index suggestion** on
  `(observation_id, validated_by)` to enforce one-suggestion-per-user-per-obs
  at the DB layer.
