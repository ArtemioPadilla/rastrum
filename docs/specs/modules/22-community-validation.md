# Module 22 — Community Validation (Expert ID Queue)

**Status:** Spec v1.3 — 2026-04-27 (rev. after schema-verification audit)
**Author:** Nyx (via Rastrum group), revised by code-reviewer pass
**Milestone:** v1.1
**Routes:** (canonical EN ↔ ES pairing — must match `src/i18n/utils.ts` `routes`)
- Public queue: `/en/explore/validate/` ↔ `/es/explorar/validar/` (read-only for all; suggest action requires sign-in)
- Personal validator dashboard: `/en/profile/validate/` ↔ `/es/perfil/validar/`

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

The v1.1/v1.2 spec assumed a richer set of pre-existing policies and
triggers. The v1.3 audit (verifying line numbers against the current
`supabase-schema.sql`) found only two of them actually shipped. The
implementation PR therefore needs both a UI layer **and** a small
RLS / trigger migration. Listed honestly below.

### What already exists today

| Piece | Lives at | What it does |
|---|---|---|
| `identifications` table with `validated_by uuid` | `supabase-schema.sql:259` | Multiple ID rows per observation, each tagged with the user who suggested it |
| `id_owner` policy (FOR ALL) | `:387` | Observation owner has full CRUD on their observation's identifications |
| `id_public_read` policy (FOR SELECT) | `:395` | Anyone can read identifications on synced observations |
| `recompute_consensus(observation_id)` function | `:893` | Weighted aggregation: `is_expert AND kingdom = ANY(expert_taxa)` votes count 3×, everyone else 1×. Flips `is_research_grade = true` when winning score ≥ 2.0 AND distinct validators ≥ 2 |
| `sync_primary_identification()` + `sync_primary_id_trigger` | `:500`, `:533` | Coordinates `is_primary` flips and denormalises taxon/obscure fields onto `observations` |
| `activity_events` table with the `'observation_research_grade'` enum value | `:933` (kind enum), `:937–943` | Already accepts the event we'll fire from the new trigger |

### What this module's migration must ADD

**These do NOT exist today** — the implementation PR ships them:

1. **`id_validator_insert` policy.** Today the `id_owner` policy
   means only the observation's owner can insert identifications.
   Community votes need a parallel INSERT path scoped to the validator:
   ```sql
   DROP POLICY IF EXISTS "id_validator_insert" ON public.identifications;
   CREATE POLICY "id_validator_insert" ON public.identifications
     FOR INSERT TO authenticated
     WITH CHECK (
       (SELECT auth.uid()) = validated_by
       AND validated_by IS NOT NULL
       AND validated_by <> (
         SELECT observer_id FROM public.observations WHERE id = observation_id
       )
       AND is_primary = false   -- community votes never insert as primary
     );
   ```

2. **`id_validator_update` policy.** Validators can update their own
   suggestion (e.g. change confidence, change taxon if they reconsider):
   ```sql
   DROP POLICY IF EXISTS "id_validator_update" ON public.identifications;
   CREATE POLICY "id_validator_update" ON public.identifications
     FOR UPDATE TO authenticated
     USING (
       validated_by IS NOT NULL
       AND (SELECT auth.uid()) = validated_by
     )
     WITH CHECK (
       (SELECT auth.uid()) = validated_by
     );
   ```

3. **`id_validator_delete` policy.** Vote retraction:
   ```sql
   DROP POLICY IF EXISTS "id_validator_delete" ON public.identifications;
   CREATE POLICY "id_validator_delete" ON public.identifications
     FOR DELETE TO authenticated
     USING (
       validated_by IS NOT NULL
       AND (SELECT auth.uid()) = validated_by
     );
   ```

4. **`tg_check_validator_not_observer` trigger.** Belt-and-suspenders
   anti-self-vote at the row layer (the policy already prevents this
   on INSERT, but UPDATE could still try to flip `validated_by` to
   the observer's id):
   ```sql
   CREATE OR REPLACE FUNCTION public.tg_check_validator_not_observer()
   RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE obs_owner uuid;
   BEGIN
     IF NEW.validated_by IS NULL THEN RETURN NEW; END IF;
     SELECT observer_id INTO obs_owner
       FROM public.observations
       WHERE id = NEW.observation_id;
     IF obs_owner = NEW.validated_by THEN
       RAISE EXCEPTION 'A user cannot validate their own observation';
     END IF;
     RETURN NEW;
   END;
   $$;
   DROP TRIGGER IF EXISTS check_validator_not_observer ON public.identifications;
   CREATE TRIGGER check_validator_not_observer
     BEFORE INSERT OR UPDATE OF validated_by ON public.identifications
     FOR EACH ROW EXECUTE FUNCTION public.tg_check_validator_not_observer();
   ```

5. **`tg_research_grade_min_confidence` trigger.** Refuse promoting a
   row to research grade with implausibly low confidence (defence in
   depth in case `recompute_consensus()` is ever bypassed):
   ```sql
   CREATE OR REPLACE FUNCTION public.tg_research_grade_min_confidence()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NEW.is_research_grade = true AND COALESCE(NEW.confidence, 0) < 0.4 THEN
       RAISE EXCEPTION 'Cannot promote to research grade with confidence < 0.4';
     END IF;
     RETURN NEW;
   END;
   $$;
   DROP TRIGGER IF EXISTS research_grade_min_confidence ON public.identifications;
   CREATE TRIGGER research_grade_min_confidence
     BEFORE INSERT OR UPDATE OF is_research_grade ON public.identifications
     FOR EACH ROW EXECUTE FUNCTION public.tg_research_grade_min_confidence();
   ```

6. **`tg_research_grade_activity_event` trigger.** Fires the activity
   event the schema's enum is already prepared for — drives the
   observer's notification on promotion:
   ```sql
   CREATE OR REPLACE FUNCTION public.tg_research_grade_activity_event()
   RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE obs_owner uuid;
   BEGIN
     IF NEW.is_research_grade = true
        AND (OLD.is_research_grade IS DISTINCT FROM NEW.is_research_grade) THEN
       SELECT observer_id INTO obs_owner
         FROM public.observations WHERE id = NEW.observation_id;
       INSERT INTO public.activity_events
         (actor_id, subject_id, kind, payload, visibility)
       VALUES (
         obs_owner,
         NEW.observation_id,
         'observation_research_grade',
         jsonb_build_object(
           'scientific_name', NEW.scientific_name,
           'taxon_id',        NEW.taxon_id,
           'identification_id', NEW.id
         ),
         'self'
       );
     END IF;
     RETURN NEW;
   END;
   $$;
   DROP TRIGGER IF EXISTS research_grade_activity_event ON public.identifications;
   CREATE TRIGGER research_grade_activity_event
     AFTER UPDATE OF is_research_grade ON public.identifications
     FOR EACH ROW EXECUTE FUNCTION public.tg_research_grade_activity_event();
   ```

7. **Tie-handling patch on `recompute_consensus()`.** One-line guard
   so a perfect-score tie blocks promotion (covered in v1.2):
   ```sql
   -- inside the function, before the UPDATE:
   IF (SELECT count(*) FROM weighted WHERE score = winning_score) > 1 THEN
     RETURN;   -- tie; wait for a tiebreaker
   END IF;
   ```

8. **`validation_queue` view + partial UNIQUE index** as defined
   below.

All idempotent, all in the same migration file. Net delta: ~120
lines of SQL.

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

The new `id_validator_insert` policy refuses INSERTs where
`validated_by = observer_id`, and the new
`tg_check_validator_not_observer` trigger covers the UPDATE path.
The UI repeats the check client-side before showing the "Sugerir"
button so a self-vote attempt fails at the form layer rather than
leaking through to a 403. Same defence three times.

### RLS — privacy implications spelled out

After the migration above lands, the privacy-relevant guarantees
break down like this:

| Concern | Enforced by |
|---|---|
| Anon users can't see private-observation suggestions | `obs_public_read` on `observations` — suggestions on private obs are filtered when the parent obs row isn't visible to the caller. |
| Anon users CAN see suggestions on public obs | `id_public_read` on `identifications` — gates SELECT on `observation_id IN (synced public observations)`. |
| Observation owner retains full control over their obs's IDs | `id_owner FOR ALL` (existing) — owner can still INSERT/UPDATE/DELETE the primary identification. |
| Any signed-in user can suggest a non-primary ID | `id_validator_insert` (NEW) — INSERT permitted only when `validated_by = auth.uid()` AND `validated_by ≠ observer_id` AND `is_primary = false`. |
| Only the suggester can edit / delete their suggestion | `id_validator_update`, `id_validator_delete` (NEW) — filter on `validated_by = auth.uid()`. |
| Self-vote refused at row layer too | `tg_check_validator_not_observer` (NEW) — defence in depth in case the policy is ever loosened. |
| Suggestion can't bypass min-confidence on research-grade promotion | `tg_research_grade_min_confidence` (NEW) — refuses `is_research_grade = true` when `confidence < 0.4`. |

Action / write eligibility: any signed-in user can suggest. The
existing 3× expert-in-kingdom weight in `recompute_consensus()`
prevents non-experts from outvoting an expert in their field. This
is the *intended* social model — open to all, signal dominated by
experts. If a future revision wants experts-only voting, the
restriction belongs on `id_validator_insert`, not on a new table.

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

The NEW `tg_research_grade_activity_event` trigger (defined in the
RLS migration above) inserts a row in `activity_events` with the
schema's actual column names:

```sql
INSERT INTO public.activity_events (actor_id, subject_id, kind, payload, visibility)
VALUES (
  <observer_id>,                    -- the OWNER of the obs receives the notif
  <observation_id>,
  'observation_research_grade',     -- enum value already in the CHECK list
  jsonb_build_object('scientific_name', <name>, 'taxon_id', <taxon_id>),
  'self'                            -- visible to owner; not in public feed
);
```

No additional code in this module. The push-notification fanout in
module 11 picks it up automatically. Validators ALSO get a
`'validation_given'` event (already enum-allowed) optionally — TBD in
the implementation PR if surface area warrants it.

---

## i18n keys

Both `en.json` and `es.json` must add identical keys, listed below.
Placeholders use `{n}`, `{name}`, `{kingdom}` (mirror existing
`my_observations_load_more` / `streak_milestone` style):

### `src/i18n/es.json` — `validation` block (new)

```json
"validation": {
  "queue_title":              "Cola de validación",
  "queue_subtitle":           "{n} observaciones necesitan ayuda",
  "queue_empty":              "No hay observaciones esperando validación. ¡Buen trabajo!",
  "suggest_id":               "Sugerir identificación",
  "confirm_id":               "Confirmar {name}",
  "suggest_different":        "Sugerir otra",
  "votes_count_one":          "1 sugerencia",
  "votes_count_other":        "{n} sugerencias",
  "experts_count":            "{n} expertos en {kingdom}",
  "research_grade":           "Grado de investigación",
  "research_grade_promoted":  "¡Identificación promovida a grado investigación!",
  "pending_validation":       "Esperando validación de la comunidad",
  "cannot_vote_own":          "No puedes validar tus propias observaciones",
  "tie_warning":              "Dos sugerencias empatadas — se necesita un voto desempate.",
  "expert_note_placeholder":  "Notas (opcional)",
  "confidence_high":          "Alta",
  "confidence_medium":        "Media",
  "confidence_low":           "Baja",
  "validate_signin_prompt":   "Inicia sesión para sugerir una identificación"
}
```

### `src/i18n/en.json` — `validation` block (new)

```json
"validation": {
  "queue_title":              "Validation queue",
  "queue_subtitle":           "{n} observations need help",
  "queue_empty":              "No observations waiting for validation. Nice work!",
  "suggest_id":               "Suggest identification",
  "confirm_id":               "Confirm {name}",
  "suggest_different":        "Suggest another",
  "votes_count_one":          "1 suggestion",
  "votes_count_other":        "{n} suggestions",
  "experts_count":            "{n} {kingdom} experts",
  "research_grade":           "Research grade",
  "research_grade_promoted":  "Identification promoted to research grade!",
  "pending_validation":       "Waiting for community validation",
  "cannot_vote_own":          "You can't validate your own observations",
  "tie_warning":              "Two suggestions are tied — a tiebreaker vote is needed.",
  "expert_note_placeholder":  "Notes (optional)",
  "confidence_high":          "High",
  "confidence_medium":        "Medium",
  "confidence_low":           "Low",
  "validate_signin_prompt":   "Sign in to suggest an identification"
}
```

---

## Edge cases

1. **Observer manually edits the primary ID** — the existing
   `sync_primary_id_trigger` already coordinates `is_primary` flips.
   Community suggestions remain as non-primary `identifications`
   rows. If they later reach consensus on a different taxon, the
   normal trigger flow picks the new primary; no special handling.

2. **Tie between two taxa.** `recompute_consensus()` orders by
   `score DESC LIMIT 1`, which on a perfect tie returns *one* of the
   tied rows non-deterministically (Postgres ORDER BY without a
   tiebreaker). To avoid arbitrary promotion, the implementation PR
   should harden the function:
   ```sql
   -- before the UPDATE:
   IF (SELECT count(*) FROM weighted WHERE score = winning_score) > 1 THEN
     RETURN;   -- tie; do not promote, wait for a tiebreaker vote
   END IF;
   ```
   The UI surfaces the tie via the `validation.tie_warning` i18n
   string. This change is in scope for this module's migration since
   it's a one-line patch to `recompute_consensus()`; the function is
   already `SECURITY DEFINER` and idempotent.

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

- v1.2: realized as Module 23 (karma + per-taxon expertise + rarity).
  See `23-karma-expertise-rarity.md`.
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
- **Replaced the proposed `prevent_self_vote_trigger`** with what
  v1.1 thought was an existing `tg_check_validator_not_observer`.
  v1.3's audit revealed it didn't actually exist; the migration in
  this spec ships it.
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

## What changed in v1.2 (Copilot review pass on v1.1)

- **Routes canonicalised**: `/en/explore/validate/` ↔ `/es/explorar/validar/`
  + `/en/profile/validate/` ↔ `/es/perfil/validar/`. Earlier draft
  mixed both styles.
- **i18n: explicit EN side**, with `{n}` / `{name}` / `{kingdom}`
  placeholders to match the mock-up counts.
- **Notifications example fixed**: actual schema columns are
  `actor_id, subject_id, kind, payload, visibility` — not the v1.0
  spec's `user_id, event_type`. `kind = 'observation_research_grade'`
  is already enum-allowed.
- **RLS reasoning made explicit** with a five-row table mapping each
  privacy concern to the existing policy/trigger that enforces it.
  No new RLS, but the implementation PR must verify the five exist.
- **Tie handling hardened in spec**: `recompute_consensus()` gets a
  one-line `RETURN` when multiple rows share the winning score, so
  ties don't arbitrary-promote.

## What changed in v1.3 (schema-verification audit)

The v1.1/v1.2 spec confidently claimed five RLS policies + triggers
already existed in `supabase-schema.sql`. Audit revealed only one of
the five (`obs_public_read`) actually shipped — the rest were
cargo-culted from how *I assumed* the schema was organised in
parallel with `recompute_consensus()`. They never existed.

Concretely:

| Spec v1.2 claimed | Reality |
|---|---|
| `id_select_public` policy | Doesn't exist; actual is `id_public_read` (different name, broader scope) |
| `id_insert_self` policy (validator-scoped INSERT) | **Doesn't exist** — `id_owner FOR ALL` blocks community votes entirely (only the obs owner can insert) |
| `id_update_validators_only` policy | Doesn't exist |
| `id_delete_validators_only` policy | Doesn't exist |
| `tg_check_validator_not_observer` trigger | Doesn't exist |
| `tg_research_grade_min_confidence` trigger | Doesn't exist |
| `tg_research_grade_activity_event` trigger | Doesn't exist |

So the v1.2 spec, if followed verbatim, would have failed RLS on the
**very first community vote** because `id_owner FOR ALL` permits only
the observation owner to insert identifications.

v1.3 fixes:
- Replaced "verify these exist" hand-wave with **explicit migration
  SQL** for the missing pieces (≈120 lines, all idempotent).
- Updated the Coexistence section to honestly distinguish "what
  exists today" from "what this module's migration adds".
- Updated the Notifications and Anti-self-vote sections to label the
  new pieces as new, not pre-existing.
