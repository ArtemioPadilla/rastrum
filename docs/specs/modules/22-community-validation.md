# Module 22 — Community Validation (Expert ID Queue)

**Status:** Spec v1.0 — 2026-04-27  
**Author:** Nyx (via Rastrum group)  
**Milestone:** v1.1  
**Routes:**
- `/{en,es}/explorar/validar/` — public queue (read-only for all; actions for experts)
- `/{en,es}/perfil/validar/` — expert's personal validation dashboard

---

## Problem

Observations uploaded without a successful identification (or with
`confidence < 0.5`) have no way to receive a species name after the
fact. The only path today is re-uploading the photo with a manual
name, which loses the original timestamp, GPS, and metadata.

Expert users (e.g. field botanists, ornithologists) have domain
knowledge that exceeds the current pipeline's accuracy. There is no
mechanism to capture that knowledge.

---

## Solution

A **community validation queue**: observations flagged as unidentified
or low-confidence are visible to expert users, who can suggest an
identification. When ≥ 2 independent experts agree on the same taxon,
the identification is promoted to **research grade** automatically.

This is the iNaturalist model adapted to Rastrum's offline-first,
privacy-respecting architecture.

---

## Data Model

The schema already supports this. No new tables required.

### Existing fields used

```sql
-- identifications table
validated_by   uuid REFERENCES users(id)   -- set when an expert confirms
is_research_grade  boolean DEFAULT false   -- set when consensus reached
needs_review   boolean DEFAULT false       -- set by pipeline on low confidence

-- users table  
is_expert      boolean DEFAULT false       -- role flag
expert_taxa    text[]                      -- e.g. ARRAY['Plantae','Aves']
```

### New: community_votes table

```sql
CREATE TABLE IF NOT EXISTS public.community_votes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id  uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  voter_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scientific_name text NOT NULL,
  taxon_id        uuid REFERENCES taxa(id),
  confidence      numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  note            text,                    -- expert's reasoning (optional)
  created_at      timestamptz DEFAULT now(),
  UNIQUE(observation_id, voter_id)         -- one vote per user per observation
);

-- Anti-sybil: cannot vote on your own observation
CREATE OR REPLACE FUNCTION public.prevent_self_vote()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observer_id uuid;
BEGIN
  SELECT o.observer_id INTO observer_id
  FROM public.observations o WHERE o.id = NEW.observation_id;
  IF observer_id = NEW.voter_id THEN
    RAISE EXCEPTION 'Cannot validate your own observation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prevent_self_vote_trigger
  BEFORE INSERT ON public.community_votes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_vote();

-- Auto-promote to research grade when ≥2 experts agree
CREATE OR REPLACE FUNCTION public.check_consensus()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  consensus_name  text;
  consensus_count int;
  obs_id          uuid := NEW.observation_id;
BEGIN
  -- Count votes grouped by scientific_name, find the most-voted name
  SELECT scientific_name, count(*) AS n
    INTO consensus_name, consensus_count
    FROM public.community_votes
    WHERE observation_id = obs_id
    GROUP BY scientific_name
    ORDER BY n DESC
    LIMIT 1;

  IF consensus_count >= 2 THEN
    -- Update or insert the primary identification
    UPDATE public.identifications
       SET scientific_name = consensus_name,
           is_research_grade = true,
           validated_by = NEW.voter_id,
           confidence = 0.95
     WHERE observation_id = obs_id AND is_primary = true;
    -- Mark observation as no longer needing review
    UPDATE public.observations
       SET needs_review = false
     WHERE id = obs_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_consensus_trigger
  AFTER INSERT ON public.community_votes
  FOR EACH ROW EXECUTE FUNCTION public.check_consensus();

-- RLS
ALTER TABLE public.community_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes_read_all" ON public.community_votes FOR SELECT USING (true);
CREATE POLICY "votes_insert_own" ON public.community_votes FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = voter_id);
CREATE POLICY "votes_delete_own" ON public.community_votes FOR DELETE
  USING ((SELECT auth.uid()) = voter_id);
```

---

## UI Components

### 1. `ValidationQueueView.astro`

**Route:** `/explorar/validar/`  
**Visible to:** all authenticated users (read); experts only (suggest)

**Layout:**
```
┌─────────────────────────────────────┐
│ 🔬 Cola de validación     [Filtrar ▾]│
│ 42 observaciones necesitan ayuda     │
├─────────────────────────────────────┤
│ [Foto] Especie desconocida           │
│ Por @artemio · Oaxaca · hace 3h      │
│ 📍 Sin identificación               │
│ [Sugerir identificación]            │
├─────────────────────────────────────┤
│ [Foto] Confianza baja (38%)          │
│ Posible: Quercus rugosa             │
│ Por @eugenio · Oaxaca · hace 1d     │
│ [Confirmar] [Sugerir otra]          │
└─────────────────────────────────────┘
```

**Filters:**
- Por taxón (Plantae / Aves / Mammalia / ...)
- Por estado (sin ID / baja confianza / esperando 2do voto)
- Por región

**Cards show:**
- Photo thumbnail
- Current best identification (if any) + confidence
- Observer username + location + time
- Vote count: "1/2 expertos de acuerdo"
- CTA: "Sugerir identificación" (if no ID) or "Confirmar / Sugerir otra" (if low confidence)

### 2. `SuggestIdModal.astro`

Inline modal triggered from a validation card.

```
┌──────────────────────────────────────┐
│ Sugerir identificación               │
│                                      │
│ [Foto de la observación]             │
│                                      │
│ Nombre científico *                  │
│ [Autocomplete input → taxa table]    │
│                                      │
│ Nombre común (opcional)              │
│ [___________________]                │
│                                      │
│ Nota para el observador              │
│ [___________________]                │
│                                      │
│ Tu confianza: ○ Alta  ○ Media  ○ Baja│
│                                      │
│ [Cancelar]   [Enviar sugerencia →]  │
└──────────────────────────────────────┘
```

**Behavior:**
- Autocomplete queries `taxa` table (scientific_name ILIKE `%query%`)
- On submit: INSERT into `community_votes`
- Trigger `check_consensus()` fires automatically in DB
- If consensus reached: show toast "¡Identificación confirmada como grado de investigación!"
- Cannot submit for own observations (blocked by DB trigger + UI check)

### 3. Expert badge on observation cards

On `ExploreRecentView` and `MyObservationsView`, observations that have
received community votes show:

```
🔬 1 experto · Pendiente confirmación
```

Or when research grade:
```
✅ Grado investigación · 2 expertos
```

### 4. Expert dashboard (`/perfil/validar/`)

Personal stats for expert users:
- Cuántas validaciones han hecho esta semana/mes
- Taxa más validados
- Observaciones que validaron y que alcanzaron research grade

---

## Expert Role Flow

```
Usuario aplica → expert_applications table → Admin aprueba en /perfil/admin/expertos/
→ users.is_expert = true, users.expert_taxa = ['Plantae'] (o taxa relevantes)
→ Usuario ve cola de validación con acciones habilitadas
```

The `AdminExpertsView.astro` component (already exists) handles approval.
The `ExpertApplyView.astro` component (already exists) handles applications.

---

## Observation Eligibility for the Queue

An observation appears in the queue when ANY of these is true:

| Condition | SQL |
|-----------|-----|
| No primary identification | `NOT EXISTS (SELECT 1 FROM identifications WHERE observation_id = o.id AND is_primary)` |
| Low confidence | `i.confidence < 0.5` |
| Needs review flag | `o.needs_review = true` |
| Has votes but no consensus yet | `EXISTS (SELECT 1 FROM community_votes WHERE observation_id = o.id)` |

And ALL of these:
- `o.sync_status = 'synced'` (must be on server)
- `o.is_sensitive = false` (sensitive observations are not exposed)
- Observer has not opted out of community validation (`users.profile_public = true`)

---

## Consensus Rules

| Votes agreeing | Outcome |
|----------------|---------|
| 1 | Shows "1 experto de acuerdo" — not yet confirmed |
| ≥ 2 same taxon | `is_research_grade = true` — promoted automatically |
| 2+ disagreeing | Stays in queue — "Expertos en desacuerdo, se necesita más votación" |
| Observer corrects manually | Overrides community vote; observation removed from queue |

---

## Notifications

When an observation transitions to research grade, `activity_events`
fires (existing infrastructure):

```sql
INSERT INTO activity_events (user_id, event_type, payload)
VALUES (
  <observer_id>,
  'observation_research_grade',
  jsonb_build_object('observation_id', <id>, 'scientific_name', <name>)
);
```

The observer sees this in their activity feed and (if push enabled) as
a push notification.

---

## i18n Keys Needed

```json
// es.json — add to "explore" section
"validation_queue_title": "Cola de validación",
"validation_queue_subtitle": "observaciones necesitan ayuda",
"suggest_id": "Sugerir identificación",
"confirm_id": "Confirmar",
"suggest_different": "Sugerir otra",
"votes_count": "{{n}} experto(s) de acuerdo",
"research_grade": "Grado de investigación",
"pending_validation": "Pendiente de validación",
"consensus_reached": "¡Identificación confirmada!",
"cannot_vote_own": "No puedes validar tus propias observaciones",
"expert_note_placeholder": "Notas sobre la identificación (opcional)",
"confidence_high": "Alta", "confidence_medium": "Media", "confidence_low": "Baja"
```

---

## Edge Cases

1. **Tie between two taxa** — stays in queue, shows both suggestions to next expert
2. **Expert changes their vote** — UPDATE community_votes (one per user per obs)
3. **Observer disagrees with consensus** — can override with manual edit; community votes archived
4. **Expert applies for taxa outside their field** — UI warns but does not block (trust the expert)
5. **Offline expert** — voting requires connectivity (write to Supabase); queue is read-only offline

---

## Out of Scope (v1.1)

- Weighted votes by expert reputation score (v1.2)
- Expert chat thread per observation (v1.3)
- GBIF/iNaturalist cross-validation API (v1.3)
- Automated re-identification when new model is deployed (v2.0)

---

## Files to Create

```
src/components/ValidationQueueView.astro   # main queue UI
src/components/SuggestIdModal.astro        # suggestion modal
src/pages/es/explorar/validar/index.astro  # ES route
src/pages/en/explore/validate/index.astro  # EN route
src/pages/es/perfil/validar/index.astro    # expert dashboard ES
src/pages/en/profile/validate/index.astro  # expert dashboard EN
docs/specs/infra/community-votes.sql       # migration SQL
```

## Files to Modify

```
src/components/ExploreRecentView.astro     # add research grade badge
src/components/MyObservationsView.astro    # add vote count chip
src/components/AdminExpertsView.astro      # wire approval to is_expert flag
src/i18n/es.json                           # new keys
src/i18n/en.json                           # new keys
docs/specs/modules/00-index.md             # add module 22
```
